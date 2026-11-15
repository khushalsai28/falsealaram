import type { Settings } from './types';
import { DEFAULT_BLOCKLIST } from './blocklist';

// NOTE: no secrets here - this file is bundled into the content script.
export const DEFAULTS: Settings = {
  enabled: true, autoScan: false, mode: 'direct',
  proxyUrl: 'http://localhost:8787', proxyToken: '',
  geminiKey: '', grokKey: '', openAlexKey: '',
  // Keep these aligned with the documented proxy defaults. Users can still
  // select a newer model in Options when their account supports it.
  geminiModel: 'gemini-2.0-flash', grokModel: 'grok-4',
  confidenceThreshold: 0.45, maxClaims: 5, scholarEnabled: true, blocklist: DEFAULT_BLOCKLIST,
};

/**
 * Existing v2 installations persisted the prior demo model names.  They are
 * not valid defaults for the v3 agent, so migrate only those exact legacy
 * defaults while leaving an intentional custom model untouched.
 */
const LEGACY_MODELS: Record<string, string> = {
  'gemini-3.5-flash-lite': DEFAULTS.geminiModel,
  'grok-4.7': DEFAULTS.grokModel,
};

export function normalizeSettings(stored: Partial<Settings> | undefined | null): Settings {
  const merged = { ...DEFAULTS, ...(stored ?? {}) } as Settings;
  const geminiModel = LEGACY_MODELS[merged.geminiModel] ?? merged.geminiModel ?? DEFAULTS.geminiModel;
  const grokModel = LEGACY_MODELS[merged.grokModel] ?? merged.grokModel ?? DEFAULTS.grokModel;
  return {
    ...merged,
    geminiModel,
    grokModel,
    maxClaims: Math.max(1, Math.min(5, Number(merged.maxClaims) || 5)),
  };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings as Partial<Settings> | undefined);
}
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}
