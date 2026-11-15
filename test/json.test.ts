import assert from 'node:assert/strict';
import test from 'node:test';
import { asDetect, normalizeVerdict, safeParseJson } from '../src/shared/json';
import { normalizeSettings } from '../src/shared/settings';

test('normalizes v2 and v3 verdict spellings to the four public values', () => {
  assert.equal(normalizeVerdict('partially-supported'), 'partially_supported');
  assert.equal(normalizeVerdict('insufficient evidence'), 'insufficient_evidence');
  assert.equal(normalizeVerdict('false'), 'contradicted');
  assert.equal(normalizeVerdict('made up'), 'insufficient_evidence');
});

test('parses fenced JSON and accepts the v3 claim field', () => {
  const parsed = safeParseJson('```json\n{"claims":[{"claim":"The sky is green.","chunkId":"c1","reason":"check","confidence":0.8,"keywords":["sky"]}]}\n```');
  const claims = asDetect(parsed);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].text, 'The sky is green.');
  assert.equal(claims[0].chunkId, 'c1');
  assert.deepEqual(claims[0].keywords, ['sky']);
});

test('does not evaluate malformed model output', () => {
  assert.equal(safeParseJson('not JSON; process.exit()'), null);
});

test('migrates only the obsolete default model names in saved extension settings', () => {
  const firstLegacy = normalizeSettings({ geminiModel: 'gemini-3.5-flash-lite', grokModel: 'grok-4.7' });
  assert.equal(firstLegacy.geminiModel, 'gemini-3.6-flash');
  assert.equal(firstLegacy.grokModel, 'grok-4');

  const retired = normalizeSettings({ geminiModel: 'gemini-2.0-flash', grokModel: 'grok-4' });
  assert.equal(retired.geminiModel, 'gemini-3.6-flash');
  assert.equal(retired.grokModel, 'grok-4');

  const custom = normalizeSettings({ geminiModel: 'gemini-2.5-flash', grokModel: 'grok-4.1-fast' });
  assert.equal(custom.geminiModel, 'gemini-2.5-flash');
  assert.equal(custom.grokModel, 'grok-4.1-fast');

  const blank = normalizeSettings({ geminiModel: ' ', grokModel: '' });
  assert.equal(blank.geminiModel, 'gemini-3.6-flash');
  assert.equal(blank.grokModel, 'grok-4');
});
