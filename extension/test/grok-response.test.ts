import assert from 'node:assert/strict';
import test from 'node:test';
import { readGrokResponse } from '../src/shared/llm';

test('reads Grok response text and citation URLs', () => {
  const found = readGrokResponse({
    output_text: '{"verdict":"contradicted"}',
    citations: ['https://example.org/study', 'not a url'],
    output: [{
      content: [{
        type: 'output_text',
        text: 'ignored when output_text exists',
        annotations: [{ url_citation: { url: 'https://example.org/paper' } }],
      }],
    }],
  });
  assert.match(found.text, /contradicted/);
  assert.deepEqual(found.citations, ['https://example.org/study', 'https://example.org/paper']);
});
