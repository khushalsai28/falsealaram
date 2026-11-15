import type { Claim, StatusResponse, ScanSummary, Settings, ToContent } from '../shared/types';
import { getSettings } from '../shared/settings';
import { isBlockedUrl } from '../shared/blocklist';
import { extract, type ChunkRef } from './extract';
import * as hl from './highlight';
import * as ui from './ui';

const MAX_CHUNKS = 60, MAX_CHARS = 24000, DEBOUNCE = 1500;
let S: Settings, active = false, scanning = false, status = 'Idle', claimsFound = 0;
let observer: MutationObserver | null = null, timer = 0;
const seen = new Set<string>();                 // hashes of text blocks already sent -> never re-checked
const refs = new Map<string, ChunkRef>();       // chunkId -> DOM refs for the current batch
const claims = new Map<string, Claim>();
const dirty = new Set<Element>();               // roots added by MutationObserver

function blockedReason(): string | null {
  if (chrome.extension?.inIncognitoContext) return 'Disabled in incognito windows.';
  if (isBlockedUrl(location.href, S.blocklist)) return 'Sensitive site (blocklist) - FalseAlarm is off here.';
  if (document.querySelector('input[type="password"]')) return 'Page has a password field - skipped for safety.';
  return null;
}

async function scan(manual: boolean) {
  if (scanning || !active) return;
  const why = blockedReason();
  if (why) { status = why; if (manual) ui.showProgress({ stage: 'error', message: why }); return; }
  const budget = S.maxClaims - claimsFound;
  if (budget <= 0) { status = `Claim limit (${S.maxClaims}) reached`; if (manual) ui.showProgress({ stage: 'done', message: status }); return; }

  scanning = true;
  try {
    const roots = manual || !dirty.size ? [document.body] : [...dirty];
    dirty.clear(); refs.clear();
    const pool = new Map<Element, ChunkRef>();
    for (const r of roots) for (const c of extract(r, seen)) pool.set(c.el, c);
    // closest-to-viewport first, then cap count/size
    const ranked = [...pool.values()].map((c) => { const t = c.el.getBoundingClientRect().top; return { c, k: t < 0 ? -t * 2 : t }; })
      .sort((a, b) => a.k - b.k).map((x) => x.c);
    const picked: ChunkRef[] = []; let chars = 0;
    for (const c of ranked) {
      if (picked.length >= MAX_CHUNKS || chars + c.text.length > MAX_CHARS) break;
      picked.push(c); chars += c.text.length; seen.add(c.hash); refs.set(c.id, c);
    }
    if (!picked.length) { if (manual) ui.showProgress({ stage: 'done', message: 'No new text to scan.' }); return; }

    const res = (await chrome.runtime.sendMessage({
      type: 'SCAN_REQUEST', payload: { pageUrl: location.href, chunks: picked.map(({ id, text }) => ({ id, text })), maxClaims: budget },
    })) as ScanSummary | undefined;
    if (!res) throw new Error('No response from FalseAlarm background.');
    claimsFound += res.claimsFound;
    if (!res.ok && res.error) status = res.error;
    startObserver();
  } catch (e) {
    const m = /context invalidated|Receiving end/i.test(String((e as Error).message)) ? 'FalseAlarm was updated - reload this tab.' : (e as Error).message;
    status = m; ui.showProgress({ stage: 'error', message: m });
  } finally {
    scanning = false;
    if (dirty.size) schedule();
  }
}

function schedule() { clearTimeout(timer); timer = window.setTimeout(() => void scan(false), DEBOUNCE); }
function startObserver() {
  if (observer) return;
  observer = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      const el = n.nodeType === 1 ? (n as Element) : n.nodeType === 3 ? n.parentElement : null;
      if (el) dirty.add(el);
    }
    if (dirty.size > 200) { dirty.clear(); dirty.add(document.body); }
    if (dirty.size) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true }); // our UI lives on <html>, not <body>
}

function teardown() {
  active = false; observer?.disconnect(); observer = null; clearTimeout(timer);
  dirty.clear(); refs.clear(); claims.clear(); hl.clear(); ui.destroy(); status = 'Off';
}

chrome.runtime.onMessage.addListener((msg: ToContent, _s, send) => {
  switch (msg.type) {
    case 'PROGRESS': status = msg.payload.message; if (active) ui.showProgress(msg.payload); break;
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
    case 'POPUP_SCAN': void scan(true); send({ ok: true }); break;
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
