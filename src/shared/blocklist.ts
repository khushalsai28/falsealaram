export const DEFAULT_BLOCKLIST = [
  'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com',
  'accounts.google.com', 'login.microsoftonline.com', 'paypal.com', 'venmo.com', 'chase.com',
  'bankofamerica.com', 'wellsfargo.com', 'capitalone.com', 'citi.com', 'schwab.com', 'fidelity.com',
];
const SENSITIVE_PATH = /\/(log-?in|sign-?in|checkout|payment|billing|banking|password)\b/i;

export function isBlockedUrl(url: string, list: string[]): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (/(^|[.-])bank/.test(h)) return true;
    if (list.some((d) => h === d || h.endsWith('.' + d))) return true;
    return SENSITIVE_PATH.test(u.pathname);
  } catch { return true; } // unparseable -> be safe
}
