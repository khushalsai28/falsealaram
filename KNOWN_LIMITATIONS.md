# Known limitations

- Results are AI-assisted and can be wrong. Always inspect the linked sources.
- Direct mode requires both Gemini and Grok API keys. Browser-local keys are
  stored in `chrome.storage.local` and are not encrypted; proxy mode keeps keys
  on the server.
- Source availability, ranking, abstracts, and coverage vary. Retrieved sources
  may address a claim only indirectly, and web fallback results are not always
  scholarly.
- Google Scholar has no official public search API; scraping is best-effort and
  can be blocked.
- The claim limit is configurable up to 20 claims per page. Scanning is limited
  to visible text and dynamic-feed coverage is best-effort.
- Banking, email, login/account/checkout pages, visible password fields, and
  incognito contexts are skipped.
- Images, audio, video, and page rewriting are out of scope.
