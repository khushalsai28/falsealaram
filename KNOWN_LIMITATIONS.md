# Known limitations

- Results are AI-assisted and can be wrong. Always inspect the linked papers.
- Direct model checks require a Gemini API key; Grok is optional because Gemini
  can also perform the final comparison. The no-key demo only recognizes three
  built-in example claims and does not generalize to other page text.
- Semantic Scholar and OpenAlex availability, ranking, abstracts, and coverage
  vary. A source may be relevant only indirectly.
- Google Scholar has no official public search API; proxy scraping is
  best-effort and can be blocked. Semantic Scholar and OpenAlex are fallbacks.
- falsealaram checks at most five claims per page and supports English text only.
- Images, audio, video, and page rewriting are out of scope.
- Dynamic-feed scanning is best-effort and only processes newly added text
  blocks.
- Browser-local API keys are stored in `chrome.storage.local` and are not
  encrypted. Proxy mode is recommended when distributing the extension.
