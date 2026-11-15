# FalseAlarm

FalseAlarm is a Chrome Manifest V3 research and fact-checking extension. It has
two complementary modes:

- **Research agent:** asks Gemini to plan a small set of searches, looks up
  sources in Wikipedia first (then Semantic Scholar and OpenAlex), opens and
  reads the strongest pages, and answers only from the retrieved evidence.
  The side panel shows each planning, search, open/read, and verification step.
- **Page scan:** highlights potentially misleading factual claims in the page
  you are reading. It keeps the v2 workflow, now using the same
  Wikipedia-first retrieval order.

Every result is AI-assisted. Read the linked sources before relying on or
sharing an answer.

## Local development

Use a recent Node.js release and Chrome 110 or later.

```powershell
npm install
npm run typecheck
npm test
npm run build
```

`npm test` is a local, key-free suite. It uses fake models and page fetches to
exercise JSON validation, page text extraction, source failure handling,
Grok-to-Gemini fallback, quote verification, and agent limits. It never calls
an LLM provider.

The production build creates `dist/` with these Chrome extension entries:

- `background.js` and `content.js`
- `popup/popup.html` and `options/options.html`
- `agent/index.html`
- `manifest.json`

To load it in Chrome, visit `chrome://extensions`, enable **Developer mode**,
choose **Load unpacked**, and select the generated `dist` directory. Reload
the extension after each new build.

## Using the research agent

Open the FalseAlarm side panel and ask a factual question. The trace should
show **Planned searches**, one or more **Searched** steps, **Opened** source
pages, and **Verified** evidence before the answer card appears. Quotes are
kept only when they are verbatim substrings of retrieved page text or a source
snippet. Use **Open in background** to inspect a source without replacing the
current tab.

**Ask about this page** includes only the active page title and URL as context;
it does not send the page body as agent context. It is especially useful on
`demo-test-page.html`.

Try these demo questions with working model credentials:

1. `Do humans only use 10% of their brain?`
2. `Is the Great Wall of China visible from space?`

The intended result for both is **Contradicted**, with a real source and a
verbatim quote. A source search failure produces **Insufficient evidence**;
FalseAlarm does not turn missing evidence into a false claim.

## Page scan and no-key demo

The toolbar popup controls page scanning, clearing highlights, and opening the
agent. On `demo-test-page.html`, a no-key Direct-mode scan recognizes the three
built-in demo statements and does not flag the opinion/joke sentence. It is a
demo fallback, not a model judgment.

With no Gemini key and no reachable proxy, **agent mode deliberately says that
keys are needed** rather than guessing. Scans can still run in the built-in demo
mode when both Direct-mode keys are blank.

## Model and proxy configuration

In **Direct** mode, add a Gemini key in FalseAlarm Options. A Grok key is
optional; Gemini is used if Grok is unavailable. Direct-mode keys live in
`chrome.storage.local` on that browser profile, so proxy mode is preferable for
shared/distributed builds.

For local **Proxy** mode, copy the placeholder file without committing the
result:

```powershell
Copy-Item proxy/.env.example .env
npm run proxy
```

Set `GEMINI_API_KEY`, optionally `GROK_API_KEY` and `OPENALEX_API_KEY`, and an
optional `PROXY_TOKEN` in `.env`. The proxy defaults to
`http://localhost:8787`; enter that URL and the same token in Options. It
offers `/health`, legacy scan routes, and `/api/agent/search`,
`/api/agent/read`, and `/api/agent/ask` routes. Keys remain server-side in
proxy mode and must never be committed or logged.

## Safety, privacy, and limits

- The extension needs no cookies or browser history permission.
- Page scan skips configured banking, email, login/account/checkout, and
  password-field pages. It processes visible text only and never rewrites page
  content.
- Scan results are cached locally for seven days and are capped at five claims
  per page.
- Agent runs use at most three searches, three results per search, six
  deduplicated sources, and three page reads. Page reads have a 15-second
  timeout.
- Google Scholar is linked from scan cards but is never scraped by the
  extension. Wikipedia is searched first, followed by Semantic Scholar and
  OpenAlex when needed.
