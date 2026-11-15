import type { Claim, FactCheckResult, Progress } from '../shared/types';
import { HOST_ID } from './extract';

const CSS_TEXT = `
:host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#pill{position:fixed;right:16px;bottom:16px;background:#111827;color:#fff;font-size:12px;padding:8px 12px;border-radius:999px;box-shadow:0 4px 14px #0004;pointer-events:none;z-index:1}
#pill.err{background:#991b1b}
#list{position:fixed;left:16px;bottom:16px;width:320px;max-width:calc(100vw - 32px);max-height:50vh;overflow:auto;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px #0003;padding:12px;font-size:13px;line-height:1.4;z-index:1}
#card{position:fixed;width:360px;max-width:calc(100vw - 16px);max-height:70vh;overflow:auto;background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 40px #0003;padding:14px;font-size:13px;line-height:1.45;outline:none;z-index:2}
.jump{display:block;width:100%;text-align:left;border:0;background:#f9fafb;border-radius:8px;padding:8px;margin:0 0 8px;cursor:pointer;font:inherit;color:inherit}
.jump:hover{background:#eef2ff}
.where{display:block;color:#6b7280;font-size:11px;font-weight:500;margin-bottom:2px}
.hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.brand{font-weight:700;font-size:12px;letter-spacing:.04em;color:#4f46e5}
.x{border:0;background:#f3f4f6;border-radius:8px;width:26px;height:26px;cursor:pointer;font-size:13px}.x:hover{background:#e5e7eb}
blockquote{margin:0 0 10px;padding:8px 10px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:6px;font-style:italic}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;text-transform:uppercase}
.contradicted{background:#dc2626}.partially{background:#ea580c}.insufficient{background:#6b7280}.supported{background:#16a34a}
p{margin:8px 0}.fix{background:#ecfdf5;border-radius:8px;padding:8px}
ol{padding-left:18px;margin:8px 0}li{margin-bottom:8px}
a{color:#2563eb;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
.meta{color:#6b7280;font-size:11px}.tag{background:#eef2ff;color:#4338ca;border-radius:6px;padding:0 5px;margin-left:4px}
.ft{margin-top:10px;padding-top:8px;border-top:1px solid #f0f0f0;color:#6b7280;font-size:11px}
.sk{height:10px;border-radius:5px;margin:8px 0;background:linear-gradient(90deg,#eee 25%,#f7f7f7 50%,#eee 75%);background-size:200% 100%;animation:sh 1.2s infinite}
@keyframes sh{to{background-position:-200% 0}}[hidden]{display:none!important}`;

let host: HTMLElement | null = null, pill: HTMLElement, list: HTMLElement, card: HTMLElement;
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
  list = h('div', { id: 'list', role: 'dialog', 'aria-label': 'Flagged claims' });
  card = h('div', { id: 'card', role: 'dialog', 'aria-label': 'FalseAlarm fact check', tabindex: '-1' });
  pill.hidden = list.hidden = card.hidden = true;
  root.append(st, pill, list, card);
  document.documentElement.appendChild(host);
}

export const isInside = (e: Event) => !!host && e.composedPath().includes(host);

export interface JumpItem { text: string; verdict: string; where: string; jump: () => void }

export function showClaimList(items: JumpItem[]) {
  ensure();
  const close = h('button', { class: 'x', 'aria-label': 'Close list' }, '✕');
  close.addEventListener('click', () => { list.hidden = true; });
  const rows = items.map((item) => {
    const quote = item.text.length > 160 ? `${item.text.slice(0, 160)}…` : item.text;
    const btn = h('button', { class: 'jump', type: 'button' },
      item.where ? h('span', { class: 'where' }, item.where) : '',
      h('span', { class: `badge ${item.verdict.split(' ')[0]}` }, item.verdict),
      ' ', quote);
    btn.addEventListener('click', item.jump);
    return btn;
  });
  list.replaceChildren(
    h('div', { class: 'hd' }, h('span', { class: 'brand' }, 'FLAGGED ON THIS PAGE'), close),
    ...(rows.length ? rows : [h('p', { class: 'meta' }, 'No false or misleading claims were flagged.')]),
  );
  list.hidden = false;
}

export function showProgress(p: Progress) {
  ensure();
  pill.textContent = `FalseAlarm · ${p.message}`;
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
  const who = s.authors.length > 3 ? `${s.authors.slice(0, 3).join(', ')} et al.` : s.authors.join(', ');
  const rel = typeof s.reliability === 'number' ? `reliability ${Math.round(s.reliability * 100)}%` : '';
  return h('li', {}, title, h('span', { class: 'tag' }, s.provider), supports && h('span', { class: 'tag' }, '✓ supports verdict'),
    h('div', { class: 'meta' }, [who, s.year, rel].filter(Boolean).join(' · ')), h('div', {}, s.summary ?? ''));
}

function render(claim: Claim, r?: FactCheckResult) {
  const close = h('button', { class: 'x', 'aria-label': 'Close (Esc)' }, '✕');
  close.addEventListener('click', closeCard);
  let body: Node;
  if (!r) {
    body = h('div', {}, h('div', { class: 'meta' }, 'Checking sources…'), h('div', { class: 'sk' }), h('div', { class: 'sk' }), h('div', { class: 'sk', style: 'width:60%' }));
  } else {
    const ol = h('ol');
    r.sources.forEach((s, i) => ol.append(sourceItem(s, i + 1, r.supportingSources.includes(i + 1))));
    body = h('div', {},
      h('span', { class: `badge ${r.verdict.split(' ')[0]}` }, r.verdict),
      h('p', {}, r.explanation),
      r.correction && h('p', { class: 'fix' }, h('b', {}, 'Corrected info: '), r.correction),
      r.sources.length ? h('div', { class: 'meta' }, 'Sources') : null, r.sources.length ? ol : null);
  }
  card.replaceChildren(h('div', { class: 'hd' }, h('span', { class: 'brand' }, 'FALSEALARM'), close),
    h('blockquote', {}, claim.text), body,
    h('div', { class: 'ft' }, 'AI-assisted result - may be wrong or incomplete. Verify with the cited sources.'));
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
export function destroy() { closeCard(); host?.remove(); host = null; }
