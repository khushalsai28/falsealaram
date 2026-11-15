import { fetchRetry } from './net';
// Pure-fetch LLM clients; shared by the extension (direct mode) and the proxy server.

/** Gemini's responseSchema uses an OpenAPI subset: UPPERCASE types, no additionalProperties. */
export function toGeminiSchema(s: any): any {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (s && typeof s === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === 'additionalProperties') continue;
      o[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : toGeminiSchema(v);
    }
    return o;
  }
  return s;
}

export interface LLMArgs { apiKey: string; model: string; system: string; user: string; schema: object }

export async function geminiGenerate(a: LLMArgs): Promise<string> {
  const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${a.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': a.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: a.system }] },
      contents: [{ role: 'user', parts: [{ text: a.user }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: toGeminiSchema(a.schema) },
    }),
  });
  const j: any = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error(`Gemini returned an empty response${j?.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ''}`);
  return text;
}

/** Pull the assistant text and the URLs Grok's web search actually opened. */
export function readGrokResponse(body: unknown): { text: string; citations: string[] } {
  const root = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const texts: string[] = [];
  const citations = new Set<string>();
  const addUrl = (value: unknown) => {
    if (typeof value !== 'string') return;
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'http:' || url.protocol === 'https:') citations.add(url.href);
    } catch { /* ignore non-urls */ }
  };
  if (typeof root.output_text === 'string') texts.push(root.output_text);
  if (Array.isArray(root.citations)) root.citations.forEach(addUrl);
  for (const item of Array.isArray(root.output) ? root.output : []) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    const content = Array.isArray(block.content) ? block.content : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const piece = part as Record<string, unknown>;
      if (typeof piece.text === 'string') texts.push(piece.text);
      for (const note of Array.isArray(piece.annotations) ? piece.annotations : []) {
        if (!note || typeof note !== 'object') continue;
        const ann = note as Record<string, unknown>;
        addUrl(ann.url);
        if (ann.url_citation && typeof ann.url_citation === 'object') addUrl((ann.url_citation as Record<string, unknown>).url);
      }
    }
  }
  return { text: texts.filter(Boolean).join('\n'), citations: [...citations] };
}

/** Grok with server-side web search. Citations are the pages the search opened. */
export async function grokSearch(a: Omit<LLMArgs, 'schema'>): Promise<{ text: string; citations: string[] }> {
  const res = await fetchRetry('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.apiKey}` },
    body: JSON.stringify({
      model: a.model,
      instructions: a.system,
      input: a.user,
      tools: [{ type: 'web_search' }],
      include: ['no_inline_citations'],
    }),
  }, { timeoutMs: 50000, retries: 0 });
  const body: unknown = await res.json();
  const found = readGrokResponse(body);
  if (!found.text) {
    const message = body && typeof body === 'object' ? (body as { error?: { message?: unknown } }).error?.message : '';
    throw new Error(typeof message === 'string' && message ? message : 'Grok web search returned an empty response.');
  }
  return found;
}

export async function grokGenerate(a: LLMArgs): Promise<string> {
  const res = await fetchRetry('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.apiKey}` },
    body: JSON.stringify({
      model: a.model, temperature: 0.1, stream: false,
      messages: [{ role: 'system', content: a.system }, { role: 'user', content: a.user }],
      response_format: { type: 'json_schema', json_schema: { name: 'falsealaram', strict: true, schema: a.schema } },
    }),
  }, { timeoutMs: 60000 });
  const j: any = await res.json();
  const text = j?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Grok returned an empty response');
  return text;
}
