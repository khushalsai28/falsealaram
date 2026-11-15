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
FalseAlarm toolbar popup, and select **Scan this page**. Direct mode requires
Gemini and Grok API keys in Options; alternatively, configure and start the proxy
server. Check the linked sources before relying on any result.

## API modes

- **Direct** requires Gemini and Grok API keys, stored in the browser's
  `chrome.storage.local`.
- **Proxy** sends model requests to the configured Node server. Keep API keys
  on the server in environment variables; never commit them.
- Source search uses Google Scholar when enabled, then OpenAlex. Wikipedia and
  DuckDuckGo results are used as fallbacks; Google Scholar scraping is best-effort
  and can be blocked.

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

- The claim limit is configurable (default 12, maximum 20).
- Banking, email, login/account/checkout pages, password-field pages, and
  incognito contexts are skipped.
- Claim results are cached locally for seven days.
- The extension extracts visible text blocks only; it does not edit page text.
