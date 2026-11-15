/** Browser- and Node-safe page reader used by both the extension and proxy. */

export interface ReadPage {
  url: string;
  title: string;
  text: string;
}

/** Parse an HTTP(S) URL that is safe for the extension to retrieve or open. */
export function publicHttpUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Invalid page URL.'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only HTTP(S) source URLs can be read.');
  // URL.hostname keeps square brackets around IPv6 literals, so normalize
  // them before checking non-public network ranges.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const privateIpv4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const privateIpv6 = host === '::' || host === '::1'
    || host.startsWith('fc') || host.startsWith('fd')
    || /^fe[89ab][0-9a-f]{0,2}:/i.test(host)
    || host.startsWith('::ffff:');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || privateIpv4 || privateIpv6)
    throw new Error('Only public HTTP(S) source URLs can be read.');
  return parsed;
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
  const parsed = publicHttpUrl(url);

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  let response: Response;
  try {
    response = await fetchImpl(parsed.href, {
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1' },
      // Do not automatically follow redirects: a public source could point at
      // a private address after validation. The agent can still use its search
      // snippet when a source redirects.
      redirect: 'error',
    });
  } catch (error) {
    const reason = timedOut ? 'Request timed out after 15 seconds.' : (error as Error)?.message || 'Network request failed.';
    throw new Error(`Could not read page: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
  const finalUrl = response.url || parsed.href;
  // Defense in depth for custom fetch implementations and future redirect
  // handling: never expose a private final URL to the agent.
  const publicFinalUrl = publicHttpUrl(finalUrl);
  if (!response.ok) throw new Error(`Could not read page: HTTP ${response.status}.`);

  // Reading text cannot execute page code. If an unusual response body cannot
  // be decoded, treat it as empty rather than turning a source parse into a
  // network failure.
  let html = '';
  try { html = await response.text(); } catch { html = ''; }
  const paragraphs = paragraphText(html);
  const fallback = stripHtml(html);
  const text = (paragraphs || fallback).slice(0, Math.max(0, Math.floor(maxChars) || 4000));
  return { url: publicFinalUrl.href, title: titleFromHtml(html, publicFinalUrl.href), text };
}
