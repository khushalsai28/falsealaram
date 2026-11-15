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
model keys empty, falsealaram uses its three built-in demo claims and attempts live
Semantic Scholar/OpenAlex source lookup. Demo verdicts are examples, not model
judgments. Opinions and jokes on the page are intentionally not included.

## API modes

- **Direct** stores keys in the browser's `chrome.storage.local`. Gemini is
  required for live checks; Grok is optional and Gemini performs the final
  comparison when Grok is not configured.
- **Proxy** sends model requests to the configured Node server. Keep API keys
  on the server in environment variables; never commit them.
- Google Scholar scraping is a proxy-only best-effort attempt. Semantic
  Scholar is tried next, followed by OpenAlex.

For the local proxy, copy `proxy/.env.example` to `.env` in the project root,
then set `GEMINI_API_KEY` (or the legacy `gemini_token`), plus optionally
`GROK_API_KEY`, `OPENALEX_API_KEY`, and `PROXY_TOKEN` before running:

```powershell
npm run proxy
```

The extension's proxy URL defaults to `http://localhost:8787`. Start the proxy
before selecting Proxy mode, and use the same proxy token in the server
environment and falsealaram Options when configured.

## Safety and limits

- A maximum of five claims are checked per page.
- Banking, email, login/account/checkout pages, password-field pages, and
  incognito contexts are skipped.
- Claim results are cached locally for seven days.
- The extension extracts visible text blocks only; it does not edit page text.
