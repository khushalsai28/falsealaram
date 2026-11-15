import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgent, type AgentModelClient } from '../src/lib/agent';
import type { Source } from '../src/shared/types';

const sampleSource = (suffix = 'one', snippet = 'Brain imaging shows activity across many brain regions during ordinary life.'): Source => ({
  title: `Evidence ${suffix}`,
  authors: 'Researcher',
  year: 2025,
  url: `https://example.test/${suffix}`,
  snippet,
  provider: 'Wikipedia',
});

const answerFor = (url: string, quotes: Array<{ text: string; url: string }> = []) => ({
  answer: 'The evidence does not support the claim.',
  verdict: 'contradicted',
  explanation: 'The supplied source describes widespread brain activity.',
  correctedInfo: 'People use many parts of the brain over time.',
  quotes,
  confidence: 0.9,
});

function modelFor(answer: Record<string, unknown>, searches = ['brain myth evidence', 'brain activity research']): AgentModelClient {
  return {
    async generate(_system, user) {
      const payload = JSON.parse(user) as { evidence?: unknown[] };
      return payload.evidence ? answer : { searches, intent: 'check a factual claim' };
    },
  };
}

test('uses the original question when planning fails, then records transparent steps', async () => {
  const calls: string[] = [];
  let modelCalls = 0;
  const gemini: AgentModelClient = {
    async generate(_system, user) {
      modelCalls++;
      if (modelCalls === 1) throw new Error('temporary planner failure');
      return answerFor('https://example.test/one');
    },
  };
  const result = await runAgent(gemini, undefined, 'Do humans only use 10% of their brain?', undefined, undefined, {
    providers: [],
    retryDelays: [],
    search: async (_providers, query) => { calls.push(query); return [sampleSource()]; },
    readPage: async (url) => ({ url, title: 'Brain evidence', text: 'Brain imaging shows activity across many brain regions during ordinary life.' }),
  });
  assert.deepEqual(calls, ['Do humans only use 10% of their brain?']);
  assert.equal(result.verdict, 'contradicted');
  assert.equal(result.steps[0].label, 'Planned searches');
  assert.ok(result.steps.some((step) => step.label === 'Opened'));
  assert.equal(result.steps.at(-1)?.label, 'Verified');
});

test('returns insufficient evidence rather than guessing when no source is found', async () => {
  const result = await runAgent(modelFor(answerFor('https://example.test/one')), undefined, 'Unanswerable question', undefined, undefined, {
    providers: [], retryDelays: [], search: async () => [],
  });
  assert.equal(result.verdict, 'insufficient_evidence');
  assert.match(result.answer, /could not find a source/i);
  assert.equal(result.sources.length, 0);
});

test('uses a source snippet when reading a page fails and keeps only a real quote', async () => {
  const snippet = 'Brain imaging shows activity across many brain regions during ordinary life.';
  const source = sampleSource('read-failure', snippet);
  const result = await runAgent(
    modelFor(answerFor(source.url, [{ text: snippet, url: source.url }])),
    undefined,
    'Do humans only use 10 percent of their brain?',
    undefined,
    undefined,
    { providers: [], retryDelays: [], search: async () => [source], readPage: async () => { throw new Error('offline'); } },
  );
  assert.equal(result.quotes[0]?.text, snippet);
  assert.match(result.steps.find((step) => step.label === 'Opened')?.detail ?? '', /could not read/i);
});

test('falls back from a failing Grok client to Gemini', async () => {
  const gemini = modelFor(answerFor('https://example.test/one'));
  const grok: AgentModelClient = { generate: async () => { throw new Error('HTTP 503'); } };
  const result = await runAgent(gemini, grok, 'Can this be checked?', undefined, undefined, {
    providers: [], retryDelays: [], search: async () => [sampleSource()],
    readPage: async (url) => ({ url, title: 'Evidence', text: 'Brain imaging shows activity across many brain regions during ordinary life.' }),
  });
  assert.equal(result.verdict, 'contradicted');
  assert.equal(result.answer, 'The evidence does not support the claim.');
});

test('rejects invented quotes and falls back to a verbatim evidence sentence', async () => {
  const source = sampleSource('quotes');
  const pageText = 'Brain imaging shows activity across many brain regions during ordinary life. This is the only supplied evidence.';
  const result = await runAgent(
    modelFor(answerFor(source.url, [{ text: 'A fabricated quotation that is not in evidence.', url: source.url }])),
    undefined,
    'What does brain imaging show?',
    undefined,
    undefined,
    { providers: [], retryDelays: [], search: async () => [source], readPage: async (url) => ({ url, title: 'Evidence', text: pageText }) },
  );
  assert.equal(result.quotes.length, 1);
  assert.ok(pageText.includes(result.quotes[0].text));
  assert.notEqual(result.quotes[0].text, 'A fabricated quotation that is not in evidence.');
});

test('caps gathered sources at six and page reads at three', async () => {
  let reads = 0;
  const searchQueries: string[] = [];
  const result = await runAgent(modelFor(answerFor('https://example.test/a'), ['first evidence', 'second evidence', 'third evidence']), undefined, 'Question', undefined, undefined, {
    providers: [],
    retryDelays: [],
    search: async (_providers, query) => {
      searchQueries.push(query);
      return ['a', 'b', 'c'].map((suffix) => sampleSource(`${query.replace(/\s+/g, '-')}-${suffix}`));
    },
    readPage: async (url) => {
      reads++;
      return { url, title: 'Evidence', text: 'A source sentence about evidence and context for this question.' };
    },
  });
  assert.equal(result.sources.length, 6);
  assert.equal(reads, 3);
  assert.equal(searchQueries.length, 2);
});

function answerFailureModel(message: string): AgentModelClient {
  return {
    async generate(system) {
      if (system.includes('planner')) {
        return { searches: ['claim source check', 'claim counter evidence'], intent: 'verify a factual claim' };
      }
      throw new Error(message);
    },
  };
}

async function resultForModelFailure(message: string) {
  return runAgent(answerFailureModel(message), undefined, 'Can this claim be checked?', undefined, undefined, {
    providers: [],
    retryDelays: [],
    search: async () => [sampleSource('configuration')],
    readPage: async (url) => ({
      url,
      title: 'Evidence',
      text: 'This source contains enough concrete evidence for a model answer.',
    }),
  });
}

test('explains that a missing model key needs configuration instead of returning a blank answer', async () => {
  const result = await resultForModelFailure('Missing Gemini API key');
  assert.equal(result.verdict, 'insufficient_evidence');
  assert.match(result.answer, /API keys are needed/i);
  assert.equal(result.error, result.answer);
});

test('explains invalid or unauthorized model credentials', async () => {
  const result = await resultForModelFailure('HTTP 401: API key invalid or not authorized');
  assert.equal(result.verdict, 'insufficient_evidence');
  assert.match(result.answer, /API key.*(invalid|not authorized)/i);
  assert.equal(result.error, result.answer);
});

test('explains when the configured model is unavailable', async () => {
  const result = await resultForModelFailure('HTTP 404: Model or endpoint not found');
  assert.equal(result.verdict, 'insufficient_evidence');
  assert.match(result.answer, /model.*not found|model.*unavailable/i);
  assert.equal(result.error, result.answer);
});

test('explains a rate limit rather than returning a blank answer', async () => {
  const result = await resultForModelFailure('HTTP 429: Too many requests');
  assert.equal(result.verdict, 'insufficient_evidence');
  assert.match(result.answer, /rate limited/i);
  assert.equal(result.error, result.answer);
});
