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
      authors: (parts[0] ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== '…'),
      year, abstract: clean(b.match(/<div class="gs_rs">([\s\S]*?)<\/div>/)?.[1] ?? ''), provider: 'Google Scholar', reliability: 0.9,
    });
  }
  return out;
}

const scholar: SourceProvider = {
  name: 'Google Scholar',
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

// ---------- OpenAlex (fallback; free, no key required) ----------
const invert = (idx: Record<string, number[]> | null): string => {
  if (!idx) return '';
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
  return words.join(' ');
};
const openAlex = (key?: string): SourceProvider => ({
  name: 'OpenAlex',
  async search(q, limit) {
    const p = new URLSearchParams({
      search: q, filter: 'has_abstract:true', 'per-page': String(limit),
      select: 'title,publication_year,authorships,doi,abstract_inverted_index,primary_location',
    });
    if (key) p.set('api_key', key);
    const j: any = await (await fetchRetry(`https://api.openalex.org/works?${p}`, {}, { timeoutMs: 15000 })).json();
    return (j.results ?? []).map((w: any): Source => ({
      title: w.title ?? 'Untitled',
      authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
      year: w.publication_year ?? null,
      url: w.doi || w.primary_location?.landing_page_url || '',
      abstract: invert(w.abstract_inverted_index), provider: 'OpenAlex', reliability: 0.86,
    })).filter((s: Source) => s.url);
  },
});

const HOST_SCORE: [RegExp, number][] = [
  [/(^|\.)(gov|edu)$|(^|\.)ac\.[a-z]{2}$|(^|\.)gov\.[a-z]{2}$/i, 0.9],
  [/(^|\.)(who|cdc|nih|nasa|un|europa)\.(int|gov|org)$/i, 0.92],
  [/(^|\.)(nature|science|thelancet|nejm|bmj|pnas|cell|springer|wiley|arxiv|sciencedirect|pubmed|ncbi|cochrane)\./i, 0.88],
  [/(^|\.)(reuters|apnews|bbc|npr|pbs|theguardian|nytimes|washingtonpost|wsj|economist|bloomberg)\.|ft\.com$/i, 0.76],
  [/(^|\.)(mayoclinic|clevelandclinic|hopkinsmedicine|webmd)\./i, 0.74],
  [/(^|\.)(wikipedia|britannica|snopes|factcheck|politifact|fullfact)\./i, 0.7],
];
export function reliabilityOf(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    let best = 0.4;
    for (const [re, score] of HOST_SCORE) if (re.test(host)) best = Math.max(best, score);
    return best;
  } catch { return 0.4; }
}

async function wiki(q: string, limit: number): Promise<Source[]> {
  const search = new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: String(limit), format: 'json', utf8: '1', origin: '*' });
  const found: any = await (await fetchRetry(`https://en.wikipedia.org/w/api.php?${search}`, {}, { timeoutMs: 12000, retries: 1 })).json();
  const hits = (found.query?.search ?? []).slice(0, limit);
  if (!hits.length) return [];
  const extracts = new URLSearchParams({
    action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exchars: '1600',
    pageids: hits.map((h: any) => h.pageid).join('|'), format: 'json', utf8: '1', origin: '*',
  });
  const pages = ((await (await fetchRetry(`https://en.wikipedia.org/w/api.php?${extracts}`, {}, { timeoutMs: 12000, retries: 1 })).json()) as any).query?.pages ?? {};
  return hits.map((h: any): Source => ({
    title: h.title, authors: ['Wikipedia'], year: null,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(h.title).replace(/ /g, '_'))}`,
    abstract: pages[h.pageid]?.extract || clean(h.snippet || ''), provider: 'Web', reliability: 0.72,
  }));
}

function ddgLink(href: string): string {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    return u.searchParams.get('uddg') || (/^https?:\/\//.test(u.href) && !/duckduckgo\.com/i.test(u.hostname) ? u.href : '');
  } catch { return ''; }
}

async function ddg(q: string, limit: number): Promise<Source[]> {
  const res = await fetchRetry(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {}, { timeoutMs: 12000, retries: 1 });
  const html = await res.text();
  const out: Source[] = [];
  for (const b of html.split('result__body').slice(1)) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) || b.match(/href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = ddgLink(a[1].replace(/&amp;/g, '&'));
    if (!url) continue;
    out.push({
      title: clean(a[2]) || url, authors: [], year: null, url,
      abstract: clean(b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ''),
      provider: 'Web', reliability: reliabilityOf(url),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function searchWeb(keywords: string[], limit = 3): Promise<Source[]> {
  const q = keywords.join(' ').slice(0, 180);
  const errors: string[] = [];
  const [fromWiki, fromDdg] = await Promise.all([
    wiki(q, limit).catch((e) => { errors.push(`Wikipedia: ${(e as Error).message}`); return [] as Source[]; }),
    ddg(q, limit).catch((e) => { errors.push(`Web: ${(e as Error).message}`); return [] as Source[]; }),
  ]);
  const web = [...fromWiki, ...fromDdg].sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0));
  const out: Source[] = [], seen = new Set<string>();
  for (const s of web) {
    const k = s.url || s.title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= limit) break;
  }
  if (!out.length && errors.length) throw new Error(errors.join('; '));
  return out;
}

async function gather(p: SourceProvider, queries: string[], limit: number): Promise<Source[]> {
  const out: Source[] = [], seen = new Set<string>();
  for (const q of queries) {
    for (const s of await p.search(q, limit)) {
      const k = s.title.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(s); }
    }
    if (out.length) break;
  }
  return out.slice(0, limit);
}

/** Scholar and OpenAlex run together. The first one with results is used. Web pages fill in when both return nothing. */
export async function searchSources(
  keywords: string[], o: { scholar: boolean; openAlexKey?: string; limit?: number },
): Promise<Source[]> {
  const limit = o.limit ?? 3;
  const queries = [...new Set([keywords.join(' '), keywords.slice(0, 2).join(' ')])].filter(Boolean);
  const errors: string[] = [];
  const jobs: Promise<Source[]>[] = [];
  const track = (name: string, p: Promise<Source[]>) => jobs.push(p.catch((e) => { errors.push(`${name}: ${(e as Error).message}`); return []; }));
  if (o.scholar) track('Google Scholar', gather(scholar, queries, limit));
  track('OpenAlex', gather(openAlex(o.openAlexKey), queries, limit));
  const hits = await new Promise<Source[]>((resolve) => {
    let left = jobs.length, found: Source[] = [];
    if (!left) return resolve([]);
    for (const job of jobs) job.then((list) => {
      if (!found.length && list.length) found = list;
      if (--left === 0 || found.length) resolve(found);
    });
  });
  if (hits.length) return hits.slice(0, limit);
  try {
    const web = await searchWeb(keywords, limit);
    if (web.length) return web;
  } catch (e) { errors.push(`Web: ${(e as Error).message}`); }
  if (errors.length) throw new Error(`Source search failed (${errors.join('; ')})`);
  return [];
}
