import type { Chunk, Claim, FactCheckResult, Progress, ScanRequest, ScanSummary, Settings, Source, ToContent } from '../shared/types';
import { getSettings } from '../shared/settings';
import { isBlockedUrl } from '../shared/blocklist';
import { normalizeText, sha16 } from '../shared/text';
import { asDetect, asSummaries, asVerdict } from '../shared/json';
import { describeError, fetchRetry } from '../shared/net';
import { CMP_SCHEMA, CMP_SYSTEM, DETECT_SCHEMA, DETECT_SYSTEM, SUM_SCHEMA, SUM_SYSTEM } from '../shared/prompts';
import { callLLM } from './llm';
import { resolveKeys } from './config';
import { searchSources } from './providers';

const PREFIX = 'falsealaram:v2:', TTL = 7 * 864e5, MAX_CACHE = 300, MAX_PAGE_CLAIMS = 5;
const MAX_CHUNK = 1500, MAX_CHUNKS_PER_BATCH = 20, BATCH_CHARS = 12000, MAX_BATCHES = 45, CONCURRENCY = 2;

const DEMO_CLAIMS = [
  {
    pattern: /humans? only use (?:about )?(?:10%?|ten percent) of (?:their|the) brains?/i,
    reason: 'A widely repeated neuroscience myth.',
    keywords: ['human brain', 'brain activity', 'neuroscience'],
    verdict: 'contradicted' as const,
    explanation: 'Brain imaging and neuroscience research show that many brain regions are active over the course of ordinary life; people do not use only a small fraction of the brain.',
    correction: 'People use many parts of the brain, although not every neuron is maximally active at the same time.',
  },
  {
    pattern: /the great wall of china is (?:the only man[- ]made structure )?visible from space(?: with the naked eye)?/i,
    reason: 'A common but misleading claim about visibility from orbit.',
    keywords: ['Great Wall of China', 'human structures', 'visibility from space'],
    verdict: 'contradicted' as const,
    explanation: 'The Great Wall is generally too narrow to be distinguished with the naked eye from low Earth orbit, and it is not the only human-made structure visible from space.',
    correction: 'The Great Wall is difficult to see unaided from orbit; visibility depends on viewing conditions and many larger human-made features are easier to distinguish.',
  },
  {
    pattern: /drinking coffee causes cancer/i,
    reason: 'This overstates evidence that varies by cancer type and exposure.',
    keywords: ['coffee consumption', 'cancer risk', 'epidemiology'],
    verdict: 'partially-supported' as const,
    explanation: 'Research does not support a blanket claim that drinking coffee causes cancer. Evidence differs by cancer type, and very hot beverages are a separate exposure associated with esophageal cancer risk.',
    correction: 'Coffee itself is not established as a general cause of cancer; temperature and specific cancer outcomes matter when interpreting the evidence.',
  },
];

const send = (tabId: number, msg: ToContent) => chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
const progress = (tabId: number, p: Progress) => send(tabId, { type: 'PROGRESS', payload: p });

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function runScan(tabId: number, req: ScanRequest): Promise<ScanSummary> {
  const fail = (error: string): ScanSummary => { progress(tabId, { stage: 'error', message: error }); return { ok: false, claimsFound: 0, flagged: 0, error }; };
  const s = await getSettings();
  if (!s.enabled) return fail('falsealaram is turned off.');
  if (isBlockedUrl(req.pageUrl, s.blocklist)) return fail('Sensitive site (blocklist) - nothing was sent.');
  const keys = resolveKeys(s);
  const demoMode = s.mode === 'direct' && !keys.gemini && !keys.grok;
  if (s.mode === 'direct' && !demoMode && !keys.gemini)
    return fail('Add a Gemini API key in falsealaram options, or clear both keys to use demo mode.');
  try {
    progress(tabId, { stage: 'detecting', message: demoMode ? 'Demo mode: checking built-in examples…' : 'Scanning page for checkable claims…' });
    const claims = demoMode
      ? await detectDemoClaims(req.chunks, Math.min(MAX_PAGE_CLAIMS, req.maxClaims))
      : await detectClaims(req.chunks, s, Math.min(MAX_PAGE_CLAIMS, req.maxClaims));
    if (!claims.length) {
      const message = demoMode ? 'Demo mode: no built-in demo claims found.' : 'No claims met the current detection criteria.';
      progress(tabId, { stage: 'done', message });
      return { ok: true, claimsFound: 0, flagged: 0 };
    }
    claims.forEach((claim) => send(tabId, { type: 'CLAIM_PENDING', payload: { claim } }));
    let done = 0, flagged = 0, contradicted = 0, needsContext = 0;
    const tick = () => progress(tabId, { stage: 'checking', message: `Scanning… ${claims.length} claims found (${done}/${claims.length} checked)` });
    tick();
    await pool(claims, CONCURRENCY, async (c) => {
      const result = await checkClaim(c, s, demoMode).catch((e): FactCheckResult => ({
        claimId: c.id, claimHash: c.hash, claimText: c.text, verdict: 'insufficient-evidence',
        explanation: `Could not complete this check: ${describeError(e)}`, correction: '', supportingSources: [],
        sources: [], scholarUrl: scholarUrl(c.text), checkedAt: Date.now(), error: describeError(e), demoMode,
      }));
      done++;
      if (result.verdict === 'contradicted') { flagged++; contradicted++; }
      if (result.verdict === 'partially-supported' || result.verdict === 'insufficient-evidence') needsContext++;
      send(tabId, { type: 'CLAIM_RESULT', payload: { result } });
      tick();
    });
    progress(tabId, { stage: 'done', message: `Done: ${contradicted} contradicted, ${needsContext} needs context.` });
    return { ok: true, claimsFound: claims.length, flagged };
  } catch (e) { return fail(describeError(e)); }
}

async function detectClaims(chunks: Chunk[], s: Settings, max: number): Promise<Claim[]> {
  // dedupe + size-cap, then pack into batches
  const sourceText = new Map<string, string>(), uniq: Chunk[] = [], seenText = new Set<string>();
  for (const c of chunks) {
    const clipped = c.text.slice(0, MAX_CHUNK);
    const n = normalizeText(clipped);
    if (seenText.has(n)) continue;
    seenText.add(n); sourceText.set(c.id, clipped); uniq.push({ id: c.id, text: clipped });
  }
  const batches: Chunk[][] = []; let cur: Chunk[] = [], size = 0;
  for (const c of uniq) {
    if ((size + c.text.length > BATCH_CHARS || cur.length >= MAX_CHUNKS_PER_BATCH) && cur.length) { batches.push(cur); cur = []; size = 0; }
    cur.push(c); size += c.text.length;
  }
  if (cur.length) batches.push(cur);

  const found: Claim[] = [], hashes = new Set<string>();
  for (const b of batches.slice(0, MAX_BATCHES)) {
    let raw: unknown;
    try { raw = await callLLM('gemini', s, DETECT_SYSTEM, JSON.stringify(b), DETECT_SCHEMA); }
    catch (e) { if (!found.length) throw e; break; } // keep partial results
    for (const r of asDetect(raw)) {
      const original = sourceText.get(r.chunkId), needle = normalizeText(r.text);
      const start = original ? normalizeText(original).indexOf(needle) : -1;
      if (!original || needle.length < 15 || start < 0 || r.confidence < s.confidenceThreshold || !r.keywords.length) continue;
      const hash = await sha16(needle);
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      // Store the page's own spelling and punctuation so highlighting still maps
      // back to the original DOM, while allowing harmless model normalization.
      found.push({ id: '', hash, chunkId: r.chunkId, text: original.slice(start, start + needle.length), reason: r.reason, confidence: r.confidence, keywords: r.keywords });
    }
  }
  return found.sort((a, b) => b.confidence - a.confidence).slice(0, Math.min(MAX_PAGE_CLAIMS, max)).map((c, i) => ({ ...c, id: `${c.chunkId}-${i}` }));
}

async function detectDemoClaims(chunks: Chunk[], max: number): Promise<Claim[]> {
  const found: Claim[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const item of DEMO_CLAIMS) {
      const match = item.pattern.exec(chunk.text);
      if (!match || !match[0]) continue;
      const text = match[0];
      const hash = await sha16(normalizeText(text));
      if (seen.has(hash)) continue;
      seen.add(hash);
      found.push({
        id: `${chunk.id}-${found.length}`, hash, chunkId: chunk.id, text,
        reason: item.reason, confidence: 1, keywords: item.keywords,
      });
    }
  }
  return found.slice(0, Math.min(MAX_PAGE_CLAIMS, max));
}

const scholarUrl = (claim: string) => `https://scholar.google.com/scholar?q=${encodeURIComponent(claim)}`;

async function retrieve(c: Claim, s: Settings): Promise<Source[]> {
  if (s.mode === 'proxy') {
    const res = await fetchRetry(`${s.proxyUrl.replace(/\/$/, '')}/api/sources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-falsealaram-token': s.proxyToken },
      body: JSON.stringify({ keywords: c.keywords, limit: 3, scholar: s.scholarEnabled }),
    }, { timeoutMs: 40000 });
    return ((await res.json()) as any).sources ?? [];
  }
  return searchSources(c.keywords, { scholar: false, openAlexKey: resolveKeys(s).openAlex, limit: 3 });
}

async function checkClaim(c: Claim, s: Settings, demoMode: boolean): Promise<FactCheckResult> {
  const key = `${PREFIX}${demoMode ? 'demo:' : 'live:'}${c.hash}`;
  const hit = (await chrome.storage.local.get(key))[key] as FactCheckResult | undefined;
  if (hit && Date.now() - hit.checkedAt < TTL) return { ...hit, claimId: c.id, scholarUrl: hit.scholarUrl || scholarUrl(c.text) };

  const base = { claimId: c.id, claimHash: c.hash, claimText: c.text, scholarUrl: scholarUrl(c.text), checkedAt: Date.now(), demoMode };
  let sources: Source[] = [];
  let sourceError = '';
  try { sources = await retrieve(c, s); }
  catch (e) {
    if (!demoMode) throw e;
    sourceError = describeError(e);
  }
  let result: FactCheckResult;
  if (demoMode) {
    const example = DEMO_CLAIMS.find((item) => item.pattern.test(c.text));
    if (!example) throw new Error('No built-in demo result is available for this claim.');
    result = {
      ...base, verdict: example.verdict,
      explanation: `Demo mode: ${example.explanation}${sourceError ? ` Scholarly sources could not be loaded: ${sourceError}` : ''}`,
      correction: example.correction, supportingSources: [], sources,
    };
  } else if (!sources.length) {
    result = { ...base, verdict: 'insufficient-evidence', explanation: 'No scholarly sources were found for this claim.', correction: '', supportingSources: [], sources: [] };
  } else {
    // one batched Gemini call summarizes all sources (saves quota)
    const sums = asSummaries(await callLLM('gemini', s, SUM_SYSTEM, JSON.stringify({
      claim: c.text, sources: sources.map((x, i) => ({ n: i + 1, title: x.title, year: x.year, abstract: x.abstract.slice(0, 1500) })),
    }), SUM_SCHEMA));
    sources = sources.map((x, i) => ({ ...x, summary: sums.get(i + 1) || 'No summary available.' }));
    const v = asVerdict(await callLLM('grok', s, CMP_SYSTEM, JSON.stringify({
      claim: c.text, sources: sources.map((x, i) => ({ n: i + 1, title: x.title, year: x.year, provider: x.provider, summary: x.summary })),
    }), CMP_SCHEMA), sources.length);
    result = { ...base, ...v, sources };
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
