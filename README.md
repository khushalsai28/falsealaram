# falsealaram

falsealaram is a Chrome Manifest V3 extension that highlights questionable factual
claims on webpages and links readers to scholarly sources. Results are
AI-assisted; verify the cited material before sharing.

## Build and install

```powershell
npm install
npm run build
```

In Chrome, open `chrome://extensions`, enable Developer mode, select **Load
unpacked**, and choose the generated `dist` folder.

## Demo

Open `test/demo.html` (or `dist/demo-test-page.html` after building), open the
falsealaram toolbar popup, and select **Scan this page**. With both Direct-mode
model keys empty, the three built-in demo claims get example verdicts, and other
checkable statements on the page are flagged for a live Semantic Scholar/OpenAlex
lookup. Example verdicts are not model judgments. Opinions and jokes are skipped.

## API modes

- **Direct** sends page text to Gemini for claim detection and comparison data
  to Grok. Keys are stored in the browser's `chrome.storage.local`.
- **Proxy** sends model requests to the configured Node server. Keep API keys
  on the server in environment variables; never commit them.
- Google Scholar scraping is a proxy-only best-effort attempt. Semantic
  Scholar is tried next, followed by OpenAlex.

For the local proxy, copy `proxy/.env.example` to `.env` in the project root,
then set `GEMINI_API_KEY`, `GROK_API_KEY`, and optionally
`OPENALEX_API_KEY` and `PROXY_TOKEN` before running:

```powershell
npm run proxy
```

The extension's proxy URL defaults to `http://localhost:8787`. Use the same
proxy token in the server environment and falsealaram Options when configured.

## Safety and limits

- A maximum of five claims are checked per page.
- Banking, email, login/account/checkout pages, password-field pages, and
  incognito contexts are skipped.
- Claim results are cached locally for seven days.
- The extension extracts visible text blocks only; it does not edit page text.