export type Verdict =
  | "supported"
  | "contradicted"
  | "partially-supported"
  | "insufficient-evidence";

export interface Claim {
  chunkId: string;
  text: string;
  reason: string;
  confidence: number;
  keywords: string[];
}

export interface TextChunk {
  id: string;
  text: string;
}

export interface Source {
  title: string;
  authors: string;
  year: number | null;
  url: string;
  snippet: string;
  summary?: string;
  provider: "google-scholar" | "semantic-scholar" | "openalex" | "none";
}

export interface FactCheckResult {
  claim: string;
  verdict: Verdict;
  explanation: string;
  correctedInfo: string;
  sources: Source[];
  scholarUrl: string;
  demoMode?: boolean;
}

export type ProviderMode = "direct" | "proxy";

export interface Settings {
  enabled: boolean;
  mode: ProviderMode;
  geminiApiKey: string;
  grokApiKey: string;
  proxyUrl: string;
}

export type Message =
  | { type: "FACTLENS_SCAN" }
  | { type: "FACTLENS_CLEAR" }
  | { type: "FACTLENS_TOGGLE"; enabled: boolean }
  | { type: "DETECT_CHUNKS"; chunks: TextChunk[] }
  | { type: "FACTCHECK_CLAIM"; claim: Claim }
  | { type: "FACTLENS_STATUS"; status: string; count: number }
  | { type: "FACTLENS_RESULT"; claim: Claim; result: FactCheckResult }
  | { type: "FACTLENS_ERROR"; message: string };
