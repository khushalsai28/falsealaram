import { normalizeText } from './text';

export function quoteInText(chunk: string, quote: string): boolean {
  const needle = normalizeText(quote);
  if (needle.length < 15) return false;
  if (chunk.includes(quote)) return true;
  return normalizeText(chunk).includes(needle);
}
