/** The only verdict values rendered or persisted by v3. */
export type Verdict = 'supported' | 'contradicted' | 'partially_supported' | 'insufficient_evidence';

/**
 * Keep this open-ended: a proxy may add a clearly labelled source provider,
 * while first-party providers retain their human-readable PRD names.
 */
export type ProviderName = 'Wikipedia' | 'Semantic Scholar' | 'OpenAlex' | 'Google Scholar' | 'None' | string;

export interface Chunk { id: string; text: string }
export interface Claim {
  id: string;          // unique per page scan: `chunkId-{i}`
  hash: string;        // sha256(normalized claim) prefix -> cache key
  chunkId: string; text: string; reason: string; confidence: number; keywords: string[];
}

/** A search result, optionally enriched with text read from its actual page. */
export interface Source {
  title: string;
  authors: string;
  year: number | null;
  url: string;
  /** Search-result prose. Kept separate from pageText so a quote can be verified. */
  snippet: string;
  provider: ProviderName;
  summary?: string;
  pageText?: string;
  /** v2 compatibility only; new callers should use snippet. */
  abstract?: string;
}

export interface FactCheckResult {
  claimId: string; claimHash: string; claimText: string; verdict: Verdict;
  explanation: string; correction: string;
  supportingSources: number[]; // 1-based indexes into `sources`
  sources: Source[]; scholarUrl: string; checkedAt: number; error?: string; demoMode?: boolean;
}

export interface AgentStep { label: string; detail: string; }

export interface AgentQuote { text: string; url: string; }

export interface AgentResult {
  query: string;
  answer: string;
  verdict: Verdict;
  explanation: string;
  correctedInfo: string;
  sources: Source[];
  quotes: AgentQuote[];
  steps: AgentStep[];
  confidence: number;
  /** A safe, user-facing problem description; never contains a secret. */
  error?: string;
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

export interface AgentAskMessage { type: 'AGENT_ASK'; query: string; pageContext?: string; tabId?: number }
export interface AgentGetRunMessage { type: 'AGENT_GET_RUN'; tabId?: number }
export interface AgentProgressMessage { type: 'AGENT_PROGRESS'; status: string; step: AgentStep }
export interface AgentResultMessage { type: 'AGENT_RESULT'; result: AgentResult }

/** Messages accepted by the background service worker. */
export type ToBackground =
  | { type: 'SCAN_REQUEST'; payload: ScanRequest }
  | AgentAskMessage
  | AgentGetRunMessage
  | { type: 'AGENT_OPEN'; url: string }
  | { type: 'AGENT_GOTO'; url: string };

/** Messages sent back to a content script or extension surface. */
export type ToContent =
  | { type: 'PROGRESS'; payload: Progress }
  | { type: 'CLAIM_PENDING'; payload: { claim: Claim } }
  | { type: 'CLAIM_RESULT'; payload: { result: FactCheckResult } }
  | { type: 'POPUP_SCAN' }
  | { type: 'GET_STATUS' }
  | { type: 'CLEAR' }
  | AgentProgressMessage
  | AgentResultMessage;

/** Public union used by callers that do not care which extension surface sent it. */
export type ExtensionMessage = ToBackground | ToContent;
