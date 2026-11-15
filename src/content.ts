import type { Claim, FactCheckResult, Message, TextChunk } from "./types";
import { isBlockedUrl, isSensitiveElement } from "./lib/blocklist";

declare global {
  interface Window {
    __factLensContentLoaded?: boolean;
  }
}

if (!window.__factLensContentLoaded) {
  window.__factLensContentLoaded = true;
  initialize();
}

const DISCLAIMER = "AI-assisted results — verify with the sources before sharing.";
const blockTags = "p, li, blockquote, h1, h2, h3, h4, figcaption, dd";

function initialize(): void {
  if (chrome.extension.inIncognitoContext || isBlockedUrl(location.href)) return;
  let processedText = new WeakSet<Text>();
  const chunksById = new Map<string, Element>();
  const checkedClaims = new Set<string>();
  const highlights = new Map<string, HighlightRecord>();
  let chunkCounter = 0;
  let enabled = true;
  let hasScanned = false;
  let host: HTMLDivElement | undefined;
  let shadow: ShadowRoot | undefined;
  let observer: MutationObserver | undefined;
  let activePopup: HTMLElement | undefined;
  let mutationTimer: number | undefined;

  function getRoot(): ShadowRoot {
    if (shadow) return shadow;
    host = document.createElement("div");
    host.id = "factlens-shadow-host";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    shadow = host.attachShadow({ mode: "open" });
    observer?.disconnect();
    document.documentElement.append(host);
    observer?.observe(document.documentElement, { childList: true, subtree: true });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .toast { position:fixed; right:20px; top:20px; padding:11px 15px; border-radius:10px; background:#172033; color:#fff; font:500 13px/1.4 system-ui,sans-serif; box-shadow:0 6px 24px #0003; pointer-events:none; }
      .card { position:fixed; width:min(390px,calc(100vw - 32px)); max-height:min(560px,calc(100vh - 32px)); overflow:auto; box-sizing:border-box; padding:20px; border:1px solid #e3e7ef; border-radius:16px; background:#fff; color:#172033; box-shadow:0 16px 48px #10182838; font:14px/1.5 system-ui,sans-serif; pointer-events:auto; }
      .head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .claim { margin:0 0 12px; color:#44506a; font-style:italic; font-size:15px; }
      .close { border:0; background:#f1f3f8; border-radius:8px; width:30px; height:30px; cursor:pointer; color:#334155; font-size:19px; line-height:1; }
      .badge { display:inline-flex; margin:0 0 10px; padding:4px 9px; border-radius:999px; font-size:11px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; }
      .badge.contradicted { background:#fee4e2; color:#b42318; } .badge.supported { background:#dcfae6; color:#067647; }
      .badge.partially-supported { background:#fff0d6; color:#9a4f00; } .badge.insufficient-evidence,.badge.pending { background:#eef0f4; color:#475467; }
      .section { margin:10px 0; } .section strong { display:block; margin-bottom:3px; font-size:12px; color:#344054; }
      .section p { margin:0; white-space:pre-wrap; } .sources { display:grid; gap:9px; margin:10px 0; }
      .source { padding:10px; background:#f7f8fb; border-radius:10px; } .source a { color:#2457c5; text-decoration:none; font-weight:650; }
      .source a:hover { text-decoration:underline; } .meta { display:block; margin-top:3px; color:#667085; font-size:11px; }
      .footer { margin-top:14px; padding-top:11px; border-top:1px solid #eaecf0; color:#667085; font-size:11px; }
      .skeleton { height:11px; margin:10px 0; border-radius:7px; background:linear-gradient(90deg,#eef0f4,#f8f9fb,#eef0f4); background-size:200% 100%; animation:shine 1.4s infinite; }
      @keyframes shine { to { background-position:-200% 0; } }
    `;
    shadow.append(style);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", onDocumentClick, true);
    return shadow;
  }

  function showToast(text: string): void {
    const root = getRoot();
    root.querySelector(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = text;
    root.append(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  function closePopup(): void {
    activePopup?.remove();
    activePopup = undefined;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") closePopup();
  }

  function onDocumentClick(event: MouseEvent): void {
    const path = event.composedPath();
    if (activePopup && !path.includes(activePopup) && !path.includes(host!)) closePopup();
  }

  function openPopup(anchor: Element, claim: Claim, result?: FactCheckResult, error?: string): void {
    const root = getRoot();
    closePopup();
    const rect = anchor.getBoundingClientRect();
    const card = document.createElement("section");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "FactLens fact check");
    card.dataset.claimKey = `${claim.chunkId}:${claim.text}`;
    card.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 410))}px`;
    card.style.top = `${Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - 560))}px`;
    const header = document.createElement("div");
    header.className = "head";
    const claimText = document.createElement("p");
    claimText.className = "claim";
    claimText.textContent = `“${claim.text}”`;
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.setAttribute("aria-label", "Close fact check");
    close.textContent = "×";
    close.addEventListener("click", closePopup);
    header.append(claimText, close);
    card.append(header);

    if (!result && !error) {
      const badge = document.createElement("span");
      badge.className = "badge pending";
      badge.textContent = "Checking…";
      card.append(badge);
      for (let index = 0; index < 3; index += 1) {
        const skeleton = document.createElement("div");
        skeleton.className = "skeleton";
        card.append(skeleton);
      }
    } else if (error) {
      const message = document.createElement("p");
      message.textContent = error;
      card.append(message);
    } else if (result) {
      const badge = document.createElement("span");
      badge.className = `badge ${result.verdict}`;
      badge.textContent = result.demoMode ? `${result.verdict} · demo mode` : result.verdict;
      card.append(badge);
      if (result.demoMode) {
        const demo = document.createElement("p");
        demo.textContent = "Demo-mode assessment; add API keys in Options for model-based checks.";
        card.append(demo);
      }
      appendSection(card, "Assessment", result.explanation);
      if (result.correctedInfo) appendSection(card, "Context", result.correctedInfo);
      const sources = document.createElement("div");
      sources.className = "sources";
      for (const source of result.sources.slice(0, 3)) {
        const item = document.createElement("div");
        item.className = "source";
        const link = document.createElement("a");
        link.textContent = source.title;
        if (safeUrl(source.url)) {
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = [source.authors, source.year, source.provider].filter(Boolean).join(" · ");
        item.append(link, meta);
        if (source.summary || source.snippet) {
          const snippet = document.createElement("p");
          snippet.textContent = source.summary || source.snippet;
          item.append(snippet);
        }
        sources.append(item);
      }
      if (result.sources.length) {
        const label = document.createElement("strong");
        label.textContent = "Scholarly sources";
        card.append(label, sources);
      } else {
        appendSection(card, "Sources", "No scholarly sources were returned. Treat this as insufficient evidence.");
      }
      const scholar = document.createElement("a");
      scholar.textContent = "Search this claim on Google Scholar";
      scholar.href = result.scholarUrl;
      scholar.target = "_blank";
      scholar.rel = "noopener noreferrer";
      card.append(scholar);
    }

    const footer = document.createElement("div");
    footer.className = "footer";
    footer.textContent = DISCLAIMER;
    card.append(footer);
    root.append(card);
    activePopup = card;
  }

  function appendSection(parent: HTMLElement, title: string, value: string): void {
    const section = document.createElement("div");
    section.className = "section";
    const label = document.createElement("strong");
    label.textContent = title;
    const content = document.createElement("p");
    content.textContent = value;
    section.append(label, content);
    parent.append(section);
  }

  function safeUrl(value: string): boolean {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }

  function clearHighlights(): void {
    observer?.disconnect();
    for (const record of highlights.values()) {
      const span = record.span;
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    highlights.clear();
    chunksById.clear();
    processedText = new WeakSet<Text>();
    closePopup();
    observer?.observe(document.documentElement, { childList: true, subtree: true });
  }

  function collectChunks(): TextChunk[] {
    const chunks: TextChunk[] = [];
    const seen = new Set<string>();
    for (const element of document.querySelectorAll(blockTags)) {
      if (
        element.closest("#factlens-shadow-host") ||
        isSensitiveElement(element) ||
        element.closest("nav, footer, aside, script, style, noscript, iframe, [aria-hidden='true']") ||
        isAdvertisement(element) ||
        element.getAttribute("contenteditable") === "true"
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (
            !parent ||
            parent.closest("script, style, noscript, textarea, input, select, button, [aria-hidden='true']") ||
            parent.closest("#factlens-shadow-host, [data-factlens-claim]")
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const textNodes: Text[] = [];
      let hasNewText = false;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const textNode = node as Text;
        textNodes.push(textNode);
        if (!processedText.has(textNode)) hasNewText = true;
      }
      const text = textNodes.map((textNode) => textNode.data).join("").replace(/\s+/g, " ").trim();
      if (!hasNewText || text.length < 35 || text.length > 5000) continue;
      textNodes.forEach((textNode) => processedText.add(textNode));
      const normalized = text.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const id = `c${++chunkCounter}`;
      chunks.push({ id, text });
      chunksById.set(id, element);
    }
    return chunks;
  }

  function highlightClaim(claim: Claim): void {
    const element = chunksById.get(claim.chunkId);
    if (!element || highlights.has(`${claim.chunkId}:${claim.text}`)) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest("#factlens-shadow-host")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let node: Node | null;
    let fullText = "";
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      nodes.push(textNode);
      fullText += textNode.data;
    }
    const normalized = normalizeWithOffsets(fullText);
    const matchStart = normalized.text.indexOf(claim.text);
    if (matchStart < 0) return;
    const start = normalized.starts[matchStart];
    const end = normalized.ends[matchStart + claim.text.length - 1];
    let offset = 0;
    let startNode: Text | undefined;
    let endNode: Text | undefined;
    let startOffset = 0;
    let endOffset = 0;
    for (const textNode of nodes) {
      const next = offset + textNode.length;
      if (!startNode && start >= offset && start < next) {
        startNode = textNode;
        startOffset = start - offset;
      }
      if (end > offset && end <= next) {
        endNode = textNode;
        endOffset = end - offset;
        break;
      }
      offset = next;
    }
    if (!startNode || !endNode) return;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const span = document.createElement("span");
    span.dataset.factlensClaim = claim.chunkId;
    span.style.cssText = "background:#fff1b8;border-radius:2px;box-shadow:inset 0 -1px 0 #e7b733;cursor:pointer;";
    observer?.disconnect();
    try {
      span.append(range.extractContents());
      range.insertNode(span);
    } catch {
      return;
    } finally {
      observer?.observe(document.documentElement, { childList: true, subtree: true });
    }
    span.addEventListener("click", (event) => {
      event.stopPropagation();
      const record = highlights.get(`${claim.chunkId}:${claim.text}`);
      openPopup(span, claim, record?.result);
    });
    highlights.set(`${claim.chunkId}:${claim.text}`, { span, claim });
    const processedWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let processedNode: Node | null;
    while ((processedNode = processedWalker.nextNode())) {
      if (processedNode.nodeType === Node.TEXT_NODE) processedText.add(processedNode as Text);
    }
  }

  async function scanPage(isDynamic = false): Promise<void> {
    if (!enabled) return;
    if (isBlockedUrl(location.href)) {
      showToast("FactLens does not scan this page.");
      return;
    }
    hasScanned = true;
    const chunks = collectChunks();
    if (!chunks.length) {
      if (!isDynamic) showToast("No new page text to scan.");
      return;
    }
    showToast("Scanning…");
    let response: { claims?: Claim[]; error?: string };
    try {
      response = await chrome.runtime.sendMessage({ type: "DETECT_CHUNKS", chunks });
    } catch {
      showToast("Could not reach FactLens. Reload the page and try again.");
      return;
    }
    if (response.error) {
      showToast(response.error);
      return;
    }
    const seenClaims = new Set(checkedClaims);
    const claims = (response.claims ?? [])
      .filter((claim) => {
        const key = claim.text.trim().toLowerCase();
        if (!key || seenClaims.has(key)) return false;
        seenClaims.add(key);
        return true;
      })
      .slice(0, Math.min(5, 10 - checkedClaims.size));
    if (!claims.length) {
      showToast("No new claims to check.");
      return;
    }
    showToast(`Scanning… ${claims.length} claim${claims.length === 1 ? "" : "s"} found`);
    for (const claim of claims) {
      checkedClaims.add(claim.text.trim().toLowerCase());
      highlightClaim(claim);
      const key = `${claim.chunkId}:${claim.text}`;
      const anchor = highlights.get(key)?.span;
      try {
        const result = await chrome.runtime.sendMessage({ type: "FACTCHECK_CLAIM", claim });
        if (result.error) {
          if (activePopup?.dataset.claimKey === key && anchor) openPopup(anchor, claim, undefined, result.error);
          continue;
        }
        const record = highlights.get(key);
        if (record) {
          record.result = result.result as FactCheckResult;
          applyVerdict(record.span, record.result.verdict);
          if (activePopup?.dataset.claimKey === key && anchor) openPopup(anchor, claim, record.result);
        }
      } catch {
        if (activePopup?.dataset.claimKey === key && anchor) {
          openPopup(anchor, claim, undefined, "Could not reach FactLens. Try again.");
        }
      }
    }
    const contradicted = [...highlights.values()].filter((item) => item.result?.verdict === "contradicted").length;
    const contextual = [...highlights.values()].filter((item) => item.result?.verdict === "partially-supported").length;
    showToast(`Done: ${contradicted} contradicted, ${contextual} needs context`);
  }

  function applyVerdict(span: HTMLSpanElement, verdict: FactCheckResult["verdict"]): void {
    const colors: Record<FactCheckResult["verdict"], string> = {
      supported: "#d8f3df",
      contradicted: "#ffd9d6",
      "partially-supported": "#ffe5bf",
      "insufficient-evidence": "#e9ebef",
    };
    span.style.backgroundColor = colors[verdict];
    span.style.boxShadow = "none";
  }

  function isAdvertisement(element: Element): boolean {
    const adMarker = /(^|[-_\s])(ad|ads|advert|advertisement)([-_\s]|$)/i;
    return (
      adMarker.test(element.id) ||
      adMarker.test(element.getAttribute("class") ?? "") ||
      element.getAttribute("data-ad") !== null ||
      /advertisement/i.test(element.getAttribute("aria-label") ?? "")
    );
  }

  function normalizeWithOffsets(value: string): { text: string; starts: number[]; ends: number[] } {
    let text = "";
    const starts: number[] = [];
    const ends: number[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (/\s/.test(value[index])) {
        if (!text || text.endsWith(" ")) continue;
        text += " ";
        starts.push(index);
        ends.push(index + 1);
      } else {
        text += value[index];
        starts.push(index);
        ends.push(index + 1);
      }
    }
    if (text.endsWith(" ")) {
      text = text.slice(0, -1);
      starts.pop();
      ends.pop();
    }
    return { text, starts, ends };
  }

  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message.type === "FACTLENS_SCAN") {
      void scanPage();
      sendResponse({ ok: true });
    } else if (message.type === "FACTLENS_CLEAR") {
      clearHighlights();
      sendResponse({ ok: true });
    } else if (message.type === "FACTLENS_TOGGLE") {
      enabled = message.enabled;
      if (!enabled) {
        clearHighlights();
        host?.remove();
        host = undefined;
        shadow = undefined;
      }
      sendResponse({ ok: true });
    } else if (message.type === "FACTLENS_RESULT") {
      const key = `${message.claim.chunkId}:${message.claim.text}`;
      const record = highlights.get(key);
      if (record) {
        record.result = message.result;
        applyVerdict(record.span, message.result.verdict);
        if (activePopup?.dataset.claimKey === key) openPopup(record.span, record.claim, record.result);
      }
      sendResponse({ ok: true });
    } else if (message.type === "FACTLENS_ERROR") {
      showToast(message.message);
      sendResponse({ ok: true });
    }
    return true;
  });

  function onMutations(): void {
    if (!enabled || !hasScanned) return;
    if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => void scanPage(true), 1500);
  }

  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

interface HighlightRecord {
  span: HTMLSpanElement;
  claim: Claim;
  result?: FactCheckResult;
}
