import type { Chunk, Claim, FactCheckResult, Progress, ScanRequest, ScanSummary, Settings, Source, ToContent } from '../shared/types';
import { getSettings } from '../shared/settings';
import { isBlockedUrl } from '../shared/blocklist';
import { quoteInText } from '../shared/claims';
import { normalizeText, sha16 } from '../shared/text';
import { asDetect, asGrokCheck, asSummaries, asVerdict } from '../shared/json';
import { describeError, fetchRetry } from '../shared/net';
import { CMP_SCHEMA, CMP_SYSTEM, DETECT_SCHEMA, DETECT_SYSTEM, GROK_SCHEMA, GROK_SYSTEM, SUM_SCHEMA, SUM_SYSTEM } from '../shared/prompts';
import { callGrokSearch, callLLM } from './llm';
import { resolveKeys } from './config';
import { reliabilityOf, searchSources } from './providers';

const PREFIX = 'fl:v2:', TTL = 7 * 864e5, MAX_CACHE = 300;
const MAX_CHUNK = 15000, BATCH_CHARS = 30000, MAX_BATCHES = 45, CONCURRENCY = 4;

const send = (tabId: number, msg: ToContent) => chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
const progress = (tabId: number, p: Progress) => send(tabId, { type: 'PROGRESS', payload: p });

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function runScan(tabId: number, req: ScanRequest): Promise<ScanSummary> {
  const fail = (error: string): ScanSummary => { progress(tabId, { stage: 'error', message: error }); return { ok: false, claimsFound: 0, flagged: 0, error }; };
  const s = await getSettings();
  if (!s.enabled) return fail('FalseAlarm is turned off.');
  if (isBlockedUrl(req.pageUrl, s.blocklist)) return fail('Sensitive site (blocklist) - nothing was sent.');
  if (s.mode === 'direct') {
    const k = resolveKeys(s);
    if (!k.gemini || !k.grok) return fail('Add your Gemini and Grok API keys in FalseAlarm options.');
  }
  try {
    progress(tabId, { stage: 'detecting', message: 'Scanning page for suspicious claims…' });
    const claims = await detectClaims(req.chunks, s, req.maxClaims);
    if (!claims.length) { progress(tabId, { stage: 'done', message: 'No suspicious claims found.' }); return { ok: true, claimsFound: 0, flagged: 0 }; }
    claims.forEach((claim) => send(tabId, { type: 'CLAIM_PENDING', payload: { claim } }));
    let done = 0, flagged = 0;
    const tick = () => progress(tabId, { stage: 'checking', message: `Scanning… ${claims.length} claims found (${done}/${claims.length} checked)` });
    tick();
    await pool(claims, CONCURRENCY, async (c) => {
      const result = await checkClaim(c, s).catch((e): FactCheckResult => ({
        claimId: c.id, claimHash: c.hash, claimText: c.text, verdict: 'insufficient evidence',
        explanation: `Could not complete this check: ${describeError(e)}`, correction: '', supportingSources: [],
        sources: [], checkedAt: Date.now(), error: describeError(e),
      }));
      done++;
      if (result.verdict === 'contradicted' || result.verdict === 'partially supported') flagged++;
      send(tabId, { type: 'CLAIM_RESULT', payload: { result } });
      tick();
    });
    progress(tabId, { stage: 'done', message: `Done - ${flagged} of ${claims.length} claims flagged.` });
    return { ok: true, claimsFound: claims.length, flagged };
  } catch (e) { return fail(describeError(e)); }
}

async function detectClaims(chunks: Chunk[], s: Settings, max: number): Promise<Claim[]> {
  // dedupe + size-cap, then pack into batches
  const norm = new Map<string, string>(), uniq: Chunk[] = [], seenText = new Set<string>();
  for (const c of chunks) {
    const n = normalizeText(c.text);
    if (seenText.has(n)) continue;
    seenText.add(n); norm.set(c.id, n); uniq.push({ id: c.id, text: c.text.slice(0, MAX_CHUNK) });
  }
  const batches: Chunk[][] = []; let cur: Chunk[] = [], size = 0;
  for (const c of uniq) {
    if (size + c.text.length > BATCH_CHARS && cur.length) { batches.push(cur); cur = []; size = 0; }
    cur.push(c); size += c.text.length;
  }
  if (cur.length) batches.push(cur);

  const found: Claim[] = [], hashes = new Set<string>();
  let firstError: unknown;
  await pool(batches.slice(0, MAX_BATCHES), 3, async (b) => {
    let raw: unknown;
    try { raw = await callLLM('gemini', s, DETECT_SYSTEM, JSON.stringify(b), DETECT_SCHEMA); }
    catch (e) { if (!firstError) firstError = e; return; }
    for (const r of asDetect(raw)) {
      const hay = norm.get(r.chunkId), needle = normalizeText(r.text);
      if (!hay || !quoteInText(hay, r.text) || r.confidence < s.confidenceThreshold || !r.keywords.length) continue;
      const hash = await sha16(needle);
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      found.push({ id: '', hash, chunkId: r.chunkId, text: r.text, reason: r.reason, confidence: r.confidence, keywords: r.keywords });
    }
  });
  if (!found.length && firstError) throw firstError;
  return found.sort((a, b) => b.confidence - a.confidence).slice(0, max).map((c, i) => ({ ...c, id: `${c.chunkId}-${i}` }));
}

async function retrieve(c: Claim, s: Settings): Promise<Source[]> {
  if (s.mode === 'proxy') {
    const res = await fetchRetry(`${s.proxyUrl.replace(/\/$/, '')}/api/sources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-falsealarm-token': s.proxyToken },
      body: JSON.stringify({ keywords: c.keywords, limit: 3, scholar: s.scholarEnabled }),
    }, { timeoutMs: 40000 });
    return ((await res.json()) as any).sources ?? [];
  }
  return searchSources(c.keywords, { scholar: s.scholarEnabled, openAlexKey: resolveKeys(s).openAlex, limit: 3 });
}

async function judge(c: Claim, s: Settings, sources: Source[], base: Pick<FactCheckResult, 'claimId' | 'claimHash' | 'claimText' | 'checkedAt'>): Promise<FactCheckResult> {
  if (!sources.length) {
    return { ...base, verdict: 'insufficient evidence', explanation: 'No sources were found for this claim.', correction: '', supportingSources: [], sources: [] };
  }
  const sums = asSummaries(await callLLM('gemini', s, SUM_SYSTEM, JSON.stringify({
    claim: c.text, sources: sources.map((x, i) => ({ n: i + 1, title: x.title, year: x.year, reliability: x.reliability ?? 0.5, abstract: x.abstract.slice(0, 2200) })),
  }), SUM_SCHEMA));
  sources = sources.map((x, i) => ({ ...x, summary: sums.get(i + 1) || 'No summary available.' }));
  if (sources.every((x) => /does not directly address the claim|no abstract available|no summary available/i.test(x.summary ?? ''))) {
    return { ...base, verdict: 'insufficient evidence', explanation: 'Retrieved sources do not address this claim.', correction: '', supportingSources: [], sources };
  }
  const v = asVerdict(await callLLM('grok', s, CMP_SYSTEM, JSON.stringify({
    claim: c.text, sources: sources.map((x, i) => ({ n: i + 1, title: x.title, year: x.year, provider: x.provider, reliability: x.reliability ?? 0.5, summary: x.summary })),
  }), CMP_SCHEMA), sources.length);
  return { ...base, ...v, sources };
}

const MISS = /does not directly address the claim|no abstract available|no summary available/i;
const sourceAddresses = (summary?: string) => !MISS.test(summary ?? '');

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.href.toLowerCase();
  } catch { return url.trim().toLowerCase(); }
}

function keepAddressing(sources: Source[], supporting: number[]): { sources: Source[]; supportingSources: number[] } {
  const kept: Source[] = [];
  const renumber = new Map<number, number>();
  sources.forEach((source, index) => {
    if (!sourceAddresses(source.summary)) return;
    renumber.set(index + 1, kept.length + 1);
    kept.push(source);
  });
  return {
    sources: kept,
    supportingSources: supporting.map((n) => renumber.get(n)).filter((n): n is number => typeof n === 'number'),
  };
}

/** Grok replaces retrieved sources when they do not contradict the claim. */
async function grokFound(c: Claim, s: Settings, base: Pick<FactCheckResult, 'claimId' | 'claimHash' | 'claimText' | 'checkedAt'>): Promise<FactCheckResult> {
  const web = await callGrokSearch(s, GROK_SYSTEM, JSON.stringify({ claim: c.text }), GROK_SCHEMA);
  const g = asGrokCheck(web.value);
  const allowed = new Set(web.citations.map(canonicalUrl));
  const cited = g.sources
    .map((source, index) => ({ ...source, n: index + 1 }))
    .filter((source) => sourceAddresses(source.summary) && (!allowed.size || allowed.has(canonicalUrl(source.url))))
    .slice(0, 3);
  const renumber = new Map(cited.map((source, index) => [source.n, index + 1]));
  let sources: Source[] = cited.map((source) => ({
    title: source.title, authors: [], year: null, url: source.url, abstract: source.summary, summary: source.summary,
    provider: 'Grok', reliability: reliabilityOf(source.url),
  }));
  let supportingSources = g.supportingSources.map((n) => renumber.get(n)).filter((n): n is number => typeof n === 'number');
  if (!sources.length) {
    sources = web.citations.slice(0, 3).map((url) => ({
      title: url, authors: [], year: null, url, abstract: '', summary: 'Page opened by Grok while checking this claim.',
      provider: 'Grok' as const, reliability: reliabilityOf(url),
    }));
    supportingSources = sources.map((_, index) => index + 1);
  }
  if (!sources.length) {
    return {
      ...base, verdict: 'insufficient evidence', supportingSources: [], sources: [], correction: '',
      explanation: 'Grok searched the web but did not return sources that address this claim.',
    };
  }
  return { ...base, verdict: g.verdict, explanation: g.explanation, correction: g.correction, supportingSources, sources };
}

async function checkClaim(c: Claim, s: Settings): Promise<FactCheckResult> {
  const key = PREFIX + c.hash;
  const hit = (await chrome.storage.local.get(key))[key] as FactCheckResult | undefined;
  if (hit && Date.now() - hit.checkedAt < TTL) return { ...hit, claimId: c.id };

  const base = { claimId: c.id, claimHash: c.hash, claimText: c.text, checkedAt: Date.now() };
  const sources = await retrieve(c, s);
  const judged = await judge(c, s, sources, base);
  const usable = keepAddressing(judged.sources, judged.supportingSources);
  let result = judged;
  if (judged.verdict === 'contradicted' && usable.sources.length) result = { ...judged, ...usable };
  else {
    try { result = await grokFound(c, s, base); }
    catch (e) {
      result = {
        ...base, verdict: 'insufficient evidence', supportingSources: [], sources: [], correction: '',
        explanation: `Retrieved sources did not show this claim is wrong, and Grok search could not finish: ${describeError(e)}`,
      };
    }
  }
  await chrome.storage.local.set({ [key]: result });
  if (Math.random() < 0.1) void prune();
  return result;
}

async function prune() {
  const all = Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith(PREFIX)) as [string, FactCheckResult][];
  const live = all.filter(([, v]) => Date.now() - v.checkedAt <= TTL).sort((a, b) => a[1].checkedAt - b[1].checkedAt);
  const dead = all.filter(([, v]) => Date.now() - v.checkedAt > TTL);
  const over = live.slice(0, Math.max(0, live.length - MAX_CACHE));
  if (dead.length || over.length) await chrome.storage.local.remove([...dead, ...over].map(([k]) => k));
}
