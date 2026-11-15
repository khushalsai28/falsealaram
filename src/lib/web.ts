/** Browser- and Node-safe page reader used by both the extension and proxy. */

export interface ReadPage {
  url: string;
  title: string;
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
};

function decodeEntity(match: string, entity: string): string {
  const key = entity.toLowerCase();
  if (key.startsWith('#x')) {
    const n = Number.parseInt(key.slice(2), 16);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  }
  if (key.startsWith('#')) {
    const n = Number.parseInt(key.slice(1), 10);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  }
  return ENTITIES[key] ?? match;
}

/** Convert HTML to readable text without evaluating or loading anything in it. */
export function stripHtml(html: string): string {
  return String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(p|div|section|article|main|header|footer|li|h[1-6]|tr|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, decodeEntity)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFromHtml(html: string, fallbackUrl: string): string {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  if (raw) {
    const title = stripHtml(raw).replace(/\s+/g, ' ').trim();
    if (title) return title.slice(0, 300);
  }
  try { return new URL(fallbackUrl).hostname; } catch { return fallbackUrl; }
}

function paragraphText(html: string): string {
  const paragraphs = html.match(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi) ?? [];
  const useful = paragraphs
    .map(stripHtml)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40);
  return useful.join('\n\n');
}

/**
 * Fetch public page text with a hard 15-second deadline. Scripts/styles are
 * removed; substantial paragraphs win over generic visible text.
 */
export async function fetchPageText(
  url: string,
  maxChars = 4000,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadPage> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Invalid page URL.'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only HTTP(S) source URLs can be read.');

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  let response: Response;
  try {
    response = await fetchImpl(parsed.href, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1' },
      redirect: 'follow',
    });
  } catch (error) {
    const reason = timedOut ? 'Request timed out after 15 seconds.' : (error as Error)?.message || 'Network request failed.';
    throw new Error(`Could not read page: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Could not read page: HTTP ${response.status}.`);

  // Reading text cannot execute page code. If an unusual response body cannot
  // be decoded, treat it as empty rather than turning a source parse into a
  // network failure.
  let html = '';
  try { html = await response.text(); } catch { html = ''; }
  const paragraphs = paragraphText(html);
  const fallback = stripHtml(html);
  const text = (paragraphs || fallback).slice(0, Math.max(0, Math.floor(maxChars) || 4000));
  return { url: response.url || parsed.href, title: titleFromHtml(html, response.url || parsed.href), text };
}
