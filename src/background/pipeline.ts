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

const PREFIX = 'fl:v1:', TTL = 7 * 864e5, MAX_CACHE = 300;
const MAX_CHUNK = 1500, BATCH_CHARS = 12000, MAX_BATCHES = 45, CONCURRENCY = 2;

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
  for (const b of batches.slice(0, MAX_BATCHES)) {
    let raw: unknown;
    try { raw = await callLLM('gemini', s, DETECT_SYSTEM, JSON.stringify(b), DETECT_SCHEMA); }
    catch (e) { if (!found.length) throw e; break; } // keep partial results
    for (const r of asDetect(raw)) {
      const hay = norm.get(r.chunkId), needle = normalizeText(r.text);
      // guard against hallucinated / non-verbatim claims (they could not be highlighted)
      if (!hay || needle.length < 15 || !hay.includes(needle) || r.confidence < s.confidenceThreshold || !r.keywords.length) continue;
      const hash = await sha16(needle);
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      found.push({ id: '', hash, chunkId: r.chunkId, text: r.text, reason: r.reason, confidence: r.confidence, keywords: r.keywords });
    }
  }
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

async function checkClaim(c: Claim, s: Settings): Promise<FactCheckResult> {
  const key = PREFIX + c.hash;
  const hit = (await chrome.storage.local.get(key))[key] as FactCheckResult | undefined;
  if (hit && Date.now() - hit.checkedAt < TTL) return { ...hit, claimId: c.id };

  const base = { claimId: c.id, claimHash: c.hash, claimText: c.text, checkedAt: Date.now() };
  let sources = await retrieve(c, s);
  let result: FactCheckResult;
  if (!sources.length) {
    result = { ...base, verdict: 'insufficient evidence', explanation: 'No scholarly sources were found for this claim.', correction: '', supportingSources: [], sources: [] };
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
