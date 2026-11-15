import type { Settings } from '../shared/types';
import { fetchRetry } from '../shared/net';
import { geminiGenerate, grokGenerate } from '../shared/llm';
import { parseJson } from '../shared/json';
import { resolveKeys } from './config';

export type Kind = 'gemini' | 'grok';

function validAgainstSchema(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
  const rule = schema as Record<string, unknown>;
  switch (rule.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const object = value as Record<string, unknown>;
      const required = Array.isArray(rule.required) ? rule.required : [];
      const properties = rule.properties && typeof rule.properties === 'object'
        ? rule.properties as Record<string, unknown> : {};
      if (required.some((key) => typeof key !== 'string' || !(key in object))) return false;
      if (rule.additionalProperties === false && Object.keys(object).some((key) => !(key in properties))) return false;
      return Object.entries(object).every(([key, item]) =>
        !(key in properties) || validAgainstSchema(item, properties[key]));
    }
    case 'array':
      return Array.isArray(value) && value.every((item) => validAgainstSchema(item, rule.items));
    case 'string':
      return typeof value === 'string' && (!Array.isArray(rule.enum) || rule.enum.includes(value));
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    default:
      return true;
  }
}

async function rawCall(kind: Kind, s: Settings, system: string, user: string, schema: object): Promise<string> {
  if (s.mode === 'proxy') {
    let res: Response;
    try {
      res = await fetchRetry(`${s.proxyUrl.replace(/\/$/, '')}/api/${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-falsealaram-token': s.proxyToken },
        body: JSON.stringify({ system, user, schema }),
      }, { timeoutMs: 70000 });
    } catch (e) {
      if (e instanceof TypeError || /fetch failed|network/i.test(String((e as Error)?.message ?? e)))
        throw new Error(`Could not reach the falsealaram proxy at ${s.proxyUrl}. Start it with npm run proxy.`);
      throw e;
    }
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).text !== 'string')
      throw new Error(`Proxy returned an invalid ${kind} response.`);
    return (body as { text: string }).text;
  }
  const k = resolveKeys(s);
  // Gemini is the required live provider. Grok improves the final comparison when
  // available, but a Gemini-only setup should still be able to fact-check a page.
  if (kind === 'gemini' || !k.grok) {
    if (!k.gemini) throw new Error('Missing Gemini API key - add it in falsealaram options.');
    return geminiGenerate({ apiKey: k.gemini, model: s.geminiModel, system, user, schema });
  }
  return grokGenerate({ apiKey: k.grok, model: s.grokModel, system, user, schema });
}

/** Calls the model and returns parsed JSON; retries once if the output is malformed. */
export async function callLLM(kind: Kind, s: Settings, system: string, user: string, schema: object): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const parsed = parseJson(await rawCall(kind, s, system, user, schema));
    if (parsed !== null && validAgainstSchema(parsed, schema)) return parsed;
    if (attempt >= 1) throw new Error(`${kind} returned malformed or invalid JSON`);
  }
}
