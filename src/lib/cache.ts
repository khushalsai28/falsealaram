import type { FactCheckResult } from "../types";

const CACHE_PREFIX = "factlens:claim:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  savedAt: number;
  result: FactCheckResult;
}

async function hashClaim(claim: string): Promise<string> {
  const bytes = new TextEncoder().encode(claim.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getCachedResult(claim: string): Promise<FactCheckResult | null> {
  const key = CACHE_PREFIX + (await hashClaim(claim));
  const values = await chrome.storage.local.get(key);
  const entry = values[key] as CacheEntry | undefined;
  if (!entry || Date.now() - entry.savedAt > TTL_MS) {
    if (entry) await chrome.storage.local.remove(key);
    return null;
  }
  return entry.result;
}

export async function cacheResult(claim: string, result: FactCheckResult): Promise<void> {
  const key = CACHE_PREFIX + (await hashClaim(claim));
  await chrome.storage.local.set({ [key]: { savedAt: Date.now(), result } satisfies CacheEntry });
}
