import type { Verdict } from './types';

const T = '`'.repeat(3);
const FENCE = new RegExp(`^\\s*${T}(?:json)?\\s*|\\s*${T}\\s*$`, 'gi');

/** Strip code fences, tolerate prose around JSON and trailing commas. Returns null if hopeless. */
export function parseJson(raw: string): unknown {
  const t = (raw ?? '').replace(FENCE, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/[\[{][\s\S]*[\]}]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {
    try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
  }
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null;
const str = (x: unknown, max = 800) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

export function asDetect(raw: unknown) {
  const arr = isObj(raw) && Array.isArray((raw as any).claims) ? (raw as any).claims : Array.isArray(raw) ? raw : [];
  return (arr as unknown[]).filter(isObj).map((c) => ({
    chunkId: str(c.chunkId, 40), text: str(c.text, 1500), reason: str(c.reason, 250),
    confidence: Math.min(1, Math.max(0, Number(c.confidence) || 0)),
    keywords: (Array.isArray(c.keywords) ? c.keywords : []).map((k: unknown) => str(k, 60)).filter(Boolean).slice(0, 4) as string[],
  }));
}
export function asSummaries(raw: unknown): Map<number, string> {
  const m = new Map<number, string>();
  const arr = isObj(raw) && Array.isArray((raw as any).summaries) ? (raw as any).summaries : [];
  for (const s of arr) if (isObj(s) && Number.isInteger(s.n)) m.set(s.n, str(s.summary, 700));
  return m;
}
const safeHttp = (u: string) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const VERDICTS: Verdict[] = ['supported', 'contradicted', 'partially supported', 'insufficient evidence'];
export function asVerdict(raw: unknown, nSources: number) {
  const o = isObj(raw) ? raw : {};
  const v = str(o.verdict, 40).toLowerCase() as Verdict;
  return {
    verdict: VERDICTS.includes(v) ? v : ('insufficient evidence' as Verdict),
    explanation: str(o.explanation, 900) || 'No explanation returned.',
    correction: str(o.correction, 600),
    supportingSources: (Array.isArray(o.supportingSources) ? o.supportingSources : [])
      .filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= nSources) as number[],
  };
}

export function asGrokCheck(raw: unknown) {
  const o = isObj(raw) ? raw : {};
  const v = str(o.verdict, 40).toLowerCase() as Verdict;
  const sources = (Array.isArray(o.sources) ? o.sources : []).filter(isObj).map((s) => ({
    title: str(s.title, 200), url: safeHttp(str(s.url, 400)), summary: str(s.summary, 500),
  })).filter((s) => s.title && s.url).slice(0, 4);
  return {
    verdict: VERDICTS.includes(v) ? v : ('insufficient evidence' as Verdict),
    explanation: str(o.explanation, 900) || 'No explanation returned.',
    correction: str(o.correction, 600),
    sources,
    supportingSources: (Array.isArray(o.supportingSources) ? o.supportingSources : [])
      .filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= sources.length) as number[],
  };
}
