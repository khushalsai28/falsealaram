import type { Source } from '../shared/types';
import {
  defaultProviders,
  tryProvidersInOrder,
  type DefaultProviderOptions,
  type SourceProvider,
  ProviderError,
} from '../lib/providers';

export { defaultProviders, tryProvidersInOrder, type DefaultProviderOptions, type SourceProvider, ProviderError };

/**
 * Compatibility adapter for v2 Scan mode and the proxy's legacy /sources
 * endpoint. The v3 chain deliberately starts with Wikipedia and never
 * scrapes Google Scholar from the extension. `scholar` is accepted only so
 * existing option values and callers do not break during migration.
 */
export async function searchSources(
  keywords: string[],
  options: { scholar?: boolean; openAlexKey?: string; limit?: number },
): Promise<Source[]> {
  const query = [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))].join(' ');
  if (!query) return [];
  const providers = defaultProviders({ openAlexKey: options.openAlexKey });
  return tryProvidersInOrder(providers, query, Math.max(1, Math.min(Number(options.limit) || 3, 3)));
}
