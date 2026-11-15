import type { AgentQuote, AgentResult, AgentStep, Source, Verdict } from '../shared/types';
import { clampConfidence, normalizeVerdict, objectOrEmpty, safeParseJson, stringOrEmpty } from '../shared/json';
import { AGENT_ANSWER_PROMPT, AGENT_ANSWER_SCHEMA, AGENT_PLAN_PROMPT, AGENT_PLAN_SCHEMA } from '../shared/prompts';
import { defaultProviders, tryProvidersInOrder, type SourceProvider } from './providers';
import { fetchPageText, type ReadPage } from './web';

/** A tiny adapter around direct or proxy model calls. It must never expose keys. */
export interface AgentModelClient {
  generate(system: string, user: string, schema: object): Promise<unknown | string>;
}

export type AgentProgressHandler = (status: string, step: AgentStep) => void;

export interface AgentDependencies {
  providers: SourceProvider[];
  readPage: (url: string, maxChars?: number) => Promise<ReadPage>;
  search: (providers: SourceProvider[], query: string, limit?: number) => Promise<Source[]>;
  retryDelays: number[];
}

const DEFAULT_DEPS: AgentDependencies = {
  providers: defaultProviders(),
  readPage: fetchPageText,
  search: tryProvidersInOrder,
  retryDelays: [500, 1_000, 2_000],
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const asText = (value: unknown, max = 4000) => stringOrEmpty(value, max);

function statusOf(error: unknown): number | undefined {
  const candidate = error as { status?: unknown; response?: { status?: unknown }; message?: unknown };
  const direct = Number(candidate?.status ?? candidate?.response?.status);
  if (Number.isInteger(direct)) return direct;
  const match = String(candidate?.message ?? error).match(/\b(429|5\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

function retryable(error: unknown) {
  const status = statusOf(error);
  return status === 429 || (status != null && status >= 500 && status <= 599);
}

async function modelCall(
  client: AgentModelClient,
  system: string,
  user: string,
  schema: object,
  retryDelays: number[],
  valid: (value: unknown) => boolean,
): Promise<unknown> {
  let malformedRetries = 0;
  for (;;) {
    let raw: unknown;
    try {
      let attempt = 0;
      for (;;) {
        try {
          raw = await client.generate(system, user, schema);
          break;
        } catch (error) {
          if (!retryable(error) || attempt >= retryDelays.length) throw error;
          await wait(retryDelays[attempt++]);
        }
      }
    } catch (error) {
      throw error;
    }
    const parsed = safeParseJson(raw);
    if (parsed !== null && valid(parsed)) return parsed;
    if (malformedRetries++ >= 1) throw new Error('Model returned malformed JSON.');
  }
}

function validPlan(value: unknown): boolean {
  const item = objectOrEmpty(value);
  return Array.isArray(item.searches) && item.searches.every((search) => typeof search === 'string')
    && typeof item.intent === 'string';
}

function validAnswer(value: unknown): boolean {
  const item = objectOrEmpty(value);
  return typeof item.answer === 'string' && typeof item.verdict === 'string'
    && typeof item.explanation === 'string' && typeof item.correctedInfo === 'string'
    && typeof item.confidence === 'number' && Array.isArray(item.quotes)
    && item.quotes.every((quote) => {
      const candidate = objectOrEmpty(quote);
      return typeof candidate.text === 'string' && typeof candidate.url === 'string';
    });
}

function uniqueSearches(value: unknown, fallback: string): string[] {
  const raw = objectOrEmpty(value);
  const inputs = Array.isArray(raw.searches) ? raw.searches : [];
  const seen = new Set<string>();
  const searches: string[] = [];
  for (const input of inputs) {
    const search = asText(input, 240).replace(/\s+/g, ' ');
    if (!search || seen.has(search.toLowerCase())) continue;
    seen.add(search.toLowerCase());
    searches.push(search);
    if (searches.length === 3) break;
  }
  // A malformed plan is not a reason to fabricate searches. The PRD's one
  // query fallback is intentionally conservative.
  return searches.length >= 2 ? searches : [fallback];
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '').toLowerCase();
  } catch { return url.trim().toLowerCase(); }
}

function addUnique(target: Source[], candidates: Source[], maximum: number) {
  const seen = new Set(target.map((source) => canonicalUrl(source.url)));
  for (const candidate of candidates) {
    const key = canonicalUrl(candidate.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push({ ...candidate, snippet: candidate.snippet || candidate.abstract || '' });
    if (target.length >= maximum) return;
  }
}

function sentenceWithKeyword(text: string, keywords: string[]): string {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [text];
  const lowered = keywords.map((word) => word.toLowerCase()).filter((word) => word.length > 2);
  const candidates = sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 10);
  const match = candidates.find((sentence) => lowered.some((word) => sentence.toLowerCase().includes(word))) ?? candidates[0] ?? '';
  return match.slice(0, 240).trim();
}

function verifiedQuotes(rawQuotes: unknown, evidence: Source[], keywords: string[]): AgentQuote[] {
  const list = Array.isArray(rawQuotes) ? rawQuotes : [];
  const byUrl = new Map(evidence.map((source) => [canonicalUrl(source.url), source]));
  const quotes: AgentQuote[] = [];
  for (const item of list) {
    const candidate = objectOrEmpty(item);
    const text = asText(candidate.text, 240);
    const url = asText(candidate.url, 4096);
    if (text.length < 10 || text.length > 240 || !url) continue;
    const source = byUrl.get(canonicalUrl(url));
    if (!source) continue;
    const material = source.pageText || source.snippet || source.abstract || '';
    const offset = material.indexOf(text);
    // `offset` plus the exact prefix check prevents a normalised/paraphrased
    // quote from being accepted merely because it resembles page text.
    if (offset < 0 || material.slice(offset, offset + Math.min(80, text.length)) !== text.slice(0, Math.min(80, text.length))) continue;
    quotes.push({ text, url: source.url });
  }
  if (quotes.length) return quotes.slice(0, 3);

  // The fallback is only an actual sentence from evidence. Prefer a read page,
  // then a result snippet if every read failed.
  const preferred = evidence.find((source) => source.pageText && sentenceWithKeyword(source.pageText, keywords));
  const source = preferred ?? evidence.find((item) => Boolean(item.snippet || item.abstract));
  if (!source) return [];
  const text = sentenceWithKeyword(source.pageText || source.snippet || source.abstract || '', keywords);
  return text.length >= 10 ? [{ text, url: source.url }] : [];
}

function cleanCorrectedInfo(value: unknown, verdict: Verdict) {
  if (verdict === 'supported' || verdict === 'insufficient_evidence') return '';
  return asText(value, 1200);
}

function errorMessage(error: unknown): string {
  const message = String((error as Error)?.message ?? error);
  if (/missing .*api key|api key.*missing|add .*api key|keys? (are )?needed/i.test(message)) {
    return 'API keys are needed to answer this question. Add a Gemini API key in Options or configure a proxy.';
  }
  if (/\b(401|403)\b|invalid .*api key|api key.*(invalid|unauthori[sz]ed)|not authorized/i.test(message)) {
    return 'The configured API key is invalid or not authorized. Update it in Options or check the proxy configuration.';
  }
  if (/\b404\b|model .*not found|endpoint .*not found/i.test(message)) {
    return 'The configured model or endpoint was not found. Check the model names in Options or the proxy settings.';
  }
  if (/could not reach .*proxy|network|fetch failed|connection refused/i.test(message)) {
    return 'The research proxy could not be reached. Start it, verify its URL, or use a direct Gemini key.';
  }
  if (/429|rate.limit/i.test(message)) return 'The research service is rate limited. Please try again in a minute.';
  return 'I could not complete the evidence review. Please try again.';
}

function emptyResult(query: string, steps: AgentStep[], message: string, sources: Source[] = [], error?: string): AgentResult {
  return {
    query, answer: message, verdict: 'insufficient_evidence',
    explanation: sources.length ? message : 'No retrieved source addressed this question.', correctedInfo: '',
    sources, quotes: [], steps, confidence: 0, error,
  };
}

/**
 * Run the transparent web-research loop. The first five arguments deliberately
 * match the PRD signature; the sixth is an optional test/transport seam.
 */
export async function runAgent(
  gemini: AgentModelClient,
  grok: AgentModelClient | undefined,
  queryInput: string,
  pageContext?: string,
  onProgress?: AgentProgressHandler,
  overrides: Partial<AgentDependencies> = {},
): Promise<AgentResult> {
  const query = queryInput.trim();
  const deps: AgentDependencies = { ...DEFAULT_DEPS, ...overrides };
  const steps: AgentStep[] = [];
  const record = (label: string, detail: string) => {
    const step = { label, detail };
    steps.push(step);
    try { onProgress?.(`${label}: ${detail}`, step); } catch { /* UI listeners never break research */ }
  };

  if (!query) return emptyResult('', steps, 'Enter a question to research.');

  let searches: string[];
  try {
    const plan = await modelCall(
      gemini, AGENT_PLAN_PROMPT, JSON.stringify({ query, pageContext: pageContext || '' }),
      AGENT_PLAN_SCHEMA, deps.retryDelays, validPlan,
    );
    searches = uniqueSearches(plan, query);
  } catch {
    searches = [query];
  }
  record('Planned searches', searches.join(' · '));

  const sources: Source[] = [];
  let searchFailure: unknown;
  for (const search of searches.slice(0, 3)) {
    let found: Source[] = [];
    try {
      found = await deps.search(deps.providers, search, 3);
    } catch (error) {
      searchFailure = error;
    }
    addUnique(sources, found, 6);
    record('Searched', searchFailure && !found.length
      ? errorMessage(searchFailure)
      : `${search} — ${found.length} source${found.length === 1 ? '' : 's'} found`);
    if (sources.length >= 6) break;
  }

  if (!sources.length) {
    const message = searchFailure ? errorMessage(searchFailure) : 'I could not find a source that addresses this question.';
    record('Verified', searchFailure ? 'source retrieval failed; insufficient evidence' : '0 sources; insufficient evidence');
    return emptyResult(query, steps, message, [], searchFailure ? message : undefined);
  }

  const enriched = sources.map((source) => ({ ...source }));
  for (let index = 0; index < Math.min(3, enriched.length); index++) {
    const source = enriched[index];
    try {
      const page = await deps.readPage(source.url, 4000);
      enriched[index] = {
        ...source,
        url: page.url || source.url,
        title: page.title || source.title,
        pageText: page.text,
      };
      record('Opened', enriched[index].url);
    } catch {
      record('Opened', `${source.url} — could not read the page, using its snippet`);
    }
  }

  const evidence = enriched.filter((source) => Boolean(source.pageText || source.snippet || source.abstract));
  if (!evidence.length) {
    record('Verified', '0 readable sources; insufficient evidence');
    return emptyResult(query, steps, 'I could not find readable evidence that addresses this question.', enriched);
  }

  const user = JSON.stringify({
    query,
    pageContext: pageContext || '',
    evidence: evidence.map((source) => ({
      title: source.title, url: source.url, provider: source.provider,
      text: (source.pageText || source.snippet || source.abstract || '').slice(0, 1500),
    })),
  });

  let answer: Record<string, unknown>;
  try {
    const answerModel = grok ?? gemini;
    try {
      answer = objectOrEmpty(await modelCall(
        answerModel, AGENT_ANSWER_PROMPT, user, AGENT_ANSWER_SCHEMA, deps.retryDelays, validAnswer,
      ));
    } catch (grokError) {
      if (!grok || answerModel === gemini) throw grokError;
      answer = objectOrEmpty(await modelCall(
        gemini, AGENT_ANSWER_PROMPT, user, AGENT_ANSWER_SCHEMA, deps.retryDelays, validAnswer,
      ));
    }
  } catch (error) {
    const message = errorMessage(error);
    record('Verified', `${evidence.length} sources; unable to complete model verification`);
    return emptyResult(query, steps, message, enriched, message);
  }

  const verdict = normalizeVerdict(answer.verdict);
  const keywords = query.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  const result: AgentResult = {
    query,
    answer: asText(answer.answer, 1600) || 'The retrieved evidence did not support a reliable answer.',
    verdict,
    explanation: asText(answer.explanation, 1600) || 'The answer is limited to the retrieved evidence.',
    correctedInfo: cleanCorrectedInfo(answer.correctedInfo, verdict),
    sources: enriched,
    quotes: verifiedQuotes(answer.quotes, evidence, keywords),
    steps,
    confidence: clampConfidence(answer.confidence),
  };
  record('Verified', `${evidence.length} source${evidence.length === 1 ? '' : 's'}; ${verdict}`);
  return result;
}

export { sentenceWithKeyword };
