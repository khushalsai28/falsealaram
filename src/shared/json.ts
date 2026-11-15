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

/** Safe agent-facing variant: accepts an already parsed object, never evaluates text. */
export function safeParseJson(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  return typeof raw === 'string' ? parseJson(raw) : null;
}

const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null;
const str = (x: unknown, max = 800) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

export function asDetect(raw: unknown) {
  const arr = isObj(raw) && Array.isArray((raw as any).claims) ? (raw as any).claims : Array.isArray(raw) ? raw : [];
  return (arr as unknown[]).filter(isObj).map((c) => ({
    chunkId: str(c.chunkId, 40), text: str(c.claim ?? c.text, 1500), reason: str(c.reason, 250),
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

/** Normalize older underscore/hyphen spellings to the scan pipeline's canonical values. */
export function normalizeVerdict(value: unknown): Verdict {
  const v = str(value, 80).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  switch (v) {
    case 'supported': return 'supported';
    case 'contradicted':
    case 'false': return 'contradicted';
    case 'partially supported':
    case 'partiallysupport': return 'partially supported';
    case 'insufficient evidence':
    case 'insufficient':
    case 'unknown': return 'insufficient evidence';
    default: return 'insufficient evidence';
  }
}

export function clampConfidence(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function stringOrEmpty(value: unknown, max = 1200): string {
  return str(value, max);
}

export function objectOrEmpty(value: unknown): Record<string, unknown> {
  return isObj(value) && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function asVerdict(raw: unknown, nSources: number) {
  const o = isObj(raw) ? raw : {};
  return {
    verdict: normalizeVerdict(o.verdict),
    explanation: str(o.explanation, 900) || 'No explanation returned.',
    correction: str(o.correction, 600),
    supportingSources: (Array.isArray(o.supportingSources) ? o.supportingSources : [])
      .filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= nSources) as number[],
  };
}

export function asGrokCheck(raw: unknown) {
  const o = isObj(raw) ? raw : {};
  const sources = (Array.isArray(o.sources) ? o.sources : []).filter(isObj).map((s) => ({
    title: str(s.title, 200), url: safeHttp(str(s.url, 400)), summary: str(s.summary, 500),
  })).filter((s) => s.title && s.url).slice(0, 4);
  return {
    verdict: normalizeVerdict(o.verdict),
    explanation: str(o.explanation, 900) || 'No explanation returned.',
    correction: str(o.correction, 600),
    sources,
    supportingSources: (Array.isArray(o.supportingSources) ? o.supportingSources : [])
      .filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= sources.length) as number[],
  };
}
