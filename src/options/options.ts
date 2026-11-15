import { getSettings, saveSettings } from '../shared/settings';
import type { Settings } from '../shared/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TEXT = ['mode', 'proxyUrl', 'proxyToken', 'geminiKey', 'grokKey', 'openAlexKey', 'geminiModel', 'grokModel'] as const;
const NUM = ['confidenceThreshold', 'maxClaims'] as const;
const BOOL = ['autoScan', 'scholarEnabled'] as const;
const msg = (t: string) => { $('msg').textContent = t; setTimeout(() => ($('msg').textContent = ''), 2500); };

getSettings().then((s) => {
  for (const k of TEXT) $<HTMLInputElement>(k).value = s[k];
  for (const k of NUM) $<HTMLInputElement>(k).value = String(s[k]);
  for (const k of BOOL) $<HTMLInputElement>(k).checked = s[k];
  $<HTMLTextAreaElement>('blocklist').value = s.blocklist.join('\n');
});

$('save').onclick = async () => {
  const p: Record<string, unknown> = {};
  for (const k of TEXT) p[k] = $<HTMLInputElement>(k).value.trim();
  for (const k of NUM) p[k] = Number($<HTMLInputElement>(k).value);
  for (const k of BOOL) p[k] = $<HTMLInputElement>(k).checked;
  p.blocklist = $<HTMLTextAreaElement>('blocklist').value.split('\n').map((x) => x.trim().toLowerCase()).filter(Boolean);
  p.maxClaims = Math.max(1, Math.min(5, Number(p.maxClaims) || 5));
  await saveSettings(p as Partial<Settings>);
  msg('Saved ✔');
};
$('clear').onclick = async () => {
  const keys = Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('falsealaram:') || k.startsWith('fl:'));
  await chrome.storage.local.remove(keys);
  msg(`Cleared ${keys.length} cached results`);
};
