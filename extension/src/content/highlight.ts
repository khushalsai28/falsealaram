import type { Claim, FactCheckResult } from '../shared/types';
import { foldChars, normalizeText } from '../shared/text';

// CSS Custom Highlight API: paints ranges without touching the DOM or layout.
type Kind = 'pending' | 'red' | 'orange' | 'none';
export interface Entry { claim: Claim; range: Range; kind: Kind; result?: FactCheckResult }

const entries = new Map<string, Entry>();
let sets: Record<string, any> | null = null;
let styleEl: HTMLStyleElement | null = null;
const CSS_TEXT = `
::highlight(falsealarm-red){background-color:rgba(220,38,38,.18);text-decoration:underline wavy #dc2626}
::highlight(falsealarm-orange){background-color:rgba(234,88,12,.18);text-decoration:underline wavy #ea580c}
::highlight(falsealarm-pending){text-decoration:underline dotted #9ca3af}`;

export const supported = () => !!(CSS as any).highlights && 'Highlight' in globalThis;

function init() {
  if (sets) return;
  styleEl = document.createElement('style');
  styleEl.textContent = CSS_TEXT;
  document.head.appendChild(styleEl);
  sets = {};
  for (const k of ['pending', 'red', 'orange']) {
    sets[k] = new (globalThis as any).Highlight();
    (CSS as any).highlights.set(`falsealarm-${k}`, sets[k]);
  }
}

/** Find `claim` inside the chunk's text nodes (whitespace/quote tolerant) and return a DOM Range. */
function locate(nodes: Text[], claim: string): Range | null {
  let s = '';
  const map: { n: Text; o: number }[] = [];
  const push = (n: Text, o: number, ch: string) => { s += ch; map.push({ n, o }); };
  for (const n of nodes) {
    if (!n.isConnected || !n.data) continue;
    if (s && !s.endsWith(' ') && !/^\s/.test(n.data)) push(n, 0, ' ');
    for (let i = 0; i < n.data.length; i++) {
      const ch = n.data[i];
      if (/\s/.test(ch)) { if (s && !s.endsWith(' ')) push(n, i, ' '); }
      else push(n, i, ch);
    }
  }
  const q = normalizeText(claim);
  const idx = foldChars(s).indexOf(q);
  if (idx < 0 || !q) return null;
  const a = map[idx], b = map[idx + q.length - 1];
  if (!a || !b) return null;
  const r = new Range();
  r.setStart(a.n, a.o);
  r.setEnd(b.n, b.o + 1);
  return r;
}

export function addPending(claim: Claim, nodes: Text[]): boolean {
  const range = locate(nodes, claim.text);
  if (!range) return false;
  init();
  entries.set(claim.id, { claim, range, kind: 'pending' });
  sets!.pending.add(range);
  return true;
}

const kindOf = (r: FactCheckResult): Kind =>
  r.error ? 'pending' : r.verdict === 'contradicted' ? 'red' : r.verdict === 'supported' ? 'none' : 'orange';

export function resolve(r: FactCheckResult): Entry | undefined {
  const e = entries.get(r.claimId);
  if (!e || !sets) return;
  sets[e.kind]?.delete(e.range);
  e.kind = kindOf(r);
  e.result = r;
  sets[e.kind]?.add(e.range);
  return e;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d: any = document;
  if (d.caretPositionFromPoint) { const p = d.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

export function hitTest(x: number, y: number): Entry | null {
  if (!entries.size) return null;
  const c = caretAt(x, y);
  if (!c) return null;
  for (const e of entries.values()) {
    if (e.kind === 'none' || !e.range.isPointInRange(c.node, c.offset)) continue;
    // caret lookups snap to the nearest text; confirm the pointer is really over the highlight
    for (const r of e.range.getClientRects())
      if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return e;
  }
  return null;
}

export const flagged = () => [...entries.values()].filter((e) => (e.kind === 'red' || e.kind === 'orange') && e.result);
export const count = () => entries.size;
export function clear() {
  entries.clear();
  if (sets) for (const k of Object.keys(sets)) (CSS as any).highlights.delete(`falsealarm-${k}`);
  sets = null;
  styleEl?.remove();
  styleEl = null;
}
