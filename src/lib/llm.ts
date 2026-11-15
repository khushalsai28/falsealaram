import type { Claim, FactCheckResult, Source, Verdict } from "../types";
import {
  COMPARISON_SCHEMA,
  COMPARISON_SYSTEM_PROMPT,
  DETECTION_SCHEMA,
  DETECTION_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from "./prompts";
import { parseStrictJson } from "./json";
import { searchSources } from "./providers";

const verdicts: Verdict[] = [
  "supported",
  "contradicted",
  "partially-supported",
  "insufficient-evidence",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDetection(value: unknown): value is { claims: Claim[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.claims) &&
    value.claims.every(
      (claim) =>
        isRecord(claim) &&
        typeof claim.chunkId === "string" &&
        typeof claim.text === "string" &&
        claim.text.trim().length > 0 &&
        typeof claim.reason === "string" &&
        typeof claim.confidence === "number" &&
        Array.isArray(claim.keywords) &&
        claim.keywords.length >= 2 &&
        claim.keywords.length <= 4 &&
        claim.keywords.every((keyword) => typeof keyword === "string"),
    )
  );
}

function isSummary(value: unknown): value is { summary: string } {
  return isRecord(value) && typeof value.summary === "string";
}

function isSource(value: unknown): value is Source {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.authors === "string" &&
    (typeof value.year === "number" || value.year === null) &&
    typeof value.url === "string" &&
    typeof value.snippet === "string" &&
    ["google-scholar", "semantic-scholar", "openalex", "none"].includes(String(value.provider)) &&
    (value.summary === undefined || typeof value.summary === "string")
  );
}

function isComparison(
  value: unknown,
): value is { verdict: Verdict; explanation: string; correctedInfo: string; supportingSourceIndexes: number[] } {
  return (
    isRecord(value) &&
    typeof value.verdict === "string" &&
    verdicts.includes(value.verdict as Verdict) &&
    typeof value.explanation === "string" &&
    typeof value.correctedInfo === "string" &&
    Array.isArray(value.supportingSourceIndexes) &&
    value.supportingSourceIndexes.every((index) => Number.isInteger(index))
  );
}

async function requestWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`AI provider request failed (${response.status}).`);
      }
      lastError = new Error(
        response.status === 429
          ? "AI provider rate limited the request. Please try again."
          : `AI provider is temporarily unavailable (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error && !/temporarily unavailable|rate limited/.test(error.message)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error("AI provider request failed.");
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw lastError ?? new Error("AI provider request failed.");
}

async function geminiJson<T>(
  apiKey: string,
  system: string,
  user: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await requestWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema:
            system === DETECTION_SYSTEM_PROMPT
              ? {
                  type: "OBJECT",
                  properties: {
                    claims: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          chunkId: { type: "STRING" },
                          text: { type: "STRING" },
                          reason: { type: "STRING" },
                          confidence: { type: "NUMBER" },
                          keywords: { type: "ARRAY", items: { type: "STRING" } },
                        },
                        required: ["chunkId", "text", "reason", "confidence", "keywords"],
                      },
                    },
                  },
                  required: ["claims"],
                }
              : { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] },
        },
      }),
    });
    const data: unknown = await response.json();
    try {
      if (!isRecord(data) || !Array.isArray(data.candidates)) throw new Error("Gemini returned no response.");
      const candidate = data.candidates[0];
      if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
        throw new Error("Gemini returned an invalid response.");
      }
      const text = candidate.content.parts
        .filter((part): part is Record<string, unknown> => isRecord(part) && typeof part.text === "string")
        .map((part) => String(part.text))
        .join("");
      return parseStrictJson(text, validate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Gemini returned malformed JSON.");
    }
  }
  throw lastError ?? new Error("Gemini returned malformed JSON.");
}

async function grokJson<T>(
  apiKey: string,
  system: string,
  user: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const url = "https://api.x.ai/v1/chat/completions";
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await requestWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-2-latest",
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `${user}\n\nRequired response shape: ${COMPARISON_SCHEMA}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const data: unknown = await response.json();
    try {
      if (!isRecord(data) || !Array.isArray(data.choices)) throw new Error("Grok returned no response.");
      const choice = data.choices[0];
      if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") {
        throw new Error("Grok returned an invalid response.");
      }
      return parseStrictJson(choice.message.content, validate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Grok returned malformed JSON.");
    }
  }
  throw lastError ?? new Error("Grok returned malformed JSON.");
}

export async function detectClaims(
  chunks: { id: string; text: string }[],
  settings: { mode: "direct" | "proxy"; geminiApiKey: string; proxyUrl: string },
): Promise<Claim[]> {
  if (settings.mode === "proxy") {
    if (!settings.proxyUrl) throw new Error("Set a proxy URL in Options before using proxy mode.");
    const response = await fetch(`${settings.proxyUrl.replace(/\/+$/, "")}/api/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: chunks.slice(0, 100) }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error("Rate limited. Please try again in a minute.");
      throw new Error(`FactLens proxy request failed (${response.status}).`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || !isDetection(data)) throw new Error("Proxy returned invalid claim data.");
    const allowedChunks = new Map(chunks.map((chunk) => [chunk.id, chunk.text]));
    return data.claims
      .filter(
        (claim) =>
          claim.text.trim().length > 0 &&
          allowedChunks.get(claim.chunkId)?.includes(claim.text) &&
          claim.confidence >= 0 &&
          claim.confidence <= 1,
      )
      .sort((a, b) => b.confidence - a.confidence);
  }
  if (!settings.geminiApiKey) return detectDemoClaims(chunks);
  const deduplicated = new Map<string, { id: string; text: string }>();
  for (const chunk of chunks) {
    const normalized = chunk.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized && !deduplicated.has(normalized)) deduplicated.set(normalized, chunk);
  }
  const batches = Array.from(deduplicated.values()).reduce<{ id: string; text: string }[][]>(
    (result, chunk, index) => {
      const batchIndex = Math.floor(index / 20);
      result[batchIndex] ??= [];
      result[batchIndex].push(chunk);
      return result;
    },
    [],
  );
  const claims: Claim[] = [];
  for (const batch of batches) {
    const formatted = batch.map((chunk) => `[${chunk.id}] ${chunk.text}`).join("\n");
    const result = await geminiJson(settings.geminiApiKey, DETECTION_SYSTEM_PROMPT, formatted, isDetection);
    for (const claim of result.claims) {
      const sourceChunk = batch.find((chunk) => chunk.id === claim.chunkId);
      if (
        claim.text.trim().length > 0 &&
        sourceChunk &&
        sourceChunk.text.includes(claim.text) &&
        claim.confidence >= 0 &&
        claim.confidence <= 1
      ) {
        claims.push({ ...claim, keywords: claim.keywords.slice(0, 4) });
      }
    }
  }
  return claims.sort((a, b) => b.confidence - a.confidence);
}

function detectDemoClaims(chunks: { id: string; text: string }[]): Claim[] {
  const examples = [
    { match: /humans only use 10% of their brain/i, reason: "A widely repeated biological claim.", keywords: ["brain", "brain function"] },
    { match: /great wall of china is visible from space/i, reason: "A common claim about visibility from orbit.", keywords: ["Great Wall of China", "visibility from space"] },
    { match: /drinking coffee causes cancer/i, reason: "A health claim that needs careful context.", keywords: ["coffee", "cancer risk"] },
  ];
  return chunks.flatMap((chunk) =>
    examples.flatMap((example) => {
      const match = chunk.text.match(example.match);
      return match
        ? [
            {
              chunkId: chunk.id,
              text: match[0],
              reason: example.reason,
              confidence: 0.95,
              keywords: example.keywords,
            },
          ]
        : [];
    }),
  );
}

const DEMO_RESULTS: Array<{ match: RegExp; verdict: Verdict; explanation: string; correctedInfo: string }> = [
  {
    match: /10% of their brain/i,
    verdict: "contradicted",
    explanation: "Demo-mode assessment: brain imaging and neuroscience research show that people use far more than 10% of their brains over time.",
    correctedInfo: "There is no unused 90% reserve; different brain regions are active for different tasks.",
  },
  {
    match: /great wall of china/i,
    verdict: "contradicted",
    explanation: "Demo-mode assessment: the Great Wall is generally not visible to the unaided eye from low Earth orbit.",
    correctedInfo: "Visibility depends on viewing conditions and equipment; the unaided-eye claim is not supported.",
  },
  {
    match: /coffee.*cancer|cancer.*coffee/i,
    verdict: "partially-supported",
    explanation: "Demo-mode assessment: evidence does not support the blanket statement that drinking coffee causes cancer; risks depend on the exposure and evidence considered.",
    correctedInfo: "The relationship is not a simple cause-and-effect claim. Consult current health guidance and the linked studies.",
  },
];

export async function factCheckClaim(
  claim: Claim,
  settings: { mode: "direct" | "proxy"; geminiApiKey: string; grokApiKey: string; proxyUrl: string },
): Promise<FactCheckResult> {
  const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(claim.text)}`;
  if (settings.mode === "proxy") {
    if (!settings.proxyUrl) throw new Error("Set a proxy URL in Options before using proxy mode.");
    const response = await fetch(`${settings.proxyUrl.replace(/\/+$/, "")}/api/factcheck`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim, keywords: claim.keywords }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error("Rate limited. Please try again in a minute.");
      throw new Error(`FactLens proxy request failed (${response.status}).`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || !isRecord(data.result) || !isComparison(data.result)) {
      throw new Error("Proxy returned an invalid fact-check response.");
    }
    if (!Array.isArray(data.sources) || !data.sources.every(isSource)) {
      throw new Error("Proxy returned invalid scholarly sources.");
    }
    const result = data.result;
    return {
      claim: claim.text,
      verdict: result.verdict,
      explanation: result.explanation,
      correctedInfo: result.correctedInfo,
      sources: data.sources.slice(0, 3),
      scholarUrl,
    };
  }

  const demo = !settings.geminiApiKey || !settings.grokApiKey;
  let sources: Source[] = [];
  let sourceWarning = "";
  try {
    sources = await searchSources(claim.keywords, claim.text, false, "");
  } catch (error) {
    if (!demo) throw error;
    sourceWarning = error instanceof Error ? error.message : "Scholarly source search failed.";
  }
  if (demo) {
    const example = DEMO_RESULTS.find((item) => item.match.test(claim.text));
    if (!example) {
      return {
        claim: claim.text,
        verdict: "insufficient-evidence",
        explanation: `Demo mode only recognizes the built-in examples. Add Gemini and Grok keys in Options to check other claims.${sourceWarning ? ` ${sourceWarning}` : ""}`,
        correctedInfo: "",
        sources,
        scholarUrl,
        demoMode: true,
      };
    }
    return {
      claim: claim.text,
      ...example,
      explanation: sourceWarning ? `${example.explanation} ${sourceWarning}` : example.explanation,
      sources,
      scholarUrl,
      demoMode: true,
    };
  }

  const summarizedSources: Source[] = [];
  for (const source of sources) {
    const summary = await geminiJson(
      settings.geminiApiKey,
      SUMMARY_SYSTEM_PROMPT,
      JSON.stringify({ claim: claim.text, source }),
      isSummary,
    );
    summarizedSources.push({ ...source, summary: summary.summary });
  }
  const comparison = await grokJson(
    settings.grokApiKey,
    COMPARISON_SYSTEM_PROMPT,
    JSON.stringify({
      claim: claim.text,
      sources: summarizedSources.map((source, index) => ({
        index,
        title: source.title,
        summary: source.summary,
      })),
    }),
    isComparison,
  );
  return {
    claim: claim.text,
    verdict: comparison.verdict,
    explanation: comparison.explanation,
    correctedInfo: comparison.correctedInfo,
    sources: summarizedSources,
    scholarUrl,
  };
}
