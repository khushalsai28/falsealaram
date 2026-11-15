import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { runAgent, type AgentDependencies, type AgentModelClient } from '../src/lib/agent';
import { geminiGenerate, grokGenerate, grokSearch } from '../src/shared/llm';
import { searchSources } from '../src/background/providers';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROK_MODEL, normalizeGeminiModel, normalizeGrokModel } from '../src/shared/models';

const app = express();
// Only the extension (chrome-extension:// origin) or non-browser clients may call this.
app.use(cors({ origin: (o, cb) => cb(null, !o || o.startsWith('chrome-extension://')) }));
app.use(express.json({ limit: '3mb' }));
app.use('/api', (req, res, next) => {
  const t = process.env.PROXY_TOKEN;
  const supplied = req.header('x-falsealaram-token') ?? req.header('x-falsealarm-token');
  if (t && supplied !== t) return res.status(401).json({ error: 'Bad proxy token' });
  next();
});

const wrap = (fn: (b: any) => Promise<unknown>) => async (req: express.Request, res: express.Response) => {
  try { res.json(await fn(req.body ?? {})); }
  catch (e: any) { res.status(e?.status && e.status < 600 ? e.status : 502).json({ error: String(e?.message ?? e) }); }
};
const need = (b: any) => {
  if (typeof b.system !== 'string' || typeof b.user !== 'string' || typeof b.schema !== 'object') throw Object.assign(new Error('Bad request'), { status: 400 });
};

app.post('/api/gemini', wrap(async (b) => {
  need(b);
  const model = normalizeGeminiModel(process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
  return { text: await geminiGenerate({ apiKey: process.env.GEMINI_API_KEY!, model, system: b.system, user: b.user, schema: b.schema }) };
}));
app.post('/api/grok', wrap(async (b) => {
  need(b);
  const model = normalizeGrokModel(process.env.GROK_MODEL ?? DEFAULT_GROK_MODEL);
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) throw Object.assign(new Error('Missing GROK_API_KEY in the proxy environment.'), { status: 503 });
  if (b.search === true) {
    const found = await grokSearch({ apiKey, model, system: b.system, user: b.user });
    return { text: found.text, citations: found.citations };
  }
  return { text: await grokGenerate({ apiKey, model, system: b.system, user: b.user, schema: b.schema }) };
}));
app.post('/api/sources', wrap(async (b) => {
  if (!Array.isArray(b.keywords) || !b.keywords.every((k: unknown) => typeof k === 'string')) throw Object.assign(new Error('Bad request'), { status: 400 });
  return { sources: await searchSources(b.keywords.slice(0, 4), { scholar: b.scholar !== false, openAlexKey: process.env.OPENALEX_API_KEY, limit: Math.min(Number(b.limit) || 3, 5) }) };
}));

function agentClient(kind: 'gemini' | 'grok'): AgentModelClient | undefined {
  const apiKey = kind === 'gemini' ? process.env.GEMINI_API_KEY : process.env.GROK_API_KEY;
  if (!apiKey) return undefined;
  return {
    generate(system, user, schema) {
      if (kind === 'gemini') {
        const model = normalizeGeminiModel(process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL);
        return geminiGenerate({ apiKey, model, system, user, schema });
      }
      const model = normalizeGrokModel(process.env.GROK_MODEL ?? DEFAULT_GROK_MODEL);
      return grokGenerate({ apiKey, model, system, user, schema });
    },
  };
}

const proxyResearchSearch: AgentDependencies['search'] = async (_providers, query, limit = 3) =>
  searchSources([query], {
    scholar: true,
    openAlexKey: process.env.OPENALEX_API_KEY,
    limit: Math.min(Math.max(limit, 1), 5),
  });

app.post('/api/agent/ask', wrap(async (b) => {
  const query = typeof b.query === 'string' ? b.query.trim().slice(0, 1_000) : '';
  if (!query) throw Object.assign(new Error('query must be a non-empty string'), { status: 400 });
  const pageContext = typeof b.pageContext === 'string' ? b.pageContext.trim().slice(0, 2_000) : undefined;
  const gemini = agentClient('gemini');
  if (!gemini) throw Object.assign(new Error('Missing GEMINI_API_KEY in the proxy environment.'), { status: 503 });
  return runAgent(gemini, agentClient('grok'), query, pageContext, undefined, {
    providers: [], search: proxyResearchSearch,
  });
}));

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`FalseAlarm proxy on http://localhost:${port}`));
