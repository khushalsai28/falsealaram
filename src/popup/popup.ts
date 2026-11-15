import { getSettings, saveSettings } from '../shared/settings';
import type { StatusResponse } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>('enabled'), scanBtn = $<HTMLButtonElement>('scan'), statusEl = $('status');

const tabId = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

async function refresh() {
  const id = await tabId();
  try {
    const r = (await chrome.tabs.sendMessage(id!, { type: 'GET_STATUS' })) as StatusResponse;
    statusEl.textContent = r.blocked ?? `${r.status} · ${r.claims} claims checked`;
    scanBtn.disabled = !r.enabled || !!r.blocked;
  } catch {
    statusEl.textContent = 'Not available on this page (reload the tab if you just installed FalseAlarm).';
    scanBtn.disabled = true;
  }
}
getSettings().then((s) => (enabled.checked = s.enabled));
enabled.onchange = async () => { await saveSettings({ enabled: enabled.checked }); setTimeout(refresh, 200); };
scanBtn.onclick = async () => { statusEl.textContent = 'Starting…'; await chrome.tabs.sendMessage((await tabId())!, { type: 'POPUP_SCAN' }).catch(() => undefined); };
$('settings').onclick = () => chrome.runtime.openOptionsPage();
refresh();
setInterval(refresh, 1000);
