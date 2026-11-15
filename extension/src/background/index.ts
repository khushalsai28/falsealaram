import type { ScanSummary, ToBackground } from '../shared/types';
import { getAgentRun, saveAgentRun } from '../shared/agent-state';
import { publicHttpUrl } from '../lib/web';
import { runScan } from './pipeline';
import { askAgent } from './agent-runner';

const safeHttpUrl = (raw: string): string | null => {
  try { return publicHttpUrl(raw).href; } catch { return null; }
};

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

// All network I/O happens here. Returning true keeps the channel open for the async response.
chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
  if (msg?.type === 'SCAN_REQUEST' && sender.tab?.id != null) {
    runScan(sender.tab.id, msg.payload).then(sendResponse, (e): void =>
      sendResponse({ ok: false, claimsFound: 0, flagged: 0, error: String(e?.message ?? e) } satisfies ScanSummary));
    return true;
  }
  if (msg?.type === 'AGENT_ASK') {
    void (async () => {
      const tabId = sender.tab?.id ?? msg.tabId ?? await activeTabId();
      try {
        if (tabId != null) {
          await saveAgentRun(tabId, { status: 'running', query: msg.query, updatedAt: Date.now() });
        }
        const result = await askAgent(msg.query, msg.pageContext);
        // Save before broadcasting: a newly opened panel may not yet have a
        // runtime listener when a fast configuration error is returned.
        if (tabId != null) {
          await saveAgentRun(tabId, { status: 'complete', query: result.query, result, updatedAt: Date.now() });
        }
        void chrome.runtime.sendMessage({ type: 'AGENT_RESULT', result }).catch(() => undefined);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: String(error instanceof Error ? error.message : error) });
      }
    })();
    return true;
  }
  if (msg?.type === 'AGENT_GET_RUN') {
    void (async () => {
      try {
        const tabId = sender.tab?.id ?? msg.tabId ?? await activeTabId();
        const state = tabId == null ? undefined : await getAgentRun(tabId);
        sendResponse({ ok: true, state });
      } catch (error) {
        sendResponse({ ok: false, error: String(error instanceof Error ? error.message : error) });
      }
    })();
    return true;
  }
  if (msg?.type === 'AGENT_OPEN' || msg?.type === 'AGENT_GOTO') {
    const url = safeHttpUrl(msg.url);
    if (!url) { sendResponse({ ok: false, error: 'Only public http(s) source URLs can be opened.' }); return false; }
    (async () => {
      if (msg.type === 'AGENT_OPEN') await chrome.tabs.create({ url, active: false });
      else {
        const tabId = sender.tab?.id ?? await activeTabId();
        if (tabId == null) throw new Error('No active tab is available.');
        await chrome.tabs.update(tabId, { url });
      }
      sendResponse({ ok: true });
    })().catch((error): void => sendResponse({ ok: false, error: String(error?.message ?? error) }));
    return true;
  }
  return false;
});
