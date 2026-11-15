import type { Verdict } from './types';

const T = '`'.repeat(3);
const FENCE = new RegExp(`^\\s*${T}(?:json)?\\s*|\\s*${T}\\s*$`, 'gi');

/**
 * Extract a JSON object/array from a model response without ever evaluating
 * text. Models sometimes wrap valid JSON in a Markdown fence despite being
 * asked not to; no other prose is trusted.
 */
export function safeParseJson(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.replace(FENCE, '').trim();
  try { return JSON.parse(text); } catch { /* fall through */ }

  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');
  const first = firstObject < 0 ? firstArray : firstArray < 0 ? firstObject : Math.min(firstObject, firstArray);
  const lastObject = text.lastIndexOf('}');
  const lastArray = text.lastIndexOf(']');
  const last = Math.max(lastObject, lastArray);
  if (first < 0 || last <= first) return null;
  const candidate = text.slice(first, last + 1);
  try { return JSON.parse(candidate); } catch {
    // This is intentionally the sole leniency: a trailing comma is a common
    // harmless LLM formatting error. Never attempt repair beyond that.
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
  }
}

/** Backwards-compatible spelling used by the existing LLM wrapper. */
export const parseJson = safeParseJson;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const stringValue = (x: unknown, max = 800) => typeof x === 'string' ? x.trim().slice(0, max) : '';

/** Normalise both legacy hyphenated values and model variations to v3 values. */
export function normalizeVerdict(value: unknown): Verdict {
  const v = stringValue(value, 80).toLowerCase().replace(/[\s-]+/g, '_');
  switch (v) {
    case 'supported': return 'supported';
    case 'contradicted':
    case 'false': return 'contradicted';
    case 'partially_supported':
    case 'partiallysupport': return 'partially_supported';
    case 'insufficient_evidence':
    case 'insufficient':
    case 'unknown': return 'insufficient_evidence';
    default: return 'insufficient_evidence';
  }
}

export function asDetect(raw: unknown) {
  const arr = isObj(raw) && Array.isArray(raw.claims) ? raw.claims : Array.isArray(raw) ? raw : [];
  return arr.filter(isObj).map((c) => ({
    chunkId: stringValue(c.chunkId, 80),
    // v2 sent/received `text`; v3 calls it `claim`.
    text: stringValue(c.claim ?? c.text, 400),
    reason: stringValue(c.reason, 250),
    confidence: Math.min(1, Math.max(0, Number(c.confidence) || 0)),
    keywords: (Array.isArray(c.keywords) ? c.keywords : [])
      .map((k) => stringValue(k, 60)).filter(Boolean).slice(0, 4),
  }));
}

/** Legacy helper for the v2 scan pipeline's ordinal source summaries. */
export function asSummaries(raw: unknown): Map<number, string> {
  const summaries = isObj(raw) && Array.isArray(raw.summaries) ? raw.summaries : [];
  const out = new Map<number, string>();
  for (const item of summaries) {
    if (!isObj(item) || !Number.isInteger(item.n)) continue;
    out.set(item.n as number, stringValue(item.summary, 800));
  }
  return out;
}

/** v3 helper, which keys model summaries by retrieved source URL. */
export function asSummariesByUrl(raw: unknown): Map<string, string> {
  const summaries = isObj(raw) && Array.isArray(raw.summaries) ? raw.summaries : [];
  const out = new Map<string, string>();
  for (const item of summaries) {
    if (!isObj(item)) continue;
    const url = stringValue(item.url, 4096);
    const summary = stringValue(item.summary, 800);
    if (url && summary) out.set(url, summary);
  }
  return out;
}

/**
 * Scan-mode shape normalizer. It accepts the v3 field spelling while keeping
 * the old correction/supporting-index result useful during migration.
 */
export function asVerdict(raw: unknown, nSources: number) {
  const o = isObj(raw) ? raw : {};
  const supportingSources = Array.isArray(o.supportingSources) ? o.supportingSources : [];
  return {
    verdict: normalizeVerdict(o.verdict),
    explanation: stringValue(o.explanation, 900) || 'No explanation returned.',
    correction: stringValue(o.correctedInfo ?? o.correction, 600),
    supportingSources: supportingSources
      .filter((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= nSources) as number[],
  };
}

export function clampConfidence(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function stringOrEmpty(value: unknown, max = 1200): string {
  return stringValue(value, max);
}

export function objectOrEmpty(value: unknown): Record<string, unknown> {
  return isObj(value) ? value : {};
}
