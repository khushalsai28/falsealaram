import type { Settings } from './types';
import { DEFAULT_BLOCKLIST } from './blocklist';

// NOTE: no secrets here - this file is bundled into the content script.
export const DEFAULTS: Settings = {
  enabled: true, autoScan: false, mode: 'direct',
  proxyUrl: 'http://localhost:8787', proxyToken: '',
  geminiKey: '', grokKey: '', openAlexKey: '',
  geminiModel: 'gemini-3.5-flash-lite', grokModel: 'grok-4.7',
  confidenceThreshold: 0.45, maxClaims: 5, scholarEnabled: true, blocklist: DEFAULT_BLOCKLIST,
};
export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULTS, ...(settings ?? {}) };
  return { ...merged, maxClaims: Math.max(1, Math.min(5, Number(merged.maxClaims) || 5)) };
}
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}
