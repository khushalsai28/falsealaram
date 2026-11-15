export type Verdict = 'supported' | 'contradicted' | 'partially supported' | 'insufficient evidence';
export type ProviderName = 'Google Scholar' | 'Semantic Scholar' | 'OpenAlex' | 'Wikipedia' | 'DuckDuckGo' | 'Web' | 'Grok';

export interface Chunk { id: string; text: string }
export interface Claim {
  id: string;          // unique per page scan: `chunkId-{i}`
  hash: string;        // sha256(normalized claim) prefix -> cache key
  chunkId: string; text: string; reason: string; confidence: number; keywords: string[];
}
export interface Source {
  title: string; authors: string[]; year: number | null; url: string; abstract: string;
  provider: ProviderName; summary?: string;
  /** 0-1, how established the outlet is. Modest scores are still usable. */
  reliability?: number;
  /** Search-result prose used by the research agent before it reads a page. */
  snippet?: string;
  /** Public page text read by the research agent; never model-generated. */
  pageText?: string;
}
export interface FactCheckResult {
  claimId: string; claimHash: string; claimText: string; verdict: Verdict;
  explanation: string; correction: string;
  supportingSources: number[]; // 1-based indexes into `sources`
  sources: Source[]; checkedAt: number; error?: string;
}
export interface Settings {
  enabled: boolean; autoScan: boolean; mode: 'direct' | 'proxy';
  proxyUrl: string; proxyToken: string;
  geminiKey: string; grokKey: string; openAlexKey: string;
  geminiModel: string; grokModel: string;
  confidenceThreshold: number; maxClaims: number; scholarEnabled: boolean; blocklist: string[];
}

// ---- messages ----
export interface ScanRequest { pageUrl: string; chunks: Chunk[]; maxClaims: number }
export interface ScanSummary { ok: boolean; claimsFound: number; flagged: number; error?: string }
export interface Progress { stage: 'detecting' | 'checking' | 'done' | 'error'; message: string }
export interface StatusResponse { enabled: boolean; blocked: string | null; status: string; claims: number }

export interface AgentStep { label: string; detail: string }
export interface AgentQuote { text: string; url: string }
export interface AgentResult {
  query: string;
  answer: string;
  /** Uses the same four canonical scan verdicts as page checks. */
  verdict: Verdict;
  explanation: string;
  correctedInfo: string;
  sources: Source[];
  quotes: AgentQuote[];
  steps: AgentStep[];
  confidence: number;
  error?: string;
}

export type ToBackground =
  | { type: 'SCAN_REQUEST'; payload: ScanRequest }
  | { type: 'AGENT_ASK'; query: string; pageContext?: string; tabId?: number }
  | { type: 'AGENT_GET_RUN'; tabId?: number }
  | { type: 'AGENT_OPEN'; url: string }
  | { type: 'AGENT_GOTO'; url: string };
export type ToContent =
  | { type: 'PROGRESS'; payload: Progress }
  | { type: 'CLAIM_PENDING'; payload: { claim: Claim } }
  | { type: 'CLAIM_RESULT'; payload: { result: FactCheckResult } }
  | { type: 'POPUP_SCAN' }
  | { type: 'GET_STATUS' }
  | { type: 'CLEAR' }
  | { type: 'AGENT_PROGRESS'; status: string; step: AgentStep }
  | { type: 'AGENT_RESULT'; result: AgentResult };
