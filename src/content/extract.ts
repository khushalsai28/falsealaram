import { hash32 } from '../shared/text';

export const HOST_ID = 'falsealarm-root';
export interface ChunkRef { id: string; hash: string; el: Element; nodes: Text[]; text: string }

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'NAV', 'FOOTER', 'ASIDE', 'IFRAME', 'SVG', 'CANVAS',
  'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'BUTTON', 'CODE', 'PRE', 'HEAD', 'VIDEO', 'AUDIO']);
const ROLES = new Set(['navigation', 'contentinfo', 'complementary', 'dialog']);
const AD = /(^|[\s_-])(ads?|advert(isement)?|sponsored|cookie|consent|newsletter|promo)($|[\s_-])/i;
const MIN_WORDS = 3, MAX_CHARS = 15000;

function skippable(e: Element): boolean {
  if (e.id === HOST_ID || SKIP.has(e.tagName.toUpperCase())) return true;
  if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true' || e.getAttribute('contenteditable') === 'true') return true;
  const role = e.getAttribute('role');
  if (role && ROLES.has(role)) return true;
  return AD.test(`${e.id} ${typeof e.className === 'string' ? e.className : ''}`);
}

// Nearest non-inline ancestor = the "paragraph" the text belongs to (cached per element).
const blockCache = new WeakMap<Element, Element>();
function blockOf(el: Element): Element {
  let b = blockCache.get(el);
  if (b) return b;
  let cur = el;
  while (cur.parentElement && cur !== document.body && /^(inline|contents)$/.test(getComputedStyle(cur).display)) cur = cur.parentElement;
  blockCache.set(el, cur);
  return cur;
}

let seq = 0;

function joinNodes(nodes: Text[]): string {
  let s = '';
  for (const n of nodes) {
    if (!n.data) continue;
    if (s && !/\s$/.test(s) && !/^\s/.test(n.data)) s += ' ';
    s += n.data;
  }
  return s.replace(/\s+/g, ' ').trim();
}

function pieces(text: string): string[] {
  if (!text) return [];
  if (text.length <= MAX_CHARS) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + MAX_CHARS, text.length);
    if (end < text.length) {
      const floor = i + Math.floor(MAX_CHARS * 0.5);
      const cut = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('? ', end), text.lastIndexOf('! ', end));
      if (cut >= floor) end = cut + 1;
    }
    const piece = text.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end <= i) break;
    i = end;
  }
  return out;
}

/** Collect visible text blocks under `root`, skipping hashes in `seen`. Keeps Text-node refs for highlighting. */
export function extract(root: Element, seen: Set<string>): ChunkRef[] {
  for (let a: Element | null = root; a; a = a.parentElement) if (skippable(a)) return [];
  const out: ChunkRef[] = [], local = new Set<string>();
  const visit = (scope: Node) => {
    const groups = new Map<Element, Text[]>();
    const shadows: ShadowRoot[] = [];
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType !== 1) return (n as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        const el = n as Element;
        if (skippable(el)) return NodeFilter.FILTER_REJECT;
        if (el.shadowRoot) shadows.push(el.shadowRoot);
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = (n as Text).parentElement;
      if (!p) continue;
      const b = blockOf(p);
      const list = groups.get(b);
      list ? list.push(n as Text) : groups.set(b, [n as Text]);
    }
    for (const [el, nodes] of groups) {
      if ((el as any).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: false }) === false) continue;
      for (const text of pieces(joinNodes(nodes))) {
        if (text.split(' ').length < MIN_WORDS) continue;
        const hash = hash32(text);
        if (seen.has(hash) || local.has(hash)) continue;
        local.add(hash);
        out.push({ id: `c${seq++}`, hash, el, nodes, text });
      }
    }
    for (const sr of shadows) visit(sr);
  };
  visit(root);
  return out;
}
