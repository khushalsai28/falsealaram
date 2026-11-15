import type { AgentResult, AgentStep, Settings } from '../shared/types';
import { describeError, fetchRetry } from '../shared/net';
import { getSettings } from '../shared/settings';
import { callLLM, type Kind } from './llm';
import { resolveKeys } from './config';
import { runAgent, type AgentDependencies, type AgentModelClient } from '../lib/agent';
import { searchSources } from './providers';

type ProgressSink = (status: string, step: AgentStep) => void;

const cleanQuery = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 1_000) : '';
const cleanContext = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 2_000) : undefined;

function resultFor(
  query: string,
  answer: string,
  explanation = answer,
  error?: string,
  steps: AgentStep[] = [],
): AgentResult {
  return {
    query,
    answer,
    verdict: 'insufficient evidence',
    explanation,
    correctedInfo: '',
    sources: [],
    quotes: [],
    steps,
    confidence: 0,
    ...(error ? { error } : {}),
  };
}

function model(kind: Kind, settings: Settings): AgentModelClient {
  return {
    generate: (system, user, schema) => callLLM(kind, settings, system, user, schema),
  };
}

function report(status: string, step: AgentStep) {
  // A side-panel port is not required: runtime messages reach popup and side-panel
  // contexts, while content scripts simply ignore agent-only messages.
  void chrome.runtime.sendMessage({ type: 'AGENT_PROGRESS', status, step }).catch(() => undefined);
}

/** Reuse the scanner's Scholar/OpenAlex→Wikipedia/DuckDuckGo search policy. */
function researchSearch(settings: Settings, openAlexKey?: string): AgentDependencies['search'] {
  return async (_providers, query, limit = 3) => searchSources([query], {
    scholar: settings.scholarEnabled,
    openAlexKey,
    limit: Math.min(Math.max(limit, 1), 5),
  });
}

function isAgentResult(value: unknown): value is AgentResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AgentResult>;
  return typeof item.query === 'string' && typeof item.answer === 'string'
    && typeof item.verdict === 'string' && Array.isArray(item.sources)
    && Array.isArray(item.quotes) && Array.isArray(item.steps);
}

async function askProxy(query: string, pageContext: string | undefined, settings: Settings): Promise<AgentResult> {
  const url = `${settings.proxyUrl.replace(/\/$/, '')}/api/agent/ask`;
  const response = await fetchRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.proxyToken ? { 'x-falsealaram-token': settings.proxyToken } : {}),
    },
    body: JSON.stringify({ query, pageContext }),
  }, { timeoutMs: 120_000, retries: 0 });
  const body: unknown = await response.json();
  const result = body && typeof body === 'object' && 'result' in body
    ? (body as { result: unknown }).result : body;
  if (!isAgentResult(result)) throw new Error('Proxy returned an invalid agent response.');
  return result;
}

async function askDirect(query: string, pageContext: string | undefined, settings: Settings, onProgress: ProgressSink): Promise<AgentResult> {
  const keys = resolveKeys(settings);
  if (!keys.gemini) {
    const message = 'API keys are needed to answer this question. Add a Gemini API key in Options or configure a proxy.';
    const step: AgentStep = { label: 'Configuration needed', detail: 'No Gemini key or research proxy is configured' };
    onProgress(message, step);
    return resultFor(
      query,
      'Agent mode needs a Gemini API key or a configured proxy before it can research this question.',
      'Add keys in Options or set a Proxy URL. I will not guess without evidence.',
      message,
      [step],
    );
  }
  return runAgent(
    model('gemini', settings),
    keys.grok ? model('grok', settings) : undefined,
    query,
    pageContext,
    onProgress,
    { providers: [], search: researchSearch(settings, keys.openAlex) },
  );
}

/** Execute Agent mode using a configured proxy, with an explicit direct-mode fallback. */
export async function askAgent(rawQuery: unknown, rawPageContext: unknown): Promise<AgentResult> {
  const query = cleanQuery(rawQuery);
  if (!query) return resultFor('', 'Enter a question first.', 'The agent needs a question before it can search.');
  const pageContext = cleanContext(rawPageContext);
  const settings = await getSettings();
  const onProgress: ProgressSink = report;

  if (settings.mode === 'proxy') {
    const connecting: AgentStep = { label: 'Connecting', detail: 'Using the configured research proxy' };
    report('Connecting to proxy', connecting);
    try {
      const result = await askProxy(query, pageContext, settings);
      for (const step of result.steps) report(step.label, step);
      return result;
    } catch (error) {
      const keys = resolveKeys(settings);
      if (!keys.gemini) {
        const message = describeError(error);
        const step: AgentStep = { label: 'Proxy unavailable', detail: message };
        report('Research proxy unavailable', step);
        return resultFor(
          query,
          'The research proxy could not be reached.',
          `${message} Add a working proxy or direct Gemini key; I will not guess.`,
          message,
          [connecting, step],
        );
      }
      const fallback: AgentStep = { label: 'Proxy unavailable', detail: 'Falling back to your direct Gemini configuration' };
      report('Proxy unavailable; using direct mode', fallback);
      return askDirect(query, pageContext, settings, onProgress);
    }
  }

  try {
    return await askDirect(query, pageContext, settings, onProgress);
  } catch (error) {
    const message = describeError(error);
    const answer = /rate limited/i.test(message)
      ? 'The research provider is rate limited. Please try again in a minute.'
      : 'I could not complete this research run.';
    const step: AgentStep = { label: 'Unable to verify', detail: message };
    report(answer, step);
    return resultFor(query, answer, message, message, [step]);
  }
}
