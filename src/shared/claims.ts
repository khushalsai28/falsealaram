import { normalizeText } from './text';

export interface LocalClaim {
  chunkId: string;
  text: string;
  keywords: string[];
  reason: string;
}

const STOP = new Set([
  'about', 'after', 'again', 'against', 'also', 'although', 'among', 'because', 'been', 'before', 'being',
  'between', 'both', 'claim', 'claimed', 'claims', 'could', 'during', 'each', 'from', 'have', 'having',
  'into', 'just', 'more', 'most', 'much', 'only', 'other', 'others', 'over', 'said', 'same', 'some',
  'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'under',
  'were', 'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
]);

// Extraordinary or commonly misreported assertions. "causes of" is a topic label, not a causal claim.
const ASSERTS = /\b(?:were|was|is|are|been)\s+(?:a\s+|an\s+|all\s+)?(?:hoax(?:ed|es)?|faked|staged|fabricated)\b|\b(?:fak(?:e|ed) the|never went|did not actually|cures?|proven to|scientifically proven|(?:is |are |was |were )?caused by|causes?\s+(?!of\b)|only use|visible from space|cover-?up|swindle)\b/i;
const PERCENT = /\b\d+(?:\.\d+)?\s?(?:%|percent)\b/i;
const LIKELIHOOD = /\b(?:chance|probability|only|always|never|everyone|nobody)\b/i;
const OPINION = /\b(?:i think|in my opinion|my favorite|my favourite|best song|joke made me laugh|i love|i hate)\b/i;
const REBUTTAL = /\b(?:rebutt|pseudoscience|demonstrably false|third-party evidence|debunked|no credible evidence)\b/i;
const QUESTION = /\?\s*$/;

/** True when `quote` is a verbatim claim inside `chunk`, ignoring case, quotes, and spacing. */
export function quoteInText(chunk: string, quote: string): boolean {
  const needle = normalizeText(quote);
  if (needle.length < 15) return false;
  if (chunk.includes(quote)) return true;
  return normalizeText(chunk).includes(needle);
}

function signals(sentence: string): number {
  if (OPINION.test(sentence) || QUESTION.test(sentence)) return 0;
  if (sentence.length < 20 || sentence.length > 420) return 0;
  const words = sentence.split(/\s+/).length;
  if (words < 4 || words > 70) return 0;
  const asserts = ASSERTS.test(sentence);
  if (REBUTTAL.test(sentence) && !asserts) return 0;
  const percent = PERCENT.test(sentence);
  let score = 0;
  if (asserts) score += 3;
  if (percent && (asserts || LIKELIHOOD.test(sentence))) score += 3;
  return score >= 3 ? score : 0;
}

function keywordsFor(sentence: string): string[] {
  const words = sentence.replace(/[^A-Za-z0-9%+-]+/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9%]+$/g, '');
    if (key.length < 4 || STOP.has(key) || out.includes(key)) continue;
    out.push(key);
  }
  return out.sort((a, b) => b.length - a.length).slice(0, 4);
}

function sentences(text: string): string[] {
  const clean = text.replace(/\[\d+\]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.split(/(?<=[.!])\s+(?=[A-Z“"'])/).map((part) => part.trim()).filter(Boolean);
}

function reasonFor(sentence: string): string {
  if (PERCENT.test(sentence)) return 'States a numeric or percentage claim that can be checked against research.';
  if (/\b(?:causes?|caused by|cures?)\b/i.test(sentence)) return 'States a causal claim that scholarly sources can support or contradict.';
  if (/\b(?:hoax|faked|fabricat|staged|swindle|cover-?up)\b/i.test(sentence)) return 'States that an event was fabricated, which is checkable against primary evidence.';
  return 'States a checkable factual claim rather than an opinion.';
}

function overlaps(a: string, b: string): boolean {
  const left = normalizeText(a), right = normalizeText(b);
  return !!left && !!right && (left === right || left.includes(right) || right.includes(left));
}

/** Sentences worth a scholarly lookup when no model keys are configured. */
export function findLocalClaims(
  chunks: { id: string; text: string }[],
  limit: number,
  skip: Iterable<string> = [],
): LocalClaim[] {
  const ranked: { score: number; claim: LocalClaim }[] = [];
  const reserved = [...skip];
  for (const chunk of chunks) {
    for (const text of sentences(chunk.text)) {
      const score = signals(text);
      if (!score || reserved.some((prev) => overlaps(prev, text))) continue;
      const keywords = keywordsFor(text);
      if (keywords.length < 2) continue;
      ranked.push({ score, claim: { chunkId: chunk.id, text, keywords, reason: reasonFor(text) } });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const kept: LocalClaim[] = [];
  const chosen: string[] = [];
  for (const item of ranked) {
    if (chosen.some((prev) => overlaps(prev, item.claim.text))) continue;
    chosen.push(item.claim.text);
    kept.push(item.claim);
    if (kept.length >= limit) break;
  }
  return kept;
}
