import type { Claim, StatusResponse, ScanSummary, Settings, ToContent } from '../shared/types';
import { getSettings } from '../shared/settings';
import { isBlockedUrl } from '../shared/blocklist';
import { extract, type ChunkRef } from './extract';
import * as hl from './highlight';
import * as ui from './ui';

const MAX_CHUNKS = 15000, MAX_CHARS = 1000000, DEBOUNCE = 1500;
let S: Settings, active = false, scanning = false, status = 'Idle', claimsFound = 0;
let observer: MutationObserver | null = null, timer = 0;
const seen = new Set<string>();
let retryAt = 0;
const refs = new Map<string, ChunkRef>();       // chunkId -> DOM refs for the current batch
const claims = new Map<string, Claim>();
const dirty = new Set<Element>();               // roots added by MutationObserver

function visiblePassword(): boolean {
  const nodes = document.querySelectorAll('input[type="password"], input[autocomplete~="current-password"], input[autocomplete~="new-password"]');
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const box = node.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    if (node.closest('[hidden], [aria-hidden="true"]')) continue;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    return true;
  }
  return false;
}

function blockedReason(): string | null {
  if (chrome.extension?.inIncognitoContext) return 'Disabled in incognito windows.';
  if (isBlockedUrl(location.href, S.blocklist)) return 'Sensitive site (blocklist) - FalseAlarm is off here.';
  if (visiblePassword()) return 'Page has a password field - skipped for safety.';
  return null;
}

async function scan(manual: boolean) {
  if (!active) return;
  if (scanning) {
    if (manual) ui.showProgress({ stage: 'detecting', message: status || 'Already scanning this page…' });
    return;
  }
  const why = blockedReason();
  if (why) { status = why; if (manual) ui.showProgress({ stage: 'error', message: why }); return; }
  const budget = S.maxClaims - claimsFound;
  if (budget <= 0) { status = `Claim limit (${S.maxClaims}) reached`; if (manual) ui.showProgress({ stage: 'done', message: status }); return; }

  if (!manual && Date.now() < retryAt) { arm(retryAt - Date.now()); return; }
  scanning = true;
  status = 'Reading this page…';
  if (manual) ui.showProgress({ stage: 'detecting', message: status });
  try {
    if (S.autoScan) startObserver();
    const roots = manual || !dirty.size ? [document.body] : [...dirty];
    dirty.clear(); refs.clear();
    const pool = new Map<string, ChunkRef>();
    for (const r of roots) for (const c of extract(r, seen)) pool.set(c.hash, c);
    const ranked = [...pool.values()].map((c) => { const t = c.el.getBoundingClientRect().top; return { c, k: t < 0 ? -t * 2 : t }; })
      .sort((a, b) => a.k - b.k).map((x) => x.c);
    const picked: ChunkRef[] = []; let chars = 0;
    for (const c of ranked) {
      if (picked.length >= MAX_CHUNKS) break;
      if (chars + c.text.length > MAX_CHARS) continue;
      picked.push(c); chars += c.text.length; refs.set(c.id, c);
    }
    if (!picked.length) {
      status = 'No new text to scan.';
      if (manual) ui.showProgress({ stage: 'done', message: status });
      return;
    }

    status = 'Checking this page for suspicious claims…';
    ui.showProgress({ stage: 'detecting', message: status });
    const res = (await chrome.runtime.sendMessage({
      type: 'SCAN_REQUEST', payload: { pageUrl: location.href, chunks: picked.map(({ id, text }) => ({ id, text })), maxClaims: budget },
    })) as ScanSummary | undefined;
    if (!res) throw new Error('No response from FalseAlarm background.');
    if (res.ok) { for (const c of picked) seen.add(c.hash); retryAt = 0; }
    else { retryAt = Date.now() + 60_000; dirty.add(document.body); }
    claimsFound += res.claimsFound;
    if (!res.ok && res.error) status = res.error;
  } catch (e) {
    const m = /context invalidated|Receiving end/i.test(String((e as Error).message)) ? 'FalseAlarm was updated - reload this tab.' : (e as Error).message;
    status = m; retryAt = Date.now() + 60_000; dirty.add(document.body);
    ui.showProgress({ stage: 'error', message: m });
  } finally {
    scanning = false;
    if (S.autoScan && dirty.size) arm(Math.max(DEBOUNCE, retryAt - Date.now()));
  }
}

function sectionOf(range: Range): string {
  const y = range.getBoundingClientRect().top + window.scrollY;
  let best = '';
  for (const heading of document.querySelectorAll('h1, h2, h3')) {
    if (heading.getBoundingClientRect().top + window.scrollY > y + 8) break;
    const text = (heading.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) best = text.slice(0, 80);
  }
  return best;
}

function flaggedJumps(): ui.JumpItem[] {
  return hl.flagged()
    .map((e) => ({ e, top: e.range.getBoundingClientRect().top + window.scrollY }))
    .sort((a, b) => a.top - b.top)
    .map(({ e }) => ({
      text: e.claim.text,
      verdict: e.result?.verdict ?? 'contradicted',
      where: sectionOf(e.range),
      jump: () => {
        const rect = e.range.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, rect.top + window.scrollY - 120), behavior: 'smooth' });
        ui.openCard(e.claim, e.result, () => e.range.getBoundingClientRect());
      },
    }));
}

function arm(ms: number) { clearTimeout(timer); timer = window.setTimeout(() => void scan(false), ms); }
function schedule() { arm(DEBOUNCE); }
function startObserver() {
  if (observer) return;
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') { const el = m.target.parentElement; if (el) dirty.add(el); continue; }
      for (const n of m.addedNodes) {
        const el = n.nodeType === 1 ? (n as Element) : n.nodeType === 3 ? n.parentElement : null;
        if (el) dirty.add(el);
      }
    }
    if (dirty.size > 80) { dirty.clear(); clearTimeout(timer); return; }
    if (dirty.size) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function teardown() {
  active = false; observer?.disconnect(); observer = null; clearTimeout(timer);
  dirty.clear(); refs.clear(); claims.clear(); hl.clear(); ui.destroy(); status = 'Off';
}

chrome.runtime.onMessage.addListener((msg: ToContent, _s, send) => {
  switch (msg.type) {
    case 'PROGRESS':
      status = msg.payload.message;
      if (active) ui.showProgress(msg.payload);
      if (active && msg.payload.stage === 'done') ui.showClaimList(flaggedJumps());
      break;
    case 'CLAIM_PENDING': {
      const ref = refs.get(msg.payload.claim.chunkId);
      if (ref && hl.addPending(msg.payload.claim, ref.nodes)) claims.set(msg.payload.claim.id, msg.payload.claim);
      break;
    }
    case 'CLAIM_RESULT': {
      const e = hl.resolve(msg.payload.result);
      if (e) ui.updateCard(e.claim, msg.payload.result);
      break;
    }
    case 'POPUP_SCAN':
      if (active && !scanning) status = 'Reading this page…';
      send({ ok: true });
      setTimeout(() => { void scan(true); }, 0);
      break;
    case 'GET_STATUS':
      send({ enabled: active, blocked: S ? blockedReason() : null, status, claims: claimsFound } satisfies StatusResponse); break;
  }
});

document.addEventListener('click', (e) => {
  if (!active || ui.isInside(e)) return;
  const hit = hl.hitTest(e.clientX, e.clientY);
  if (!hit) { ui.closeCard(); return; }
  if ((e.target as Element | null)?.closest?.('a')) e.preventDefault(); // don't navigate away when clicking a highlighted link
  ui.openCard(hit.claim, hit.result, () => hit.range.getBoundingClientRect());
}, true);

chrome.storage.onChanged.addListener(async (ch) => {
  if (!ch.settings) return;
  S = await getSettings();
  if (!S.enabled && active) teardown();
  else if (S.enabled && !active) { active = true; status = 'Idle'; }
});

(async () => {
  S = await getSettings();
  active = S.enabled && hl.supported();
  if (active && S.autoScan) setTimeout(() => void scan(false), 1500);
})();
