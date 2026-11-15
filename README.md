# FactLens

FactLens is a Manifest V3 browser extension that highlights potentially
misleading factual claims on a page and lets you compare them with scholarly
sources. Claims and assessments are AI-assisted; always verify the cited
sources before sharing.

## Build and install

1. Install Node.js 20 or newer.
2. Run `npm install`, then `npm run build`.
3. In Chrome, open `chrome://extensions`, enable Developer mode, and choose
   **Load unpacked**. Select this repository's `dist` folder.
4. Open **FactLens settings** from the extension popup.
   - Direct mode: enter Gemini and Grok API keys. Keys are stored in the
     browser's `chrome.storage.local` and are sent only to those providers.
   - Proxy mode: set the URL of a separately hosted FactLens proxy. Proxy
     credentials remain on that server.
5. Visit a normal HTTP(S) page and choose **Scan this page**. Click a highlight
   to open its fact-check card.

For the local `demo-test-page.html`, enable **Allow access to file URLs** in
the extension's details page before scanning.

Without both keys, direct mode uses a clearly labeled demo detector and
predefined demo assessments for three sample claims. Scholarly source lookup
still uses Semantic Scholar, with OpenAlex as a fallback. Demo assessments are
not generated from the sources returned for each page; do not treat them as
personalized model fact-checks.

## Proxy

See [server/proxy/README.md](./server/proxy/README.md) for setup. The proxy
implements `/api/detect`, `/api/factcheck`, and `/api/sources`, with a
30-request-per-minute rate limit. Use HTTPS and secure the server before
deploying it publicly.

## Permissions and privacy

FactLens requests `activeTab`, `scripting`, `storage`, and host access to the
AI and scholarly APIs. It does not request broad `<all_urls>` access: the page
script is injected only after the user opens the extension and starts a scan,
when `activeTab` grants access to that page. It does not use cookies, browsing
history, or tab history. Banking, sign-in, checkout, account, and selected
email pages are blocked. Only visible page text selected for scanning is sent
to the configured AI service. Proxy mode requests access only to the origin
entered in Options.

## Development

- `npm run build` type-checks and builds the extension into `dist/`.
- `demo-test-page.html` contains the three sample claims for a manual demo.
- See [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) and
  [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).
