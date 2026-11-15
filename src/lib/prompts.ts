export const DETECTION_SYSTEM_PROMPT =
  "You are a fact-checking assistant. Return ONLY valid JSON, no prose, no code fences. From the text chunks, list ONLY factual assertions that could be false or misleading. Ignore opinions, jokes, questions, and subjective statements. Each claim must be an exact verbatim substring of the supplied text.";

export const DETECTION_SCHEMA =
  '{"claims": [{"chunkId": "c1", "text": "...", "reason": "...", "confidence": 0.8, "keywords": ["...", "..."]}]}';

export const SUMMARY_SYSTEM_PROMPT =
  "Summarize ONLY what this source says that is relevant to the claim. 1-2 sentences. Do not speculate. If it does not address the claim, say so.";

export const COMPARISON_SYSTEM_PROMPT =
  'You are a fact-checking judge. Return ONLY valid JSON, no prose, no code fences. Compare the claim ONLY against the supplied sources. Never invent citations. If the sources do not address the claim, verdict is "insufficient-evidence".';

export const COMPARISON_SCHEMA =
  '{"verdict": "supported|contradicted|partially-supported|insufficient-evidence", "explanation": "...", "correctedInfo": "...", "supportingSourceIndexes": [0]}';
