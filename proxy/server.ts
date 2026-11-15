import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { geminiGenerate, grokGenerate } from '../src/shared/llm';
import { searchSources } from '../src/background/providers';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GROK_MODEL, normalizeGeminiModel, normalizeGrokModel } from '../src/shared/models';

const app = express();
// Only the extension (chrome-extension:// origin) or non-browser clients may call this.
app.use(cors({ origin: (o, cb) => cb(null, !o || o.startsWith('chrome-extension://')) }));
app.use(express.json({ limit: '3mb' }));
app.use('/api', (req, res, next) => {
  const t = process.env.PROXY_TOKEN;
  if (t && req.header('x-falsealarm-token') !== t) return res.status(401).json({ error: 'Bad proxy token' });
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
  return { text: await grokGenerate({ apiKey: process.env.GROK_API_KEY!, model, system: b.system, user: b.user, schema: b.schema }) };
}));
app.post('/api/sources', wrap(async (b) => {
  if (!Array.isArray(b.keywords) || !b.keywords.every((k: unknown) => typeof k === 'string')) throw Object.assign(new Error('Bad request'), { status: 400 });
  return { sources: await searchSources(b.keywords.slice(0, 4), { scholar: b.scholar !== false, openAlexKey: process.env.OPENALEX_API_KEY, limit: Math.min(Number(b.limit) || 3, 5) }) };
}));

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`FalseAlarm proxy on http://localhost:${port}`));
