import type { ProviderName, Source } from '../shared/types';
import { fetchRetry } from '../shared/net';
import { stripHtml } from './web';

/** Pure network-provider contract; safe to use in an extension or Node proxy. */
export interface SourceProvider {
  name: ProviderName;
  search(query: string, limit: number): Promise<Source[]>;
}

export class ProviderError extends Error {}

const cap = (value: number, max = 3) => Math.max(1, Math.min(max, Math.floor(value) || 1));
const clean = (value: unknown) => stripHtml(String(value ?? '')).replace(/\s+/g, ' ').trim();
const asYear = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1000 && n <= 9999 ? n : null;
};
const source = (input: Omit<Source, 'abstract'>): Source => ({ ...input, abstract: input.snippet ?? '' });

export class WikipediaProvider implements SourceProvider {
  readonly name = 'Wikipedia' as const;

  async search(query: string, limit: number): Promise<Source[]> {
    const params = new URLSearchParams({
      action: 'query', list: 'search', format: 'json', srsearch: query,
      srlimit: String(cap(limit)), srprop: 'snippet', origin: '*',
    });
    const response = await fetchRetry(`https://en.wikipedia.org/w/api.php?${params}`, {}, {
      retries: 3, timeoutMs: 15_000, baseMs: 500,
    });
    const json: any = await response.json();
    const results = Array.isArray(json?.query?.search) ? json.query.search : [];
    return results.map((result: any): Source => {
      const title = clean(result?.title) || 'Wikipedia article';
      const snippet = clean(result?.snippet);
      return source({
        title, authors: ['Wikipedia'], year: null,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        snippet, provider: this.name,
      });
    }).filter((item: Source) => Boolean(item.url));
  }
}

export class SemanticScholarProvider implements SourceProvider {
  readonly name = 'Semantic Scholar' as const;

  async search(query: string, limit: number): Promise<Source[]> {
    const params = new URLSearchParams({
      query, fields: 'title,abstract,year,authors,externalIds,url', limit: String(cap(limit)),
    });
    const response = await fetchRetry(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {}, {
      retries: 3, timeoutMs: 15_000, baseMs: 500,
    });
    const json: any = await response.json();
    const papers = Array.isArray(json?.data) ? json.data : [];
    return papers.map((paper: any): Source => {
      const doi = typeof paper?.externalIds?.DOI === 'string' ? `https://doi.org/${paper.externalIds.DOI}` : '';
      return source({
        title: clean(paper?.title) || 'Untitled paper',
        authors: Array.isArray(paper?.authors) ? paper.authors.map((author: any) => clean(author?.name)).filter(Boolean) : [],
        year: asYear(paper?.year), url: String(paper?.url || doi || ''),
        snippet: clean(paper?.abstract), provider: this.name,
      });
    }).filter((item: Source) => Boolean(item.url));
  }
}

function invertAbstract(index: unknown): string {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) if (Number.isInteger(position) && (position as number) >= 0) words[position as number] = word;
  }
  return words.filter(Boolean).join(' ');
}

export class OpenAlexProvider implements SourceProvider {
  readonly name = 'OpenAlex' as const;
  constructor(private readonly apiKey?: string) {}

  async search(query: string, limit: number): Promise<Source[]> {
    const params = new URLSearchParams({
      search: query, 'per-page': String(cap(limit)),
      select: 'title,publication_year,authorships,doi,abstract_inverted_index,primary_location',
    });
    if (this.apiKey) params.set('api_key', this.apiKey);
    const response = await fetchRetry(`https://api.openalex.org/works?${params}`, {}, {
      retries: 3, timeoutMs: 15_000, baseMs: 500,
    });
    const json: any = await response.json();
    const works = Array.isArray(json?.results) ? json.results : [];
    return works.map((work: any): Source => {
      const landing = work?.primary_location?.landing_page_url;
      return source({
        title: clean(work?.title) || 'Untitled work',
        authors: Array.isArray(work?.authorships)
          ? work.authorships.map((authorship: any) => clean(authorship?.author?.display_name)).filter(Boolean)
          : [],
        year: asYear(work?.publication_year), url: String(work?.doi || landing || ''),
        snippet: clean(invertAbstract(work?.abstract_inverted_index)), provider: this.name,
      });
    }).filter((item: Source) => Boolean(item.url));
  }
}

export interface DefaultProviderOptions { openAlexKey?: string; }

/** v3's deliberate general-web-first fallback order. */
export function defaultProviders(options: DefaultProviderOptions = {}): SourceProvider[] {
  return [new WikipediaProvider(), new SemanticScholarProvider(), new OpenAlexProvider(options.openAlexKey)];
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '').toLowerCase();
  } catch { return url.trim().toLowerCase(); }
}

/**
 * Query sources in declared fallback order. A failed/rate-limited provider is
 * skipped; results already gathered (especially Wikipedia) are retained.
 */
export async function tryProvidersInOrder(
  providers: SourceProvider[],
  query: string,
  limit = 3,
): Promise<Source[]> {
  const target = cap(limit);
  const output: Source[] = [];
  const seen = new Set<string>();
  let lastError: unknown;
  for (const provider of providers) {
    let found: Source[];
    try {
      found = await provider.search(query, target);
    } catch (error) {
      // Provider failure is expected in the browser (CORS/rate limits) and
      // should never erase evidence supplied by an earlier provider.
      lastError = error;
      continue;
    }
    for (const item of found) {
      if (!item?.url || !item.title) continue;
      const key = canonicalUrl(item.url) || `${item.provider}:${item.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ ...item, snippet: item.snippet || item.abstract || '', abstract: item.abstract ?? item.snippet ?? '' });
      if (output.length >= target) return output;
    }
  }
  if (!output.length && lastError) throw lastError;
  return output;
}
