import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPageText, stripHtml } from '../src/lib/web';

test('stripHtml removes executable/non-visible markup and decodes readable text', () => {
  const text = stripHtml('<h1>Evidence &amp; context</h1><script>steal()</script><style>.x{}</style><p>This is a useful paragraph with enough detail to retain.</p>');
  assert.match(text, /Evidence & context/);
  assert.match(text, /useful paragraph/);
  assert.doesNotMatch(text, /steal|\.x/);
});

test('fetchPageText prefers substantial paragraphs and respects the character cap', async () => {
  const html = `<!doctype html><title>Example evidence</title><p>tiny</p><p>This is the substantial evidence paragraph with more than forty characters and a source statement.</p><script>ignored()</script>`;
  let requestInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    requestInit = init;
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const page = await fetchPageText('https://example.test/article', 80, fakeFetch);
  assert.equal(page.title, 'Example evidence');
  assert.match(page.text, /substantial evidence/);
  assert.doesNotMatch(page.text, /ignored/);
  assert.ok(page.text.length <= 80);
  assert.equal(requestInit?.redirect, 'error');
});

test('fetchPageText rejects non-http source URLs before fetching', async () => {
  await assert.rejects(() => fetchPageText('file:///secret.txt'), /Only HTTP\(S\)/);
});

test('fetchPageText rejects local-network source URLs before fetching', async () => {
  await assert.rejects(() => fetchPageText('http://127.0.0.1:8787/private'), /Only public HTTP\(S\)/);
  await assert.rejects(() => fetchPageText('https://localhost/private'), /Only public HTTP\(S\)/);
  await assert.rejects(() => fetchPageText('http://[::1]/private'), /Only public HTTP\(S\)/);
  await assert.rejects(() => fetchPageText('http://[::ffff:127.0.0.1]/private'), /Only public HTTP\(S\)/);
  await assert.rejects(() => fetchPageText('http://[fc00::1]/private'), /Only public HTTP\(S\)/);
});
