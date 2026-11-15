const blockedHosts = [
  /(^|\.)mail\.google\.com$/i,
  /(^|\.)outlook\.live\.com$/i,
  /(^|\.)bank\.[a-z0-9.-]+$/i,
];
const blockedPaths = /\/(login|checkout|account)(\/|$)/i;
const sensitiveSelectors =
  'input[type="password"], input[type="email"], input[autocomplete*="cc-"], input[autocomplete*="password"]';

export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      !["http:", "https:", "file:"].includes(parsed.protocol) ||
      blockedHosts.some((pattern) => pattern.test(parsed.hostname)) ||
      blockedPaths.test(parsed.pathname)
    );
  } catch {
    return true;
  }
}

export function isSensitiveElement(element: Element): boolean {
  return element.closest(sensitiveSelectors) !== null;
}
