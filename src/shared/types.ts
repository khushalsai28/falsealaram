export type Verdict = 'supported' | 'contradicted' | 'partially-supported' | 'insufficient-evidence';
export type ProviderName = 'google-scholar' | 'semantic-scholar' | 'openalex' | 'none';

export interface Chunk { id: string; text: string }
export interface Claim {
  id: string;          // unique per page scan: `chunkId-{i}`
  hash: string;        // sha256(normalized claim) prefix -> cache key
  chunkId: string; text: string; reason: string; confidence: number; keywords: string[];
}
export interface Source {
  title: string; authors: string; year: number | null; url: string; abstract: string;
  provider: ProviderName; summary?: string;
}
export interface FactCheckResult {
  claimId: string; claimHash: string; claimText: string; verdict: Verdict;
  explanation: string; correction: string;
  supportingSources: number[]; // 1-based indexes into `sources`
  sources: Source[]; scholarUrl: string; checkedAt: number; error?: string; demoMode?: boolean;
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

export type ToBackground = { type: 'SCAN_REQUEST'; payload: ScanRequest };
export type ToContent =
  | { type: 'PROGRESS'; payload: Progress }
  | { type: 'CLAIM_PENDING'; payload: { claim: Claim } }
  | { type: 'CLAIM_RESULT'; payload: { result: FactCheckResult } }
  | { type: 'POPUP_SCAN' }
  | { type: 'GET_STATUS' };
