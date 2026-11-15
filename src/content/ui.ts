import type { Claim, FactCheckResult, Progress } from '../shared/types';
import { verdictCopy, verdictDisplay } from '../shared/verdict';
import { HOST_ID } from './extract';

const CSS_TEXT = `
:host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#pill{position:fixed;right:16px;bottom:16px;background:#111827;color:#fff;font-size:12px;padding:8px 12px;border-radius:999px;box-shadow:0 4px 14px #0004;pointer-events:none}
#pill.err{background:#991b1b}
#claim-index-button{position:fixed;right:16px;bottom:58px;border:0;border-radius:999px;background:#4338ca;color:#fff;font-size:12px;font-weight:700;padding:8px 12px;box-shadow:0 4px 14px #0004;cursor:pointer}
#claim-index-button:hover{background:#3730a3}
#claim-index{position:fixed;right:16px;bottom:104px;width:380px;max-width:calc(100vw - 32px);max-height:58vh;overflow:auto;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px #0003;padding:14px;font-size:13px;line-height:1.45}
.index-hd{display:flex;align-items:center;justify-content:space-between;gap:10px}.index-hd strong{font-size:14px}.claim-row{padding:10px 0;border-top:1px solid #eef2f7}.claim-row:first-child{border-top:0}.claim-row-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700}.claim-row-text{margin:5px 0 0}.claim-row-detail{margin:5px 0 0;color:#475569}.claim-row-detail b{color:#334155}
#card{position:fixed;width:360px;max-width:calc(100vw - 16px);max-height:70vh;overflow:auto;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px #0003;padding:14px;font-size:13px;line-height:1.45;outline:none}
.hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.brand{font-weight:700;font-size:12px;letter-spacing:.04em;color:#4f46e5}
.x{border:0;background:#f3f4f6;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:13px}.x:hover{background:#e5e7eb}
blockquote{margin:0 0 10px;padding:8px 10px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:6px;font-style:italic}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase}
.contradicted{background:#dc2626}.partially_supported{background:#ea580c}.insufficient_evidence{background:#6b7280}.supported{background:#16a34a}
p{margin:8px 0}.fix{background:#ecfdf5;border-radius:8px;padding:8px}
ol{padding-left:18px;margin:8px 0}li{margin-bottom:8px}
a{color:#2563eb;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
.meta{color:#6b7280;font-size:11px}.tag{background:#eef2ff;color:#4338ca;border-radius:6px;padding:0 5px;margin-left:4px}
.ft{margin-top:10px;padding-top:8px;border-top:1px solid #f0f0f0;color:#6b7280;font-size:11px}
.sk{height:10px;border-radius:5px;margin:8px 0;background:linear-gradient(90deg,#eee 25%,#f7f7f7 50%,#eee 75%);background-size:200% 100%;animation:sh 1.2s infinite}
@keyframes sh{to{background-position:-200% 0}}[hidden]{display:none!important}`;

interface IndexedClaim { claim: Claim; index: number; result?: FactCheckResult }

let host: HTMLElement | null = null, pill: HTMLElement, card: HTMLElement;
let claimIndexButton: HTMLButtonElement, claimIndexPanel: HTMLElement;
const indexedClaims = new Map<string, IndexedClaim>();
let openId: string | null = null, getRect: (() => DOMRect) | null = null, prevFocus: Element | null = null, hideT = 0;

// Build DOM with textContent only: claim/source text comes from pages and LLMs (untrusted).
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | false | null)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) if (k) e.append(k);
  return e;
}
const safeUrl = (u: string) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

function ensure() {
  if (host?.isConnected) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const st = document.createElement('style');
  st.textContent = CSS_TEXT;
  pill = h('div', { id: 'pill' });
  claimIndexButton = h('button', { id: 'claim-index-button', type: 'button', 'aria-expanded': 'false' }, 'Claims (0)') as HTMLButtonElement;
  claimIndexPanel = h('section', { id: 'claim-index', role: 'dialog', 'aria-label': 'Claim index' });
  card = h('div', { id: 'card', role: 'dialog', 'aria-label': 'falsealaram fact check', tabindex: '-1' });
  pill.hidden = card.hidden = claimIndexButton.hidden = claimIndexPanel.hidden = true;
  claimIndexButton.addEventListener('click', () => {
    claimIndexPanel.hidden = !claimIndexPanel.hidden;
    claimIndexButton.setAttribute('aria-expanded', String(!claimIndexPanel.hidden));
    if (!claimIndexPanel.hidden) renderClaimIndex();
  });
  root.append(st, pill, claimIndexButton, claimIndexPanel, card);
  document.documentElement.appendChild(host);
}

export const isInside = (e: Event) => !!host && e.composedPath().includes(host);

export function showProgress(p: Progress) {
  ensure();
  pill.textContent = `falsealaram · ${p.message}`;
  pill.className = p.stage === 'error' ? 'err' : '';
  pill.hidden = false;
  clearTimeout(hideT);
  if (p.stage === 'done' || p.stage === 'error') hideT = window.setTimeout(() => (pill.hidden = true), p.stage === 'error' ? 9000 : 5000);
}

function place() {
  if (!getRect || card.hidden) return;
  const r = getRect(), w = card.offsetWidth, ht = card.offsetHeight;
  let top = r.bottom + 8;
  if (top + ht > innerHeight - 8) top = Math.max(8, r.top - ht - 8);
  card.style.top = `${top}px`;
  card.style.left = `${Math.min(Math.max(8, r.left), Math.max(8, innerWidth - w - 8))}px`;
}
let raf = 0;
const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeCard(); } };

function sourceItem(s: FactCheckResult['sources'][number], n: number, supports: boolean) {
  const url = safeUrl(s.url);
  const title = url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, s.title) : h('span', {}, s.title);
  const providerLabels: Record<string, string> = {
    'google-scholar': 'Google Scholar', 'semantic-scholar': 'Semantic Scholar', openalex: 'OpenAlex', none: 'No provider',
    Wikipedia: 'Wikipedia', 'Semantic Scholar': 'Semantic Scholar', OpenAlex: 'OpenAlex', 'Google Scholar': 'Google Scholar', None: 'No provider',
  };
  const who = s.authors.split(', ').slice(0, 3).join(', ');
  const authorText = s.authors.split(', ').length > 3 ? `${who} et al.` : who;
  return h('li', {}, title, h('span', { class: 'tag' }, providerLabels[s.provider]), supports && h('span', { class: 'tag' }, '✓ supports verdict'),
    h('div', { class: 'meta' }, [authorText, s.year].filter(Boolean).join(' · ')), h('div', {}, s.summary ?? s.snippet ?? s.abstract ?? ''));
}

function detailFor(r: FactCheckResult): { label: string; text: string } | null {
  const copy = verdictCopy(r.verdict);
  const text = r.correction || r.explanation;
  return text ? { label: copy.detailLabel, text } : null;
}

function renderClaimIndex() {
  if (!claimIndexPanel || claimIndexPanel.hidden) return;
  const entries = [...indexedClaims.values()].sort((a, b) => a.index - b.index);
  const close = h('button', { class: 'x', type: 'button', 'aria-label': 'Close claim index' }, 'x');
  close.addEventListener('click', () => {
    claimIndexPanel.hidden = true;
    claimIndexButton.setAttribute('aria-expanded', 'false');
  });
  const list = h('ol');
  for (const entry of entries) {
    const status = entry.result ? verdictDisplay(entry.result.verdict) : 'Checking';
    const detail = entry.result ? detailFor(entry.result) : null;
    const className = entry.result ? `badge ${verdictCopy(entry.result.verdict).key}` : 'tag';
    list.append(h('li', { class: 'claim-row' },
      h('div', { class: 'claim-row-hd' }, h('span', {}, `Claim #${entry.index}`), h('span', { class: className }, status)),
      h('p', { class: 'claim-row-text' }, entry.claim.text),
      detail ? h('p', { class: 'claim-row-detail' }, h('b', {}, `${detail.label}: `), detail.text) : null,
    ));
  }
  claimIndexPanel.replaceChildren(h('div', { class: 'index-hd' }, h('strong', {}, `Claim index (${entries.length})`), close), list);
}

/** Keep a readable, numbered index alongside the page highlights. */
export function upsertClaim(claim: Claim, index: number, result?: FactCheckResult) {
  ensure();
  const existing = indexedClaims.get(claim.id);
  indexedClaims.set(claim.id, { claim, index: existing?.index ?? index, result: result ?? existing?.result });
  claimIndexButton.hidden = indexedClaims.size === 0;
  claimIndexButton.textContent = `Claims (${indexedClaims.size})`;
  renderClaimIndex();
}

export function clearClaimIndex() {
  indexedClaims.clear();
  if (!host?.isConnected) return;
  claimIndexButton.hidden = true;
  claimIndexPanel.hidden = true;
  claimIndexButton.setAttribute('aria-expanded', 'false');
  claimIndexPanel.replaceChildren();
}

function render(claim: Claim, r?: FactCheckResult) {
  const close = h('button', { class: 'x', 'aria-label': 'Close (Esc)' }, '✕');
  close.addEventListener('click', closeCard);
  const claimNumber = indexedClaims.get(claim.id)?.index ?? 1;
  let body: Node;
  if (!r) {
    body = h('div', {}, h('div', { class: 'meta' }, 'Checking scholarly sources…'), h('div', { class: 'sk' }), h('div', { class: 'sk' }), h('div', { class: 'sk', style: 'width:60%' }));
  } else {
    const ol = h('ol');
    r.sources.forEach((s, i) => ol.append(sourceItem(s, i + 1, r.supportingSources.includes(i + 1))));
    const detail = detailFor(r);
    body = h('div', {},
      h('span', { class: `badge ${verdictCopy(r.verdict).key}` }, verdictDisplay(r.verdict)),
      h('p', {}, r.explanation),
      detail ? h('p', { class: 'fix' }, h('b', {}, `${detail.label}: `), detail.text) : null,
      r.demoMode ? h('p', { class: 'meta' }, 'Demo result — built-in example; live scholarly lookup is used for sources.') : null,
      r.sources.length ? h('div', { class: 'meta' }, 'Sources') : null, r.sources.length ? ol : null,
      safeUrl(r.scholarUrl) && h('p', {}, h('a', { href: safeUrl(r.scholarUrl)!, target: '_blank', rel: 'noopener noreferrer' }, 'Search this claim on Google Scholar')));
  }
  card.replaceChildren(h('div', { class: 'hd' }, h('span', { class: 'brand' }, `falsealaram · Claim #${claimNumber}`), close),
    h('blockquote', {}, claim.text), body,
    h('div', { class: 'ft' }, 'AI-assisted results — verify with the sources before sharing.'));
  return close;
}

export function openCard(claim: Claim, r: FactCheckResult | undefined, rect: () => DOMRect) {
  ensure();
  if (openId === null) prevFocus = document.activeElement;
  openId = claim.id;
  getRect = rect;
  const close = render(claim, r);
  card.hidden = false;
  place();
  close.focus({ preventScroll: true });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
}
/** Called when a result arrives; only re-renders if the user still has THIS claim open (never reopens). */
export function updateCard(claim: Claim, r: FactCheckResult) {
  if (openId !== claim.id) return;
  render(claim, r);
  place();
}
export function closeCard() {
  if (openId === null) return;
  openId = null; getRect = null;
  card.hidden = true;
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('scroll', onMove, true);
  window.removeEventListener('resize', onMove);
  if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
}
export function destroy() {
  closeCard();
  clearClaimIndex();
  host?.remove();
  host = null;
}
