import assert from 'node:assert/strict';
import test from 'node:test';
import { verdictCopy, verdictDisplay } from '../src/shared/verdict';

test('uses clear true/false-style language without flattening nuanced evidence', () => {
  assert.equal(verdictDisplay('supported'), 'Supported · Likely true');
  assert.equal(verdictDisplay('contradicted'), 'Contradicted · Likely false');
  assert.equal(verdictCopy('partially_supported').finding, 'Partly true');
  assert.equal(verdictCopy('unexpected').finding, 'Unverified');
});
