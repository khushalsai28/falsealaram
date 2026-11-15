/**
 * Current, text-capable defaults for this extension. Keep this module free of
 * Chrome APIs so both the browser extension and the local proxy share exactly
 * the same migration behavior.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
export const DEFAULT_GROK_MODEL = 'grok-4';

const LEGACY_GEMINI_MODELS: Readonly<Record<string, string>> = {
  // These were shipped FalseAlarm defaults, not user-selected custom models.
  // Gemini 2.0 Flash was shut down on June 1, 2026.
  'gemini-2.0-flash': DEFAULT_GEMINI_MODEL,
  'gemini-3.5-flash-lite': DEFAULT_GEMINI_MODEL,
};

const LEGACY_GROK_MODELS: Readonly<Record<string, string>> = {
  // This was the v2 FalseAlarm default. The current documented xAI alias is
  // `grok-4`; preserve every other user-provided model name unchanged.
  'grok-4.7': DEFAULT_GROK_MODEL,
};

function modelValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Preserve custom values, while safely replacing only known legacy defaults. */
export function normalizeGeminiModel(value: unknown): string {
  const model = modelValue(value);
  return LEGACY_GEMINI_MODELS[model] ?? (model || DEFAULT_GEMINI_MODEL);
}

/** An empty Grok model means use the documented extension default. */
export function normalizeGrokModel(value: unknown): string {
  const model = modelValue(value);
  return LEGACY_GROK_MODELS[model] ?? (model || DEFAULT_GROK_MODEL);
}
