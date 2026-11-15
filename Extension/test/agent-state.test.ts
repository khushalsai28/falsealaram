import assert from 'node:assert/strict';
import test from 'node:test';

const session: Record<string, unknown> = {};

(globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
  storage: {
    session: {
      async get(key: string) { return { [key]: session[key] }; },
      async set(values: Record<string, unknown>) { Object.assign(session, values); },
    },
    local: {
      async get(key: string) { return { [key]: session[key] }; },
      async set(values: Record<string, unknown>) { Object.assign(session, values); },
    },
  },
};

const { agentRunKey, getAgentRun, saveAgentRun } = await import('../src/shared/agent-state');

test('keeps a completed agent result scoped to its tab for side-panel hydration', async () => {
  const tabId = 71;
  const result = {
    query: 'Does this have a result?',
    answer: 'Yes, a stored result is available.',
    verdict: 'supported' as const,
    explanation: 'It was persisted before the runtime broadcast.',
    correctedInfo: '',
    sources: [],
    quotes: [],
    steps: [{ label: 'Verified', detail: '1 source' }],
    confidence: 1,
  };

  await saveAgentRun(tabId, { status: 'running', query: result.query, updatedAt: 1 });
  assert.equal((await getAgentRun(tabId))?.status, 'running');

  await saveAgentRun(tabId, { status: 'complete', query: result.query, result, updatedAt: 2 });
  assert.deepEqual(await getAgentRun(tabId), { status: 'complete', query: result.query, result, updatedAt: 2 });
  assert.equal(agentRunKey(tabId), 'falsealarm:agent-run:71');
});
