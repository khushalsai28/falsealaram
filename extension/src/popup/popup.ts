import { getSettings, saveSettings } from '../shared/settings';
import type { StatusResponse } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>('enabled');
const scanBtn = $<HTMLButtonElement>('scan');
const clearBtn = $<HTMLButtonElement>('clear');
const askBtn = $<HTMLButtonElement>('ask');
const query = $<HTMLTextAreaElement>('query');
const statusEl = $('status');

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

async function openAgent(tabId?: number): Promise<boolean> {
  try {
    const sidePanel = (chrome as unknown as {
      sidePanel?: { open(details: { tabId?: number }): Promise<void> };
    }).sidePanel;
    if (!sidePanel) throw new Error('The Side Panel API is unavailable in this version of Chrome.');
    await sidePanel.open(tabId == null ? {} : { tabId });
    return true;
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : 'Could not open the research agent.';
    return false;
  }
}

async function refresh() {
  const tab = await activeTab();
  if (tab?.id == null) {
    statusEl.textContent = 'No active tab is available.';
    scanBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }
  try {
    const r = (await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' })) as StatusResponse;
    statusEl.textContent = r.blocked ?? `${r.status} · ${r.claims} claims checked`;
    scanBtn.disabled = !r.enabled || !!r.blocked;
    clearBtn.disabled = !r.enabled;
  } catch {
    statusEl.textContent = 'Not available on this page (reload the tab if you just installed FalseAlarm).';
    scanBtn.disabled = true;
    clearBtn.disabled = true;
  }
}

void getSettings().then((s) => (enabled.checked = s.enabled));
enabled.onchange = async () => { await saveSettings({ enabled: enabled.checked }); setTimeout(() => void refresh(), 200); };

scanBtn.onclick = async () => {
  statusEl.textContent = 'Starting…';
  const tab = await activeTab();
  if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_SCAN' }).catch(() => undefined);
};

clearBtn.onclick = async () => {
  const tab = await activeTab();
  if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR' }).catch(() => undefined);
  statusEl.textContent = 'Highlights cleared.';
};

askBtn.onclick = async () => {
  const text = query.value.trim();
  if (!text) { query.focus(); return; }
  const tab = await activeTab();
  statusEl.textContent = 'Opening the research agent…';
  if (!await openAgent(tab?.id)) return;
  try {
    await chrome.runtime.sendMessage({
      type: 'AGENT_ASK', query: text,
      ...(tab?.id != null ? { tabId: tab.id } : {}),
    });
    query.value = '';
    statusEl.textContent = 'Research started in the side panel.';
  } catch {
    statusEl.textContent = 'Could not start the agent. Reload the extension and try again.';
  }
};

$('settings').onclick = () => chrome.runtime.openOptionsPage();
void refresh();
setInterval(() => void refresh(), 1000);
