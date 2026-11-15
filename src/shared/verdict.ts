import type { Verdict } from './types';

export interface VerdictCopy {
  key: Verdict;
  /** Short label used in compact badges and list rows. */
  label: string;
  /** Plain-language finding; deliberately avoids overstating uncertain evidence. */
  finding: string;
  /** Label for the explanatory or corrective detail beneath a claim. */
  detailLabel: string;
}

/** Turn the four evidence-based verdicts into language readers can act on. */
export function verdictCopy(value: unknown): VerdictCopy {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  switch (normalized) {
    case 'supported':
      return { key: 'supported', label: 'Supported', finding: 'Likely true', detailLabel: 'Evidence summary' };
    case 'contradicted':
    case 'false':
      return { key: 'contradicted', label: 'Contradicted', finding: 'Likely false', detailLabel: 'Contradiction / correction' };
    case 'partially_supported':
      return { key: 'partially_supported', label: 'Needs context', finding: 'Partly true', detailLabel: 'Context / correction' };
    default:
      return { key: 'insufficient_evidence', label: 'Not enough evidence', finding: 'Unverified', detailLabel: 'What we found' };
  }
}

export function verdictDisplay(value: unknown): string {
  const copy = verdictCopy(value);
  return `${copy.label} · ${copy.finding}`;
}
