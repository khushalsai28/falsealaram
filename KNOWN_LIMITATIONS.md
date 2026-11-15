# Known limitations

- Results are AI-assisted and can be wrong. Inspect the supplied sources before
  treating an answer as reliable.
- Live agent research needs a Gemini key or a configured proxy. Grok is
  optional and Gemini is the fallback. Without either, the agent reports that
  it needs keys instead of inventing an answer.
- Wikipedia is searched first, followed by Semantic Scholar and OpenAlex.
  Rankings, availability, abstracts, and page accessibility can vary. Some
  non-Wikipedia result pages may reject browser reading because of their own
  CORS, bot, or access policies.
- Google Scholar has no supported public search API. FalseAlarm never scrapes
  Scholar in the extension; scan cards provide a real Scholar search link.
- An agent run is intentionally bounded: three searches, three results per
  search, six deduplicated sources, three page reads, and 15 seconds per page
  read. These limits prioritize a quick, inspectable demo over exhaustive
  research.
- Scan mode checks at most five claims per page, supports English text only,
  and handles dynamic feeds on a best-effort basis.
- Images, video, audio, editing webpage content, operating the desktop outside
  Chrome, and Google Scholar scraping are out of scope.
- Direct-mode API keys are stored in `chrome.storage.local` and are not
  encrypted. Proxy mode is recommended when distributing the extension. Proxy
  operators remain responsible for securing their host and environment.
- The extension does not use cookies or browser history permissions. Page scan
  skips sensitive paths and password-field pages, but users should still avoid
  requesting research about sensitive information.
