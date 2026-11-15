import type { Claim, Message, Settings } from "./types";
import { cacheResult, getCachedResult } from "./lib/cache";
import { detectClaims, factCheckClaim } from "./lib/llm";
import { isBlockedUrl } from "./lib/blocklist";

const defaultSettings: Settings = {
  enabled: true,
  mode: "direct",
  geminiApiKey: "",
  grokApiKey: "",
  proxyUrl: "",
};

async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...defaultSettings, ...(settings as Partial<Settings> | undefined) };
}

async function notifyTab(tabId: number | undefined, message: Message): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The tab may have navigated or its content script may no longer be present.
  }
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === "DETECT_CHUNKS") {
    void (async () => {
      try {
        const pageUrl = sender.tab?.url ?? "";
        if (sender.tab?.incognito || isBlockedUrl(pageUrl)) {
          throw new Error("FactLens does not scan this page because it is private or blocked.");
        }
        const settings = await getSettings();
        if (!settings.enabled) throw new Error("FactLens is turned off.");
        const claims = await detectClaims(message.chunks.slice(0, 100), settings);
        sendResponse({ claims });
        await notifyTab(sender.tab?.id, {
          type: "FACTLENS_STATUS",
          status: claims.length ? `Found ${claims.length} possible claims.` : "No factual claims flagged.",
          count: claims.length,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Claim detection failed.";
        sendResponse({ error: messageText });
      }
    })();
    return true;
  }

  if (message.type === "FACTCHECK_CLAIM") {
    void (async () => {
      try {
        const settings = await getSettings();
        const cached = await getCachedResult(message.claim.text);
        const result = cached ?? (await factCheckClaim(message.claim, settings));
        if (!cached) await cacheResult(message.claim.text, result);
        sendResponse({ result });
        await notifyTab(sender.tab?.id, {
          type: "FACTLENS_RESULT",
          claim: message.claim,
          result,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Fact-check failed.";
        sendResponse({ error: messageText });
        await notifyTab(sender.tab?.id, { type: "FACTLENS_ERROR", message: messageText });
      }
    })();
    return true;
  }

  return false;
});
