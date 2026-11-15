import assert from 'node:assert/strict';
import test from 'node:test';
import { searchSources } from '../src/background/providers';

test('uses OpenAlex before falling back to web sources', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.openalex.org')) {
      return new Response(JSON.stringify({ results: [{
        title: 'OpenAlex evidence', publication_year: 2024,
        authorships: [{ author: { display_name: 'Researcher' } }],
        doi: 'https://doi.org/10.1000/example',
        abstract_inverted_index: { Evidence: [0], supports: [1], review: [2] },
      }] }), { status: 200 });
    }
    throw new Error(`Unexpected source request: ${url}`);
  };
  try {
    const sources = await searchSources(['test claim'], { scholar: false, limit: 1 });
    assert.equal(sources[0]?.provider, 'OpenAlex');
    assert.ok(!calls.some((url) => url.includes('wikipedia.org') || url.includes('duckduckgo.com')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses Wikipedia and DuckDuckGo only when scholarly search is empty', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.openalex.org')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    if (url.includes('en.wikipedia.org') && url.includes('list=search')) {
      return new Response(JSON.stringify({ query: { search: [{ title: 'Evidence page', pageid: 1, snippet: 'Fallback evidence' }] } }), { status: 200 });
    }
    if (url.includes('en.wikipedia.org') && url.includes('prop=extracts')) {
      return new Response(JSON.stringify({ query: { pages: { 1: { extract: 'Wikipedia fallback evidence.' } } } }), { status: 200 });
    }
    if (url.includes('html.duckduckgo.com')) {
      return new Response('<div class="result__body"><a class="result__a" href="https://example.test/evidence">Independent evidence</a><a class="result__snippet">Web fallback evidence</a></div>', { status: 200 });
    }
    throw new Error(`Unexpected source request: ${url}`);
  };
  try {
    const sources = await searchSources(['test claim'], { scholar: false, limit: 2 });
    assert.ok(sources.length > 0);
    assert.ok(sources.every((source) => source.provider === 'Web'));
    assert.ok(calls.some((url) => url.includes('en.wikipedia.org')));
    assert.ok(calls.some((url) => url.includes('html.duckduckgo.com')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
