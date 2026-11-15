import type { ProviderName, Source } from '../shared/types';
import { fetchRetry, HttpError } from '../shared/net';

// This file is also imported by the Node proxy -> no chrome.* APIs here.
export interface SourceProvider { name: ProviderName; search(query: string, limit: number): Promise<Source[]> }
export class ProviderError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const clean = (h: string) =>
  h.replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m)
    .replace(/\s+/g, ' ').trim();

// ---------- Google Scholar (unofficial, best-effort) ----------
let blockedUntil = 0, lastAt = 0, chain: Promise<unknown> = Promise.resolve();
/** Serialize Scholar hits with >= 2s spacing to look less like a bot. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(async () => {
    const wait = lastAt + 2000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return fn();
  });
  chain = p.catch(() => undefined);
  return p;
}

export function parseScholar(html: string): Source[] {
  const out: Source[] = [];
  for (const b of html.split(/<div class="gs_r gs_or gs_scl"/).slice(1)) {
    const h3 = b.match(/<h3[^>]*class="gs_rt"[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    const a = h3?.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue; // citation-only entries have no link
    const meta = clean(b.match(/<div class="gs_a">([\s\S]*?)<\/div>/)?.[1] ?? '');
    const parts = meta.split(' - ');
    const year = Number(meta.match(/\b(19|20)\d{2}\b/)?.[0]) || null;
    out.push({
      title: clean(a[2]), url: new URL(clean(a[1]).replace(/&amp;/g, '&'), 'https://scholar.google.com').href,
      authors: (parts[0] ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== '…').join(', '),
      year, abstract: clean(b.match(/<div class="gs_rs">([\s\S]*?)<\/div>/)?.[1] ?? ''), provider: 'google-scholar',
    });
  }
  return out;
}

const scholar: SourceProvider = {
  name: 'google-scholar',
  async search(q, limit) {
    if (Date.now() < blockedUntil) throw new ProviderError('Google Scholar paused after a block');
    const block = (why: string) => { blockedUntil = Date.now() + 10 * 60_000; return new ProviderError(why); };
    let res: Response;
    try {
      res = await throttled(() => fetchRetry(
        `https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&num=${limit + 2}&q=${encodeURIComponent(q)}`, {}, { retries: 0, timeoutMs: 10000 }));
    } catch (e) {
      if (e instanceof HttpError && (e.status === 429 || e.status === 403)) throw block('Google Scholar rate-limited the request');
      throw new ProviderError(`Google Scholar unavailable: ${(e as Error).message}`);
    }
    const html = await res.text();
    if (res.url.includes('/sorry/') || /gs_captcha|unusual traffic/i.test(html)) throw block('Google Scholar CAPTCHA');
    return parseScholar(html).slice(0, limit);
  },
};

// ---------- Semantic Scholar (primary live provider; free, no key required) ----------
const semanticScholar: SourceProvider = {
  name: 'semantic-scholar',
  async search(q, limit) {
    const p = new URLSearchParams({
      query: q, fields: 'title,abstract,year,authors,externalIds,url', limit: String(limit),
    });
    const j: any = await (await fetchRetry(`https://api.semanticscholar.org/graph/v1/paper/search?${p}`, {}, { timeoutMs: 15000 })).json();
    return (j.data ?? []).map((paper: any): Source => ({
      title: paper.title ?? 'Untitled',
      authors: (paper.authors ?? []).map((a: any) => a.name).filter(Boolean).join(', '),
      year: paper.year ?? null,
      url: paper.url || (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : ''),
      abstract: paper.abstract ?? '',
      provider: 'semantic-scholar',
    })).filter((s: Source) => s.url);
  },
};

// ---------- OpenAlex (last fallback; free, no key required) ----------
const invert = (idx: Record<string, number[]> | null): string => {
  if (!idx) return '';
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
  return words.join(' ');
};
const openAlex = (key?: string): SourceProvider => ({
  name: 'openalex',
  async search(q, limit) {
    const p = new URLSearchParams({
      search: q, filter: 'has_abstract:true', 'per-page': String(limit),
      select: 'title,publication_year,authorships,doi,abstract_inverted_index,primary_location',
    });
    if (key) p.set('api_key', key);
    const j: any = await (await fetchRetry(`https://api.openalex.org/works?${p}`, {}, { timeoutMs: 15000 })).json();
    return (j.results ?? []).map((w: any): Source => ({
      title: w.title ?? 'Untitled',
      authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).join(', '),
      year: w.publication_year ?? null,
      url: w.doi || w.primary_location?.landing_page_url || '',
      abstract: invert(w.abstract_inverted_index), provider: 'openalex',
    })).filter((s: Source) => s.url);
  },
});

/** Scholar is proxy-only; live providers top up one another and Scholar failures are silent. */
export async function searchSources(
  keywords: string[], o: { scholar: boolean; openAlexKey?: string; limit?: number },
): Promise<Source[]> {
  const limit = o.limit ?? 3;
  const providers = [...(o.scholar ? [scholar] : []), semanticScholar, openAlex(o.openAlexKey)];
  const queries = [...new Set([keywords.join(' '), keywords.slice(0, 2).join(' ')])].filter(Boolean);
  const out: Source[] = [], seen = new Set<string>(), errors: string[] = [];
  for (const p of providers) {
    let got = 0;
    for (const q of queries) {
      try {
        for (const s of await p.search(q, limit)) {
          const k = s.title.toLowerCase();
          if (!seen.has(k)) { seen.add(k); out.push(s); got++; }
        }
      } catch (e) {
        if (p.name !== 'google-scholar') errors.push(`${p.name}: ${(e as Error).message}`);
        break;
      }
      if (got) break;
    }
    if (out.length >= limit) return out.slice(0, limit);
  }
  if (!out.length && errors.length) throw new Error(`Scholarly search failed (${errors.join('; ')})`);
  return out;
}
