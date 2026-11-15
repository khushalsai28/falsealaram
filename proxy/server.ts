import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { runAgent, type AgentModelClient } from '../src/lib/agent';
import { defaultProviders, tryProvidersInOrder } from '../src/lib/providers';
import { fetchPageText } from '../src/lib/web';
import { geminiGenerate, grokGenerate } from '../src/shared/llm';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROK_MODEL, normalizeGeminiModel, normalizeGrokModel } from '../src/shared/models';
import { searchSources } from '../src/background/providers';

const app = express();
const REQUESTS_PER_MINUTE = 30;
const MAX_QUERY_LENGTH = 1_000;
const MAX_CONTEXT_LENGTH = 4_000;

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.gemini_token;
// Normalization also repairs an existing proxy .env that contains the prior
// FalseAlarm default, without reading or changing any key material.
const geminiModel = () => normalizeGeminiModel(process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
const grokModel = () => normalizeGrokModel(process.env.GROK_MODEL ?? DEFAULT_GROK_MODEL);

function badRequest(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}

function unavailable(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 503 });
}

function stringField(value: unknown, name: string, maxLength = MAX_QUERY_LENGTH): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${name} must be a non-empty string.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw badRequest(`${name} is too long.`);
  return trimmed;
}

function optionalStringField(value: unknown, name: string, maxLength: number): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest(`${name} must be a string.`);
  if (value.length > maxLength) throw badRequest(`${name} is too long.`);
  return value;
}

/** Keep the read endpoint from becoming a route to the local network. */
function externalHttpUrl(value: unknown): string {
  const raw = stringField(value, 'url', 4_000);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest('url must be a valid absolute URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw badRequest('url must use http or https.');
  const host = parsed.hostname.toLowerCase();
  const privateIpv4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || privateIpv4)
    throw badRequest('url must point to a public website.');
  return parsed.href;
}

function statusOf(error: unknown): number {
  const candidate = (error as { status?: unknown })?.status;
  return typeof candidate === 'number' && candidate >= 400 && candidate < 600 ? candidate : 502;
}

function messageOf(error: unknown): string {
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message ? message : 'The proxy could not complete that request.';
}

// Browser callers must be the installed extension. Requests without an Origin
// header are allowed for local health checks, but they do not receive a broad
// browser CORS grant.
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin.startsWith('chrome-extension://')) {
      callback(null, true);
      return;
    }
    callback(Object.assign(new Error('Origin is not allowed by this proxy.'), { status: 403 }));
  },
}));
app.use(express.json({ limit: '1mb' }));

const requests = new Map<string, { startedAt: number; count: number }>();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = requests.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    requests.set(key, { startedAt: now, count: 1 });
    next();
    return;
  }
  if (bucket.count >= REQUESTS_PER_MINUTE) {
    res.status(429).json({ error: 'Rate limited, try again in a minute.' });
    return;
  }
  bucket.count++;
  next();
});

app.use('/api', (req, res, next) => {
  const token = process.env.PROXY_TOKEN;
  if (token && req.header('x-falsealaram-token') !== token) {
    res.status(401).json({ error: 'Bad proxy token.' });
    return;
  }
  next();
});

const wrap = (fn: (body: Record<string, unknown>) => Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown> : {};
      res.json(await fn(body));
    } catch (error) {
      res.status(statusOf(error)).json({ error: messageOf(error) });
    }
  };

interface LlmRequest { system: string; user: string; schema: object }

function llmRequest(body: Record<string, unknown>): LlmRequest {
  if (typeof body.system !== 'string' || typeof body.user !== 'string' || !body.schema || typeof body.schema !== 'object' || Array.isArray(body.schema))
    throw badRequest('system, user, and schema are required.');
  return { system: body.system, user: body.user, schema: body.schema as object };
}

async function callGemini(request: LlmRequest): Promise<string> {
  const apiKey = geminiKey();
  if (!apiKey) throw unavailable('Missing GEMINI_API_KEY in the proxy environment.');
  return geminiGenerate({ apiKey, model: geminiModel(), ...request });
}

async function callGrokOrGemini(request: LlmRequest): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  if (apiKey) return grokGenerate({ apiKey, model: grokModel(), ...request });
  return callGemini(request);
}

function geminiClient(): AgentModelClient {
  return { generate: (system, user, schema) => callGemini({ system, user, schema }) };
}

function grokClient(): AgentModelClient | undefined {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) return undefined;
  return { generate: (system, user, schema) => grokGenerate({ apiKey, model: grokModel(), system, user, schema }) };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Raw LLM endpoints remain for v2 compatibility. The named detect/factcheck
// routes use the same strict request format and make the proxy contract clearer.
app.post('/api/gemini', wrap(async (body) => ({ text: await callGemini(llmRequest(body)) })));
app.post('/api/grok', wrap(async (body) => ({ text: await callGrokOrGemini(llmRequest(body)) })));
app.post('/api/detect', wrap(async (body) => ({ text: await callGemini(llmRequest(body)) })));
app.post('/api/factcheck', wrap(async (body) => ({ text: await callGrokOrGemini(llmRequest(body)) })));

app.post('/api/sources', wrap(async (body) => {
  if (!Array.isArray(body.keywords) || !body.keywords.every((keyword) => typeof keyword === 'string'))
    throw badRequest('keywords must be an array of strings.');
  const keywords = body.keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 4);
  if (!keywords.length) throw badRequest('keywords must contain at least one non-empty string.');
  return {
    // Scholar remains a proxy-only, best-effort option for the older scan flow.
    sources: await searchSources(keywords, {
      scholar: body.scholar !== false,
      openAlexKey: process.env.OPENALEX_API_KEY,
      limit: Math.min(Math.max(Number(body.limit) || 3, 1), 5),
    }),
  };
}));

app.post('/api/agent/search', wrap(async (body) => {
  const query = stringField(body.query, 'query');
  const providers = defaultProviders({ openAlexKey: process.env.OPENALEX_API_KEY });
  return { sources: await tryProvidersInOrder(providers, query, 3) };
}));

app.post('/api/agent/read', wrap(async (body) => {
  const url = externalHttpUrl(body.url);
  return fetchPageText(url);
}));

app.post('/api/agent/ask', wrap(async (body) => {
  const query = stringField(body.query, 'query');
  const pageContext = optionalStringField(body.pageContext, 'pageContext', MAX_CONTEXT_LENGTH);
  // The agent owns its planning/search/read/quote-validation loop. Supplying no
  // Grok client deliberately triggers its Gemini fallback when only one key is set.
  return runAgent(geminiClient(), grokClient(), query, pageContext, undefined, {
    providers: defaultProviders({ openAlexKey: process.env.OPENALEX_API_KEY }),
  });
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(statusOf(error)).json({ error: messageOf(error) });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`falsealaram proxy listening on http://localhost:${port}`));
