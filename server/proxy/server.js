import "dotenv/config";
import express from "express";
import { rateLimit } from "express-rate-limit";

const app = express();
const port = Number(process.env.PORT || 8787);
const MAX_BODY_BYTES = "256kb";
const VERDICTS = new Set(["supported", "contradicted", "partially-supported", "insufficient-evidence"]);

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});
app.use(express.json({ limit: MAX_BODY_BYTES }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Rate limited. Please try again in a minute." },
  }),
);
app.use((error, request, response, next) => {
  if (error?.type === "entity.parse.failed") {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }
  if (error?.type === "entity.too.large") {
    return response.status(413).json({ error: "Request body is too large." });
  }
  return next(error);
});

const DETECTION_SYSTEM =
  "You are a fact-checking assistant. Return ONLY valid JSON, no prose, no code fences. From the text chunks, list ONLY factual assertions that could be false or misleading. Ignore opinions, jokes, questions, and subjective statements. Each claim must be an exact verbatim substring of the supplied text.";
const SUMMARY_SYSTEM =
  "Summarize ONLY what this source says that is relevant to the claim. 1-2 sentences. Do not speculate. If it does not address the claim, say so.";
const COMPARISON_SYSTEM =
  'You are a fact-checking judge. Return ONLY valid JSON, no prose, no code fences. Compare the claim ONLY against the supplied sources. Never invent citations. If the sources do not address the claim, verdict is "insufficient-evidence".';
const VERDICT_SCHEMA =
  '{"verdict": "supported|contradicted|partially-supported|insufficient-evidence", "explanation": "...", "correctedInfo": "...", "supportingSourceIndexes": [0]}';
const DETECTION_RESPONSE_SCHEMA = {
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
};
const SUMMARY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: { summary: { type: "STRING" } },
  required: ["summary"],
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

async function fetchWithRetry(url, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, init);
    if (response.ok) return response;
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Upstream request failed (${response.status}).`);
    }
    lastError = new Error(
      response.status === 429
        ? "Upstream provider rate limited the request."
        : `Upstream provider temporarily unavailable (${response.status}).`,
    );
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw lastError || new Error("Upstream request failed.");
}

async function askGemini(system, user, responseSchema) {
  if (!process.env.GEMINI_API_KEY) throw new Error("Proxy is missing GEMINI_API_KEY.");
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent");
  url.searchParams.set("key", process.env.GEMINI_API_KEY);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema },
      }),
    });
    const data = await response.json();
    try {
      const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
      if (!text) throw new Error("Gemini returned no response.");
      return parseJson(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Gemini returned malformed JSON.");
}

async function askGrok(system, user) {
  if (!process.env.GROK_API_KEY) throw new Error("Proxy is missing GROK_API_KEY.");
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithRetry("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-2-latest",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const data = await response.json();
    try {
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("Grok returned no response.");
      return parseJson(text);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Grok returned malformed JSON.");
}

function validClaim(claim) {
  return (
    isRecord(claim) &&
    typeof claim.chunkId === "string" &&
    typeof claim.text === "string" &&
    claim.text.trim().length > 0 &&
    typeof claim.reason === "string" &&
    typeof claim.confidence === "number" &&
    claim.confidence >= 0 &&
    claim.confidence <= 1 &&
    Array.isArray(claim.keywords) &&
    claim.keywords.length >= 2 &&
    claim.keywords.length <= 4 &&
    claim.keywords.every((item) => typeof item === "string")
  );
}

async function detect(chunks) {
  const unique = new Map();
  for (const chunk of chunks) {
    const key = chunk.text.trim().toLowerCase().replace(/\s+/g, " ");
    if (key && !unique.has(key)) unique.set(key, chunk);
  }
  const values = [...unique.values()];
  const found = [];
  for (let offset = 0; offset < values.length; offset += 20) {
    const batch = values.slice(offset, offset + 20);
    const data = await askGemini(
      DETECTION_SYSTEM,
      batch.map((chunk) => `[${chunk.id}] ${chunk.text}`).join("\n"),
      DETECTION_RESPONSE_SCHEMA,
    );
    if (!isRecord(data) || !Array.isArray(data.claims)) throw new Error("Gemini returned an invalid claims response.");
    for (const claim of data.claims) {
      const source = batch.find((chunk) => chunk.id === claim?.chunkId);
      if (validClaim(claim) && source?.text.includes(claim.text)) found.push(claim);
    }
  }
  return found.sort((a, b) => b.confidence - a.confidence);
}

async function searchGoogleScholar(query) {
  const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0 FactLens/2.0 (scholarly source lookup)" },
  });
  const html = await response.text();
  const results = [...html.matchAll(/<div class="gs_r[^"]*"[\s\S]*?<\/div>\s*<\/div>/g)].slice(0, 3);
  const sources = [];
  for (const [index, result] of results.entries()) {
    const titleMatch = result[0].match(/<h3 class="gs_rt">[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const clean = (value) => value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
    sources.push({
      title: clean(titleMatch[2]),
      authors: "",
      year: null,
      url: titleMatch[1],
      snippet: clean(result[0].match(/<div class="gs_rs">([\s\S]*?)<\/div>/)?.[1] || ""),
      provider: "google-scholar",
    });
  }
  return sources.slice(0, 3);
}

async function searchSemanticScholar(query) {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("fields", "title,abstract,year,authors,externalIds,url");
  url.searchParams.set("limit", "3");
  const response = await fetchWithRetry(url);
  const data = await response.json();
  if (!Array.isArray(data?.data)) throw new Error("Semantic Scholar returned an invalid response.");
  return data.data.flatMap((paper) => {
    const paperUrl = paper.url || (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : "");
    if (!paper.title || !paperUrl) return [];
    return [{
      title: paper.title,
      authors: (paper.authors || []).map((author) => author.name).filter(Boolean).join(", "),
      year: typeof paper.year === "number" ? paper.year : null,
      url: paperUrl,
      snippet: paper.abstract || "",
      provider: "semantic-scholar",
    }];
  });
}

async function searchOpenAlex(query) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", "3");
  const response = await fetchWithRetry(url);
  const data = await response.json();
  if (!Array.isArray(data?.results)) throw new Error("OpenAlex returned an invalid response.");
  return data.results.flatMap((work) => {
    const urlValue = work.doi || work.id;
    if (!work.title || !urlValue) return [];
    return [{
      title: work.title,
      authors: (work.authorships || []).map((authorship) => authorship.author?.display_name).filter(Boolean).join(", "),
      year: typeof work.publication_year === "number" ? work.publication_year : null,
      url: urlValue,
      snippet: "",
      provider: "openalex",
    }];
  });
}

async function searchSources(query, keywords = []) {
  const searchQuery = [query, ...keywords].filter(Boolean).join(" ");
  try {
    const scholarSources = await searchGoogleScholar(searchQuery);
    if (scholarSources.length) return scholarSources;
  } catch {
    // Scholar often blocks automated requests; continue to the public APIs.
  }
  const failures = [];
  try {
    const sources = await searchSemanticScholar(searchQuery);
    if (sources.length) return sources.slice(0, 3);
  } catch (error) {
    failures.push(error.message);
  }
  try {
    const sources = await searchOpenAlex(searchQuery);
    if (sources.length) return sources.slice(0, 3);
  } catch (error) {
    failures.push(error.message);
  }
  if (failures.length) throw new Error(`No scholarly sources could be retrieved. ${failures.join(" ")}`);
  return [];
}

async function factCheck(claim, keywords) {
  const sources = await searchSources(claim.text, keywords);
  const summarized = [];
  for (const source of sources) {
    const summary = await askGemini(
      SUMMARY_SYSTEM,
      JSON.stringify({ claim: claim.text, source }),
      SUMMARY_RESPONSE_SCHEMA,
    );
    if (typeof summary?.summary !== "string") throw new Error("Gemini returned an invalid summary.");
    summarized.push({ ...source, summary: summary.summary });
  }
  const comparison = await askGrok(
    COMPARISON_SYSTEM,
    `${JSON.stringify({
      claim: claim.text,
      sources: summarized.map((source, index) => ({ index, title: source.title, summary: source.summary })),
    })}\n\nRequired response shape: ${VERDICT_SCHEMA}`,
  );
  if (
    !isRecord(comparison) ||
    !VERDICTS.has(comparison.verdict) ||
    typeof comparison.explanation !== "string" ||
    typeof comparison.correctedInfo !== "string" ||
    !Array.isArray(comparison.supportingSourceIndexes) ||
    !comparison.supportingSourceIndexes.every(Number.isInteger)
  ) {
    throw new Error("Grok returned an invalid fact-check response.");
  }
  return { result: comparison, sources: summarized };
}

app.post("/api/detect", async (request, response) => {
  try {
    const chunks = request.body?.chunks;
    if (!Array.isArray(chunks) || chunks.length > 100 || !chunks.every((chunk) => isRecord(chunk) && typeof chunk.id === "string" && typeof chunk.text === "string")) {
      return response.status(400).json({ error: "Expected up to 100 text chunks." });
    }
    response.json({ claims: await detect(chunks) });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Claim detection failed." });
  }
});

app.post("/api/sources", async (request, response) => {
  try {
    const query = request.body?.query;
    const keywords = request.body?.keywords;
    if (typeof query !== "string" || query.length > 2000 || !Array.isArray(keywords)) {
      return response.status(400).json({ error: "Expected a query and keyword list." });
    }
    response.json({ sources: await searchSources(query, keywords.filter((item) => typeof item === "string").slice(0, 4)) });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Source search failed." });
  }
});

app.post("/api/factcheck", async (request, response) => {
  try {
    const { claim, keywords } = request.body || {};
    if (!validClaim(claim) || !Array.isArray(keywords) || !keywords.every((item) => typeof item === "string")) {
      return response.status(400).json({ error: "Expected a valid claim and keyword list." });
    }
    response.json(await factCheck(claim, keywords.slice(0, 4)));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Fact-check failed." });
  }
});

app.listen(port, () => {
  console.log(`FactLens proxy listening on port ${port}`);
});
