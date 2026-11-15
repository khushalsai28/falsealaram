import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { geminiGenerate, grokGenerate } from '../src/shared/llm';
import { searchSources } from '../src/background/providers';

const app = express();
// Only the extension (chrome-extension:// origin) or non-browser clients may call this.
app.use(cors({ origin: (o, cb) => cb(null, !o || o.startsWith('chrome-extension://')) }));
app.use(express.json({ limit: '1mb' }));
const requests = new Map<string, { startedAt: number; count: number }>();
app.use('/api', (req, res, next) => {
  const now = Date.now(), key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = requests.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    requests.set(key, { startedAt: now, count: 1 });
    next();
    return;
  }
  if (bucket.count >= 30) {
    res.status(429).json({ error: 'Rate limited, try again in a minute.' });
    return;
  }
  bucket.count++;
  next();
});
app.use('/api', (req, res, next) => {
  const t = process.env.PROXY_TOKEN;
  if (t && req.header('x-falsealaram-token') !== t) return res.status(401).json({ error: 'Bad proxy token' });
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
  return { text: await geminiGenerate({ apiKey: process.env.GEMINI_API_KEY!, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', system: b.system, user: b.user, schema: b.schema }) };
}));
app.post('/api/grok', wrap(async (b) => {
  need(b);
  return { text: await grokGenerate({ apiKey: process.env.GROK_API_KEY!, model: process.env.GROK_MODEL || 'grok-4.7', system: b.system, user: b.user, schema: b.schema }) };
}));
app.post('/api/sources', wrap(async (b) => {
  if (!Array.isArray(b.keywords) || !b.keywords.every((k: unknown) => typeof k === 'string')) throw Object.assign(new Error('Bad request'), { status: 400 });
  return { sources: await searchSources(b.keywords.slice(0, 4), { scholar: b.scholar !== false, openAlexKey: process.env.OPENALEX_API_KEY, limit: Math.min(Number(b.limit) || 3, 5) }) };
}));

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`falsealaram proxy on http://localhost:${port}`));
