import type { Settings } from '../shared/types';
import { fetchRetry } from '../shared/net';
import { geminiGenerate, grokGenerate } from '../shared/llm';
import { parseJson } from '../shared/json';
import { resolveKeys } from './config';

export type Kind = 'gemini' | 'grok';

async function rawCall(kind: Kind, s: Settings, system: string, user: string, schema: object): Promise<string> {
  if (s.mode === 'proxy') {
    const res = await fetchRetry(`${s.proxyUrl.replace(/\/$/, '')}/api/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-falsealarm-token': s.proxyToken },
      body: JSON.stringify({ system, user, schema }),
    }, { timeoutMs: 70000 });
    return ((await res.json()) as any).text as string;
  }
  const k = resolveKeys(s);
  const apiKey = kind === 'gemini' ? k.gemini : k.grok;
  if (!apiKey) throw new Error(`Missing ${kind === 'gemini' ? 'Gemini' : 'Grok'} API key - add it in FalseAlarm options.`);
  return kind === 'gemini'
    ? geminiGenerate({ apiKey, model: s.geminiModel, system, user, schema })
    : grokGenerate({ apiKey, model: s.grokModel, system, user, schema });
}

/** Calls the model and returns parsed JSON; retries once if the output is malformed. */
export async function callLLM(kind: Kind, s: Settings, system: string, user: string, schema: object): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const parsed = parseJson(await rawCall(kind, s, system, user, schema));
    if (parsed !== null) return parsed;
    if (attempt >= 1) throw new Error(`${kind} returned malformed JSON`);
  }
}
