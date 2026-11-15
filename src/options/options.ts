import "./options.css";
import type { ProviderMode, Settings } from "../types";

const form = document.querySelector<HTMLFormElement>("#settings-form")!;
const mode = document.querySelector<HTMLSelectElement>("#mode")!;
const proxyUrl = document.querySelector<HTMLInputElement>("#proxy-url")!;
const geminiKey = document.querySelector<HTMLInputElement>("#gemini-key")!;
const grokKey = document.querySelector<HTMLInputElement>("#grok-key")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;

void chrome.storage.local.get("settings").then(({ settings }) => {
  const saved = settings as Partial<Settings> | undefined;
  mode.value = saved?.mode ?? "direct";
  proxyUrl.value = saved?.proxyUrl ?? "";
  geminiKey.value = saved?.geminiApiKey ?? "";
  grokKey.value = saved?.grokApiKey ?? "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  let selectedProxyOrigin = "";
  if (mode.value === "proxy") {
    try {
      selectedProxyOrigin = new URL(proxyUrl.value.trim()).origin;
    } catch {
      status.textContent = "Enter a valid proxy URL.";
      status.style.color = "#b42318";
      return;
    }
    const granted = await chrome.permissions.request({
      origins: [`${selectedProxyOrigin}/*`],
    });
    if (!granted) {
      status.textContent = "Proxy access was not granted; settings were not changed.";
      status.style.color = "#b42318";
      return;
    }
  }
  const values = await chrome.storage.local.get("settings");
  const previous = values.settings as Partial<Settings> | undefined;
  const settings: Settings = {
    enabled: previous?.enabled ?? true,
    mode: mode.value as ProviderMode,
    proxyUrl: proxyUrl.value.trim(),
    geminiApiKey: geminiKey.value.trim(),
    grokApiKey: grokKey.value.trim(),
  };
  await chrome.storage.local.set({ settings });
  status.textContent = "Settings saved on this device.";
  status.style.color = "#067647";
  window.setTimeout(() => (status.textContent = ""), 3000);
});
