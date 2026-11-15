import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgent, type AgentModelClient } from '../src/lib/agent';
import { tryProvidersInOrder, type SourceProvider } from '../src/lib/providers';
import { fetchPageText } from '../src/lib/web';

const pageUrl = 'https://example.test/source';
const evidence = 'People use many regions of the brain during ordinary life.';

function model(answer: object): AgentModelClient {
  return {
    async generate(system) {
      if (system.includes('planner')) return JSON.stringify({
        searches: ['ten percent brain myth', 'brain activity evidence'], intent: 'check a neuroscience claim',
      });
      return JSON.stringify(answer);
    },
  };
}

const provider: SourceProvider = {
  name: 'Wikipedia',
  async search() {
    return [{ title: 'Example', authors: '', year: null, url: pageUrl, snippet: evidence, provider: 'Wikipedia' }];
  },
};

const deps = {
  providers: [provider],
  search: async (providers: SourceProvider[], query: string, limit = 3) => providers[0].search(query, limit),
  readPage: async (url: string) => ({ url, title: 'Example', text: evidence }),
  retryDelays: [],
};

test('agent preserves only verbatim evidence quotes and exposes its trace', async () => {
  const result = await runAgent(model({
    answer: 'The claim is contradicted by the retrieved evidence.', verdict: 'contradicted',
    explanation: 'The source states that many regions are used.', correctedInfo: 'Many brain regions are active.',
    quotes: [{ text: evidence, url: pageUrl }], confidence: 0.9,
  }), undefined, 'Do humans use only 10% of their brain?', undefined, undefined, deps);

  assert.equal(result.verdict, 'contradicted');
  assert.deepEqual(result.quotes, [{ text: evidence, url: pageUrl }]);
  assert.deepEqual(result.steps.map((step) => step.label), ['Planned searches', 'Searched', 'Searched', 'Opened', 'Verified']);
});

test('agent rejects fabricated quotes and falls back to a real evidence sentence', async () => {
  const result = await runAgent(model({
    answer: 'The claim is contradicted.', verdict: 'contradicted', explanation: 'Evidence differs.', correctedInfo: 'Many regions are active.',
    quotes: [{ text: 'A fabricated quotation that is not on the page.', url: pageUrl }], confidence: 0.7,
  }), undefined, 'Do humans use only 10% of their brain?', undefined, undefined, deps);

  assert.equal(result.quotes[0]?.text, evidence);
  assert.equal(result.quotes[0]?.url, pageUrl);
});

test('provider fallback retains a later provider after an earlier failure', async () => {
  const providers: SourceProvider[] = [
    { name: 'Wikipedia', async search() { throw new Error('429'); } },
    { name: 'Semantic Scholar', async search() { return [{ title: 'Paper', authors: '', year: 2024, url: pageUrl, snippet: 'Abstract.', provider: 'Semantic Scholar' }]; } },
  ];
  const results = await tryProvidersInOrder(providers, 'question', 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'Semantic Scholar');
});

test('page reader removes scripts and favours substantive paragraphs', async () => {
  const read = await fetchPageText('https://example.test/page', 4000, async () => new Response(
    '<title>Example &amp; source</title><script>throw new Error()</script><p>short</p><p>This is a substantial paragraph with enough words to be retained in the extracted readable text.</p>',
    { status: 200, headers: { 'content-type': 'text/html' } },
  ));
  assert.equal(read.title, 'Example & source');
  assert.match(read.text, /substantial paragraph/);
  assert.doesNotMatch(read.text, /throw new Error/);
});
