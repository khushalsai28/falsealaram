import "../popup/popup.css";
import type { Settings } from "../types";
import { isBlockedUrl } from "../lib/blocklist";

const defaultSettings: Settings = {
  enabled: true,
  mode: "direct",
  geminiApiKey: "",
  grokApiKey: "",
  proxyUrl: "",
};
const enabledInput = document.querySelector<HTMLInputElement>("#enabled")!;
const scanButton = document.querySelector<HTMLButtonElement>("#scan")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const optionsLink = document.querySelector<HTMLAnchorElement>("#options")!;

async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...defaultSettings, ...(settings as Partial<Settings> | undefined) };
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab was found.");
  if (!tab.url || isBlockedUrl(tab.url)) throw new Error("FactLens cannot scan this page.");
  return tab;
}

async function injectContent(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "FACTLENS_SCAN" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "FACTLENS_SCAN" });
  }
}

async function persistEnabled(enabled: boolean): Promise<void> {
  const settings = await loadSettings();
  await chrome.storage.local.set({ settings: { ...settings, enabled } });
}

void loadSettings().then((settings) => {
  enabledInput.checked = settings.enabled;
  status.textContent =
    settings.mode === "direct" && (!settings.geminiApiKey || !settings.grokApiKey)
      ? "Demo mode is ready. Add API keys for full AI checks."
      : `Ready to scan in ${settings.mode} mode.`;
});

enabledInput.addEventListener("change", async () => {
  await persistEnabled(enabledInput.checked);
  try {
    const tab = await activeTab();
    await chrome.tabs.sendMessage(tab.id!, { type: "FACTLENS_TOGGLE", enabled: enabledInput.checked });
  } catch {
    // The content script is injected only after the user starts a scan.
  }
  status.textContent = enabledInput.checked ? "FactLens is on." : "FactLens is off.";
});

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  status.textContent = "Starting scan…";
  try {
    const settings = await loadSettings();
    if (!settings.enabled) {
      status.textContent = "Turn FactLens on to scan this page.";
      return;
    }
    const tab = await activeTab();
    await injectContent(tab.id!);
    status.textContent = "Scanning page text…";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not scan this page.";
  } finally {
    scanButton.disabled = false;
  }
});

clearButton.addEventListener("click", async () => {
  try {
    const tab = await activeTab();
    await chrome.tabs.sendMessage(tab.id!, { type: "FACTLENS_CLEAR" });
    status.textContent = "Highlights cleared.";
  } catch {
    status.textContent = "No FactLens highlights to clear.";
  }
});

optionsLink.addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});
