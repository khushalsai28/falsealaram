import type { Settings } from './types';
import { DEFAULT_BLOCKLIST } from './blocklist';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROK_MODEL, normalizeGeminiModel, normalizeGrokModel } from './models';

// NOTE: no secrets here - this file is bundled into the content script.
export const DEFAULTS: Settings = {
  enabled: true, autoScan: false, mode: 'direct',
  proxyUrl: 'http://localhost:8787', proxyToken: '',
  geminiKey: '', grokKey: '', openAlexKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL, grokModel: DEFAULT_GROK_MODEL,
  confidenceThreshold: 0.5, maxClaims: 12, scholarEnabled: true, blocklist: DEFAULT_BLOCKLIST,
};

export function normalizeSettings(stored: Partial<Settings> | undefined | null): Settings {
  const merged = { ...DEFAULTS, ...(stored ?? {}) } as Settings;
  return {
    ...merged,
    geminiModel: normalizeGeminiModel(merged.geminiModel),
    grokModel: normalizeGrokModel(merged.grokModel),
  };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings as Partial<Settings> | undefined);
}
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set({ settings: normalizeSettings({ ...(await getSettings()), ...patch }) });
}
