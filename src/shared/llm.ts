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
