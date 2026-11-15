# FactLens proxy

The proxy keeps Gemini and Grok credentials on the server. It exposes:

- `POST /api/detect` with `{ "chunks": [{ "id": "c1", "text": "..." }] }`
- `POST /api/factcheck` with `{ "claim": { ... }, "keywords": ["..."] }`
- `POST /api/sources` with `{ "query": "...", "keywords": ["..."] }`

Install and run:

```sh
npm install
copy .env.example .env
# Set GEMINI_API_KEY and GROK_API_KEY in .env
npm start
```

The server applies a 30-request-per-minute IP limit. Google Scholar scraping
is best-effort and failures automatically fall back to Semantic Scholar and
OpenAlex. Keep the proxy behind HTTPS and restrict its network access before
using it outside a local demo.
