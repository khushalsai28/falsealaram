# Known limitations

- Google Scholar has no public search API and commonly blocks automated
  requests. The proxy attempts it, then falls back to Semantic Scholar and
  OpenAlex; direct mode never scrapes Scholar.
- Demo verdicts are fixed examples, not per-claim assessments grounded in the
  live sources. Model-generated results can also be wrong; verify sources.
- Gemini and Grok require API keys and may incur costs. Direct-mode keys are
  saved in local extension storage; proxy keys should be protected server-side.
- A page scan checks at most five claims at a time and ten in a content-script
  session. The seven-day local claim cache is not synchronized across devices.
- Extraction is best-effort on dynamic pages and does not check images, video,
  audio, non-English pages, or content in inaccessible browser pages.
- The sensitive-page blocklist is conservative but cannot identify every
  private or sensitive site.
