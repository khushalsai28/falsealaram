import type { Settings } from '../shared/types';
export const resolveKeys = (s: Settings) => ({
  gemini: s.geminiKey,
  grok: s.grokKey,
  openAlex: s.openAlexKey,
});
