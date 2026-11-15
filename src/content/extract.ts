import { hash32 } from '../shared/text';

export const HOST_ID = 'falsealaram-root';
export interface ChunkRef { id: string; hash: string; el: Element; nodes: Text[]; text: string }

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'NAV', 'FOOTER', 'ASIDE', 'IFRAME', 'SVG', 'CANVAS',
  'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON', 'CODE', 'PRE', 'HEAD', 'VIDEO', 'AUDIO']);
const ROLES = new Set(['navigation', 'contentinfo', 'complementary', 'dialog']);
const AD = /(^|[\s_-])(ads?|advert(isement)?|sponsored|cookie|consent|newsletter|promo)($|[\s_-])/i;
const MIN_WORDS = 4, MAX_CHARS = 1500;

function skippable(e: Element): boolean {
  if (e.id === HOST_ID || SKIP.has(e.tagName.toUpperCase())) return true;
  if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true' || e.getAttribute('contenteditable') === 'true') return true;
  const role = e.getAttribute('role');
  if (role && ROLES.has(role)) return true;
  return AD.test(`${e.id} ${typeof e.className === 'string' ? e.className : ''}`);
}

// Tag names that do not start a paragraph. Avoid getComputedStyle here: calling it for every
// text node forces layout and freezes large pages (Wikipedia) before the popup can update.
const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BIG', 'BR', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'KBD', 'MARK', 'NOBR', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'TT', 'U', 'VAR', 'WBR']);
const blockCache = new WeakMap<Element, Element>();
function blockOf(el: Element): Element {
  let b = blockCache.get(el);
  if (b) return b;
  let cur = el;
  while (cur.parentElement && cur !== document.body && INLINE.has(cur.tagName)) cur = cur.parentElement;
  blockCache.set(el, cur);
  return cur;
}

function hidden(el: Element): boolean {
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.closest('[hidden],[aria-hidden="true"]')) return true;
  if (el.offsetParent !== null) return false;
  const position = getComputedStyle(el).position;
  return position !== 'fixed' && position !== 'sticky';
}

let seq = 0;
/** Collect visible text blocks under `root`, skipping hashes in `seen`. Keeps Text-node refs for highlighting. */
export function extract(root: Element, seen: Set<string>): ChunkRef[] {
  for (let a: Element | null = root; a; a = a.parentElement) if (skippable(a)) return [];
  const groups = new Map<Element, Text[]>();
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeType === 1
      ? (skippable(n as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) // REJECT prunes the subtree
      : ((n as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = n.parentElement;
    if (!p) continue;
    const b = blockOf(p);
    const list = groups.get(b);
    list ? list.push(n as Text) : groups.set(b, [n as Text]);
  }
  const out: ChunkRef[] = [], local = new Set<string>();
  for (const [el, nodes] of groups) {
    const text = nodes.map((n) => n.data).join('').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
    if (text.split(' ').length < MIN_WORDS) continue;
    const hash = hash32(text);
    if (seen.has(hash) || local.has(hash) || hidden(el)) continue;
    local.add(hash);
    out.push({ id: `c${seq++}`, hash, el, nodes, text });
  }
  return out;
}
