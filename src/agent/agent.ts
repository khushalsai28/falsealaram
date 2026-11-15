import './agent.css';
import { agentRunKey, type AgentRunState } from '../shared/agent-state';

interface AgentStep { label: string; detail: string; }
interface AgentSource {
  title: string;
  authors?: string;
  year?: number | null;
  url: string;
  snippet?: string;
  abstract?: string;
  provider?: string;
  summary?: string;
}
interface AgentQuote { text: string; url: string; }
interface AgentResult {
  query: string;
  answer: string;
  verdict: string;
  explanation: string;
  correctedInfo?: string;
  correction?: string;
  sources: AgentSource[];
  quotes: AgentQuote[];
  steps: AgentStep[];
  confidence?: number;
  error?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('research-form');
const question = $<HTMLTextAreaElement>('question');
const askButton = $<HTMLButtonElement>('ask');
const pageButton = $<HTMLButtonElement>('page-context');
const settingsButton = $<HTMLButtonElement>('settings');
const status = $('status');
const trace = $<HTMLOListElement>('trace');
const traceState = $('trace-state');
const answerCard = $('answer-card');
const verdictEl = $('verdict');
const confidenceEl = $('confidence');
const answerEl = $('answer');
const explanationEl = $('explanation');
const correctionEl = $('correction');
const quotesSection = $('quotes-section');
const quotesEl = $('quotes');
const sourcesSection = $('sources-section');
const sourcesEl = $<HTMLOListElement>('sources');

let pending = false;
const seenSteps = new Set<string>();
let researchTabId: number | undefined;

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function providerLabel(value?: string): string {
  const labels: Record<string, string> = {
    wikipedia: 'Wikipedia',
    'semantic scholar': 'Semantic Scholar',
    'semantic-scholar': 'Semantic Scholar',
    semantic_scholar: 'Semantic Scholar',
    openalex: 'OpenAlex',
    'google scholar': 'Google Scholar',
    'google-scholar': 'Google Scholar',
  };
  return labels[(value ?? '').toLowerCase()] ?? value ?? 'Source';
}

function displayVerdict(value: string): string {
  return value.replace(/[-_]+/g, ' ');
}

function setStatus(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function setPending(value: boolean) {
  pending = value;
  askButton.disabled = value;
  pageButton.disabled = value;
  settingsButton.disabled = value;
  question.disabled = value;
  traceState.textContent = value ? 'Researching' : 'Waiting';
}

function appendStep(step: AgentStep) {
  const key = `${step.label}\u0000${step.detail}`;
  if (seenSteps.has(key)) return;
  seenSteps.add(key);
  const item = document.createElement('li');
  const label = document.createElement('span');
  label.className = 'step-label';
  label.textContent = step.label;
  item.append(label);
  if (step.detail) {
    const detail = document.createElement('span');
    detail.className = 'step-detail';
    detail.textContent = ` — ${step.detail}`;
    item.append(detail);
  }
  trace.append(item);
}

function begin(query: string) {
  trace.replaceChildren();
  seenSteps.clear();
  answerCard.hidden = true;
  setPending(true);
  setStatus(`Researching “${query}”`);
}

function showError(message: string) {
  setPending(false);
  traceState.textContent = 'Needs attention';
  setStatus(message, true);
}

function send(message: object): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

function stateResult(value: unknown): AgentResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as Partial<AgentResult>;
  return typeof result.query === 'string' && typeof result.answer === 'string' && typeof result.verdict === 'string'
    && Array.isArray(result.sources) && Array.isArray(result.quotes) && Array.isArray(result.steps)
    ? result as AgentResult
    : undefined;
}

function applyRunState(state: AgentRunState | undefined) {
  if (!state) return;
  if (state.status === 'running') {
    if (!pending || question.value.trim() !== state.query) begin(state.query);
    return;
  }
  const result = stateResult(state.result);
  if (result) renderResult(result);
}

async function hydrateRunState() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    researchTabId = tab.id;
    const response = await send({ type: 'AGENT_GET_RUN', tabId: tab.id }) as { state?: unknown } | undefined;
    const state = response?.state;
    if (state && typeof state === 'object') applyRunState(state as AgentRunState);
  } catch {
    // This only protects the popup-to-side-panel handoff. Direct responses
    // still render immediately below.
  }
}

function sourceNode(source: AgentSource): HTMLLIElement {
  const item = document.createElement('li');
  const row = document.createElement('div');
  row.className = 'source-title-row';
  const title = document.createElement('a');
  title.className = 'source-link';
  title.textContent = source.title || 'Untitled source';
  const url = safeUrl(source.url);
  if (url) {
    title.href = url;
    title.addEventListener('click', (event) => {
      event.preventDefault();
      void send({ type: 'AGENT_GOTO', url }).catch(() => undefined);
    });
  } else {
    title.removeAttribute('href');
  }
  row.append(title);
  const open = document.createElement('button');
  open.className = 'open-source';
  open.type = 'button';
  open.textContent = 'Open in background';
  open.disabled = !url;
  open.addEventListener('click', () => {
    if (url) void send({ type: 'AGENT_OPEN', url }).catch(() => setStatus('Could not open that source.', true));
  });
  row.append(open);
  item.append(row);

  const provider = document.createElement('span');
  provider.className = 'provider';
  provider.textContent = providerLabel(source.provider);
  title.after(provider);
  const byline = [source.authors, source.year].filter((value) => value != null && value !== '').join(' · ');
  if (byline) {
    const meta = document.createElement('div');
    meta.className = 'source-meta';
    meta.textContent = byline;
    item.append(meta);
  }
  const snippet = source.summary || source.snippet || source.abstract;
  if (snippet) {
    const summary = document.createElement('div');
    summary.className = 'source-snippet';
    summary.textContent = snippet;
    item.append(summary);
  }
  return item;
}

function quoteNode(quote: AgentQuote): HTMLDivElement {
  const holder = document.createElement('div');
  holder.className = 'quote';
  const text = document.createElement('p');
  text.textContent = `“${quote.text}”`;
  holder.append(text);
  const url = safeUrl(quote.url);
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'View source';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void send({ type: 'AGENT_GOTO', url }).catch(() => undefined);
    });
    holder.append(link);
  }
  return holder;
}

function renderResult(result: AgentResult) {
  for (const step of result.steps ?? []) appendStep(step);
  const verdict = (result.verdict || 'insufficient_evidence').replace(/-/g, '_');
  verdictEl.className = `verdict ${verdict}`;
  verdictEl.textContent = displayVerdict(verdict);
  const confidence = Number(result.confidence);
  confidenceEl.textContent = Number.isFinite(confidence) ? `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}% confidence` : '';
  answerEl.textContent = result.answer || 'No answer was returned.';
  explanationEl.textContent = result.explanation || '';
  const correction = result.correctedInfo || result.correction || '';
  correctionEl.textContent = correction ? `Corrected information: ${correction}` : '';
  correctionEl.hidden = !correction;

  quotesEl.replaceChildren(...(result.quotes ?? []).map(quoteNode));
  quotesSection.hidden = !(result.quotes?.length);
  sourcesEl.replaceChildren(...(result.sources ?? []).map(sourceNode));
  sourcesSection.hidden = !(result.sources?.length);
  answerCard.hidden = false;
  setPending(false);
  traceState.textContent = 'Complete';
  setStatus(result.error || 'Research complete.', Boolean(result.error));
}

async function ask(pageContext?: string) {
  const query = question.value.trim();
  if (!query) {
    question.focus();
    setStatus('Enter a question before asking the agent.', true);
    return;
  }
  begin(query);
  try {
    const response = await send({
      type: 'AGENT_ASK',
      query,
      ...(pageContext ? { pageContext } : {}),
      ...(researchTabId != null ? { tabId: researchTabId } : {}),
    }) as { ok?: boolean; result?: unknown; error?: unknown } | undefined;
    const maybeResult = stateResult(response?.result);
    if (maybeResult) {
      renderResult(maybeResult);
      return;
    }
    const message = typeof response?.error === 'string'
      ? response.error
      : 'The research agent returned no result.';
    throw new Error(message);
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Could not start the research agent.');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void ask();
});

pageButton.addEventListener('click', async () => {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.url) {
    setStatus('Could not read the active tab context.', true);
    return;
  }
  const pageContext = `Page title: ${tab.title ?? '(untitled)'}\nPage URL: ${tab.url}`;
  await ask(pageContext);
});

settingsButton.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

question.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void ask();
  }
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as {
    type?: string;
    status?: string;
    step?: AgentStep;
    result?: AgentResult;
    payload?: { status?: string; step?: AgentStep; result?: AgentResult };
  };
  if (msg.type === 'AGENT_PROGRESS') {
    const step = msg.step ?? msg.payload?.step;
    const progress = msg.status ?? msg.payload?.status;
    if (step) appendStep(step);
    if (progress) setStatus(progress);
  }
  if (msg.type === 'AGENT_RESULT') {
    const result = msg.result ?? msg.payload?.result;
    if (result) renderResult(result);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName !== 'session' && areaName !== 'local') || researchTabId == null) return;
  const next = changes[agentRunKey(researchTabId)]?.newValue;
  if (next) applyRunState(next as AgentRunState);
});

void hydrateRunState();
