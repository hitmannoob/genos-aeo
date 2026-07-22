import type {
  ChatGPTStoredResult,
  GoogleAIStoredResult,
  PerplexityStoredResult,
} from '@/lib/queryResultUtils';
import { getGoogleResultText, getStoredCitations } from '@/lib/queryResultUtils';
import type { Citation } from './types';
import { extractChatGPTCitations } from './chatgpt';
import { extractGoogleAIOverviewCitations } from './googleAIOverview';
import { extractPerplexityCitations } from './perplexity';

/**
 * Prefer structured provider citations. Text extraction is retained only for
 * results saved before `citationData` was introduced.
 */
export function citationsForChatGPT(result?: ChatGPTStoredResult): Citation[] {
  if (!result) return [];
  return getStoredCitations(result) ?? extractChatGPTCitations(result.response || '');
}

export function citationsForGoogle(result?: GoogleAIStoredResult): Citation[] {
  if (!result) return [];
  const stored = getStoredCitations(result);
  if (stored) return stored;
  const overview = getGoogleResultText(result);
  return extractGoogleAIOverviewCitations(overview, {
    ...result,
    aiOverview: overview,
  });
}

export function citationsForPerplexity(result?: PerplexityStoredResult): Citation[] {
  if (!result) return [];
  return getStoredCitations(result)
    ?? extractPerplexityCitations(result.response || '', result);
}
