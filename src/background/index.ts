import type { ScanSummary, ToBackground } from '../shared/types';
import { runScan } from './pipeline';

// All network I/O happens here. Returning true keeps the channel open for the async response.
chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
  if (msg?.type === 'SCAN_REQUEST' && sender.tab?.id != null) {
    runScan(sender.tab.id, msg.payload).then(sendResponse, (e): void =>
      sendResponse({ ok: false, claimsFound: 0, flagged: 0, error: String(e?.message ?? e) } satisfies ScanSummary));
    return true;
  }
  return false;
});
