import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from '../src/shared/settings';

test('migrates known retired FalseAlarm defaults without changing custom models', () => {
  const legacy = normalizeSettings({ geminiModel: 'gemini-3.5-flash-lite', grokModel: 'grok-4.7' });
  assert.equal(legacy.geminiModel, 'gemini-3.6-flash');
  assert.equal(legacy.grokModel, 'grok-4');

  const retired = normalizeSettings({ geminiModel: 'gemini-2.0-flash', grokModel: 'grok-4' });
  assert.equal(retired.geminiModel, 'gemini-3.6-flash');
  assert.equal(retired.grokModel, 'grok-4');

  const custom = normalizeSettings({ geminiModel: 'gemini-2.5-flash', grokModel: 'grok-4.1-fast' });
  assert.equal(custom.geminiModel, 'gemini-2.5-flash');
  assert.equal(custom.grokModel, 'grok-4.1-fast');
});
