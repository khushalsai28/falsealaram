# FactLens v2 — Product Requirements Document (LLM-ready)

> Feed this file to an implementing LLM along with the repo. It is the
> single source of truth for v2. If this file and older notes disagree,
> this file wins. SunHacks 9.0, ASU, Nov 14–15, 2026. Projects due Sun 11:00 AM MST on Devpost.

## 1. Goal

Help people spot misinformation on the webpages they already read
(entertainment sites, social media, news, blogs) and replace it with
verified information from scholarly sources. The extension highlights
suspicious claims directly on the page. Clicking a highlight opens a
popup with the factual correction and source citations. The user can
close the popup at any time; closing never breaks the page.

One-line pitch: "FactLens highlights false info where you already read
it, and gives you the true info from great sources, in one click."

## 2. Users

1. Everyday readers on entertainment / news / social pages who want a
   quick "is this true?" without leaving the page.
2. Students checking a claim before citing it.
3. Hackathon judges / demo audience — the first user to convince.

Out of scope for v2: images, video, audio; editing page content;
auto-correcting the author; non-English pages.

## 3. Core workflow

```
Extract -> Detect -> Retrieve -> Summarize -> Compare -> Display
```

1. **Extract** — content script collects visible text, split into
   paragraphs/blocks. Skip nav, footer, ads, scripts, hidden elements,
   password/email inputs. Keep a reference from each text chunk to its
   DOM node so it can be highlighted later.
2. **Detect** — send chunks (batched, deduplicated, size-capped) to
   Gemini. It returns ONLY structured JSON listing factual assertions
   that are potentially false or misleading. Ignore opinions, jokes,
   subjective statements.
3. **Retrieve** — for each flagged claim above the confidence threshold,
   fetch the top 3 scholarly sources using the keywords (see §7).
4. **Summarize** — Gemini summarizes each source's relevant findings
   in 1–2 sentences.
5. **Compare** — send the original claim + the 3 summarized sources to
   Grok (xAI). It returns JSON: verdict, plain-language explanation,
   which sources support the verdict.
6. **Display** — highlight the claim on the page. On click, show the
   popup: original claim, verdict, corrected info, 3 sources as
   clickable links, close (X) button.

## 4. Architecture (text diagram)

```
Web page
  └─ content.ts (content script)
       ├─ extract chunks -> highlight spans (Shadow DOM popup)
       └─ chrome.runtime.sendMessage ─┐
                                      ▼
                    background.ts (service worker, orchestrator)
                      ├─ cache.ts (claim-hash cache, chrome.storage.local)
                      ├─ blocklist.ts (sensitive pages / domains)
                      ├─ llm.ts (Gemini + Grok clients, strict-JSON parse)
                      ├─ providers.ts (SourceProvider: Scholar / S2 / OpenAlex)
                      └─ DIRECT mode: calls LLM APIs from here
                         PROXY mode: POSTs to server/proxy instead
                                      │
                    server/proxy/server.js (Node/Express, keys live here)
                      ├─ POST /api/detect  { chunks } -> claims
                      ├─ POST /api/factcheck { claim, keywords } -> result
                      └─ POST /api/sources { keywords } -> sources
                                      │
                    External: Gemini API, Grok API, Semantic Scholar,
                    OpenAlex, Google Scholar (scrape attempt, proxy only)
```

Two modes, same message shapes. Direct mode is for dev; proxy mode is
for the demo (keys never ship in the extension). The Options page
chooses the mode and stores the proxy URL.

## 5. File tree (exact — do not rename without updating README + PRD)

```
factlens-v2/
├── PRD.md
├── README.md
├── DEMO_SCRIPT.md
├── KNOWN_LIMITATIONS.md
├── demo-test-page.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.example
├── public/
│   └── manifest.json     # NOTE: manifest lives in public/, not repo root
├── src/
│   ├── types.ts          # Claim, Source, FactCheckResult, message payloads
│   ├── background.ts     # service worker: orchestrate, cache, message passing
│   ├── content.ts        # extraction, highlighting, Shadow DOM popup
│   ├── popup/
│   │   ├── index.html    # NOTE: index.html, not popup.html
│   │   ├── popup.ts      # toggle, Scan this page, status, settings link
│   │   └── popup.css
│   ├── options/
│   │   ├── index.html    # NOTE: index.html, not options.html
│   │   ├── options.ts    # API keys, direct/proxy mode, proxy URL
│   │   └── options.css
│   └── lib/
│       ├── prompts.ts    # the three LLM prompts (§8), verbatim
│       ├── llm.ts        # Gemini + Grok clients, strict-JSON parsing
│       ├── providers.ts  # SourceProvider interface + fallbacks (§7)
│       ├── cache.ts      # claim-hash cache in chrome.storage.local
│       ├── blocklist.ts  # sensitive pages / domains
│       └── json.ts       # shared strict-JSON parse helper (strip fences)
└── server/
    └── proxy/
        ├── package.json
        ├── server.js     # Express proxy: /api/detect, /api/factcheck, /api/sources
        ├── .env.example
        └── README.md
```

## 6. Shared TypeScript types (`src/types.ts`)

```ts
type Verdict = "supported" | "contradicted" | "partially-supported" | "insufficient-evidence";

interface Claim {
  chunkId: string;          // id of the text chunk it came from
  text: string;             // exact verbatim substring of the page
  reason: string;           // why it is suspect (short)
  confidence: number;       // 0..1, from Gemini detection
  keywords: string[];       // 2-4 search keywords
}

interface Source {
  title: string;
  authors: string;          // comma-separated, may be ""
  year: number | null;
  url: string;
  snippet: string;          // abstract / snippet, may be ""
  summary?: string;         // Gemini 1-2 sentence summary
  provider: "google-scholar" | "semantic-scholar" | "openalex" | "none";
}

interface FactCheckResult {
  claim: string;
  verdict: Verdict;
  explanation: string;      // plain language, 1-3 sentences
  correctedInfo: string;    // the factual correction, may be ""
  sources: Source[];        // top 3, each with provider set
  scholarUrl: string;       // https://scholar.google.com/scholar?q=<claim>
}

// Message payloads (content <-> background, popup <-> background)
type Message =
  | { type: "FACTLENS_SCAN" }
  | { type: "FACTLENS_CLEAR" }
  | { type: "FACTLENS_TOGGLE"; enabled: boolean }
  | { type: "FACTCHECK_CLAIM"; claim: Claim }
  | { type: "FACTCHECK_RESULT"; result: FactCheckResult }
  | { type: "FACTLENS_STATUS"; status: string; count: number };
```

Rules: `Claim.text` must be a verbatim substring of the page, or the
content script must refuse to highlight it (no highlight = no broken
match). Verdict is only ever one of the four values above.

## 7. SourceProvider interface + fallback order (`src/lib/providers.ts`)

```ts
interface SourceProvider {
  name: Source["provider"];
  search(keywords: string[], query: string): Promise<Source[]>;
}
```

Fallback order, in both direct and proxy mode:

1. **Google Scholar scrape attempt — proxy only, never in the extension.**
   Scholar has no official API and blocks automated scraping (CAPTCHAs,
   rate limits). Implement it behind `SourceProvider`, expect it to
   fail, catch the failure, and continue. A Scholar failure is normal
   and is never shown to the user as an error. If it succeeds, mark
   those sources `provider: "google-scholar"`.
2. **Semantic Scholar** (free, no key) — primary live provider.
   `GET https://api.semanticscholar.org/graph/v1/paper/search?query=...&fields=title,abstract,year,authors,externalIds,url&limit=3`
3. **OpenAlex** (free, no key) — second fallback.
   `GET https://api.openalex.org/works?search=...&per-page=3`

Every card shows which provider supplied each source, and every card
links to a real Google Scholar search for the exact claim
(`scholarUrl`). Scholar is never scraped from the client, and its
results are never presented as an API result.

## 8. LLM prompts (`src/lib/prompts.ts` — copy verbatim; proxy mirrors them)

Rules for all three calls: request strict JSON, strip code fences
before parsing, validate the shape, retry once on malformed JSON, then
fail gracefully (see §10). Instruct the models: avoid speculation, say
"insufficient evidence" when sources do not address the claim, never
invent citations — only cite sources actually retrieved.

### 8.1 Gemini claim detection

System: `You are a fact-checking assistant. Return ONLY valid JSON, no prose, no code fences. From the text chunks, list ONLY factual assertions that could be false or misleading. Ignore opinions, jokes, questions, and subjective statements. Each claim must be an exact verbatim substring of the supplied text.`

JSON schema:
```json
{"claims": [{"chunkId": "c1", "text": "...", "reason": "...", "confidence": 0.8, "keywords": ["...", "..."]}]}
```
User content: the chunks as `[id] text` lines, max 20 chunks per call.

### 8.2 Gemini source summarization

System: `Summarize ONLY what this source says that is relevant to the claim. 1-2 sentences. Do not speculate. If it does not address the claim, say so.`

JSON schema: `{"summary": "..."}`. One call per source, or one
batched call with an array — either is acceptable, keep the schema.

### 8.3 Grok comparison / verdict

System: `You are a fact-checking judge. Return ONLY valid JSON, no prose, no code fences. Compare the claim ONLY against the supplied sources. Never invent citations. If the sources do not address the claim, verdict is "insufficient-evidence".`

JSON schema:
```json
{"verdict": "supported|contradicted|partially-supported|insufficient-evidence", "explanation": "...", "correctedInfo": "...", "supportingSourceIndexes": [0]}
```
User content: the claim, then the numbered summarized sources.

## 9. Rate-limit, cache, blocklist rules

- Max **5 claims checked per page** (10 absolute max if the user
  re-scans). Detection may flag more; only the top 5 by confidence
  are fact-checked.
- Cache by claim hash in `chrome.storage.local` (`src/lib/cache.ts`):
  identical claim text reuses the stored `FactCheckResult`, no new
  API calls. Cache TTL: 7 days.
- Retry with exponential backoff on 429 / 5xx: 1s, 2s, 4s, then give
  up with a clear message. Never hammer an API in a loop.
- Proxy rate limit: 30 req/min per IP (see `server/proxy/server.js`).
- Blocklist (`src/lib/blocklist.ts`): do not extract or send content
  from banking, email, password fields, or incognito pages. Default
  blocked hosts include `*.bank.*`, `mail.google.com`,
  `outlook.live.com`, plus any URL containing `/login`, `/checkout`,
  `/account`. Content script must check the blocklist before scanning.
- Batching: detection sends at most 20 chunks per Gemini call,
  deduplicated by normalized text.

## 10. UI/UX requirements

- Highlights: subtle background by verdict — red = contradicted,
  orange = partially-supported / uncertain, grey = insufficient
  evidence. Do not alter page layout (inline `<span>`, no block
  changes). Unchecked / pending claims: yellow.
- Popup box: anchored near the clicked highlight, rendered inside a
  **Shadow DOM** so page CSS cannot leak in or out. Clean modern card:
  original claim (italic), verdict badge, corrected info, 3 sources
  as clickable links (with provider label), close (X) button.
- Keyboard: `Esc` closes the popup. Clicking outside closes it.
  Closing must not break the page or re-trigger automatically.
- Loading state: skeleton card ("Checking…") while the verdict loads.
- Progress indicator: small non-intrusive toast — "Scanning… 3 claims
  found" — then "Done: 2 contradicted, 1 needs context".
- Dynamic content: `MutationObserver`, debounced (~1.5s), only scans
  new text nodes; never re-checks already-processed text (track
  processed chunk ids).
- Disclaimer on every card and in the popup footer: "AI-assisted
  results — verify with the sources before sharing."
- Extension popup (toolbar): on/off toggle, "Scan this page" button,
  status line, link to Options.
- Options page: Gemini key, Grok key, mode (Direct / Proxy), proxy
  URL. Keys stored only in `chrome.storage.local`. Never hardcoded,
  never logged, never sent anywhere except the configured LLM / proxy.

## 11. Permissions (`manifest.json`) — minimal, with justification

| Permission | Why |
|------------|-----|
| `activeTab` | Scan only the tab the user is on, when they ask. |
| `storage` | Cache results + store keys / settings locally. |
| `scripting` | Inject the content script on demand (Scan button). |
| `host_permissions: https://api.semanticscholar.org/*`, `https://api.openalex.org/*` | Scholarly fallback APIs, direct mode. |
| `host_permissions: https://generativelanguage.googleapis.com/*`, `https://api.x.ai/*` | Gemini + Grok, direct mode only. |

No `<all_urls>` in the final manifest if avoidable — content scripts
run on `http://*/*` and `https://*/*` via `matches`, which is the
standard pattern for a page-reading extension; document the choice.
No `cookies`, no `history`, no `tabs` (beyond `activeTab`).

## 12. Acceptance criteria / definition of done

- [ ] `npm run build` succeeds; extension loads unpacked with no errors.
- [ ] On `demo-test-page.html`, Scan finds the 3 factual claims and
      does NOT flag the opinion/joke sentence.
- [ ] Clicking a contradicted claim opens the Shadow DOM card with
      verdict, corrected info, 3 clickable sources, provider labels,
      Scholar link, disclaimer, and a working X / Esc close.
- [ ] With no API keys set, the extension still works in demo mode
      (built-in claims + Semantic Scholar) and says so clearly.
- [ ] With the proxy running, proxy mode returns the same result
      shape as direct mode.
- [ ] Scholar scrape failure does not break the flow — fallback
      sources appear, and the card still renders.
- [ ] A 429 from any API shows a clear "rate limited, try again"
      message, not a blank card.
- [ ] No API key appears in any committed file, log, or built bundle.
- [ ] Max 5 claims/page is enforced; re-scanning a page does not
      re-check cached claims.

## 13. Demo script

See `DEMO_SCRIPT.md`. In short: 60-second pitch, then live demo on
`demo-test-page.html` — click "Humans only use 10% of their brain"
(contradicted), then "The Great Wall of China is visible from space"
(contradicted), then "Drinking coffee causes cancer" (partially
supported / needs context). End on the trust rule: no paper found =
"insufficient evidence", never "false".

## 14. Known limitations + next steps

See `KNOWN_LIMITATIONS.md`. Headlines: Scholar scraping is blocked
in practice; LLM verdicts are AI-assisted and can be wrong; Gemini /
Grok need keys and cost money; max 5 claims per page; English only
in v2; no image/video fact-checking; dynamic feeds are best-effort.
Next steps: LLM claim extraction replaces regex heuristics, per-site
settings, user reporting ("this highlight is wrong"), history page,
Firefox port, backend cache to cut API calls.
