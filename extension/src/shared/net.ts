export class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** fetch with timeout + exponential backoff (honours Retry-After). Throws HttpError on final non-2xx. */
export async function fetchRetry(
  url: string, init: RequestInit = {}, o: { retries?: number; timeoutMs?: number; baseMs?: number } = {},
): Promise<Response> {
  const { retries = 3, timeoutMs = 30000, baseMs = 1000 } = o;
  for (let a = 0; ; a++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let delay = baseMs * 2 ** a + Math.random() * 250;
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      if (!RETRYABLE.has(res.status) || a >= retries) throw new HttpError(res.status, `HTTP ${res.status}: ${body}`);
      const ra = Number(res.headers.get('retry-after'));
      if (ra > 0) delay = Math.min(ra, 20) * 1000;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (a >= retries) throw (e as Error).name === 'AbortError' ? new Error('Request timed out') : e;
    } finally { clearTimeout(timer); }
    await sleep(delay);
  }
}

export function describeError(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401 || e.status === 403) return 'API key invalid or not authorized.';
    if (e.status === 404) return 'Model or endpoint not found (check the model name in Options).';
    if (e.status === 429) return 'Rate limited by the API - try again in a minute.';
    return e.message;
  }
  return (e as Error)?.message ?? String(e);
}
