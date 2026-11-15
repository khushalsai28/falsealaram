/**
 * Keep the extension and proxy on the same known-good model defaults. This
 * module intentionally has no Chrome API dependency so it can be shared.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_GROK_MODEL = 'grok-4';

// Exact model IDs previously shipped by FalseAlarm. These are migrations for
// product defaults, not a blanket rewrite of someone’s custom selection.
const LEGACY_GEMINI_MODELS: Readonly<Record<string, string>> = {
  'gemini-2.0-flash': DEFAULT_GEMINI_MODEL,
  'gemini-3.6-flash': DEFAULT_GEMINI_MODEL,
};

const LEGACY_GROK_MODELS: Readonly<Record<string, string>> = {
  'grok-4.7': DEFAULT_GROK_MODEL,
};

function modelValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeGeminiModel(value: unknown): string {
  const model = modelValue(value);
  return LEGACY_GEMINI_MODELS[model] ?? (model || DEFAULT_GEMINI_MODEL);
}

export function normalizeGrokModel(value: unknown): string {
  const model = modelValue(value);
  return LEGACY_GROK_MODELS[model] ?? (model || DEFAULT_GROK_MODEL);
}
