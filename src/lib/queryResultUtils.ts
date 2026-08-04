// Canonical stored query-result shape shared by persistence, analytics, and
// legacy adapters. Keep this file Firebase-free so both client and server code
// can import it without dragging storage / auth dependencies along.

export interface BaseStoredProviderResult {
  response: string;
  error?: string;
  timestamp: string;
  responseTime?: number;
  tokenCount?: any;
  /** Canonical provider citations. Present on newly persisted results. */
  citationData?: StoredCitation[];
}

export interface StoredCitation {
  url: string;
  text: string;
  source?: string;
  type?: string;
}

export interface ChatGPTStoredResult extends BaseStoredProviderResult {
  webSearchUsed?: boolean;
  citations?: number;
}

export interface GoogleAIStoredResult extends BaseStoredProviderResult {
  totalItems?: number;
  organicResults?: number;
  peopleAlsoAsk?: number;
  location?: string;
  aiOverview?: string;
  aiOverviewReferencesCount?: number;
  hasAIOverview?: boolean;
  serpFeaturesCount?: number;
  relatedSearchesCount?: number;
  videoResultsCount?: number;
  hasRawData?: boolean;
}

export interface PerplexityStoredResult extends BaseStoredProviderResult {
  citations?: number;
  realTimeData?: boolean;
  citationsData?: string;
  searchResultsData?: string;
  structuredCitationsData?: string;
  citationsCount?: number;
  searchResultsCount?: number;
  structuredCitationsCount?: number;
  hasMetadata?: boolean;
  hasUsageStats?: boolean;
}

// Legacy field retained for backwards compatibility with historical documents.
export interface GeminiStoredResult extends BaseStoredProviderResult {}

export interface StoredQueryResults {
  chatgpt?: ChatGPTStoredResult;
  googleAI?: GoogleAIStoredResult;
  gemini?: GeminiStoredResult;
  perplexity?: PerplexityStoredResult;
}

export interface QueryProcessingResult {
  date: string;
  processingSessionId: string;
  processingSessionTimestamp: string;
  results: StoredQueryResults;
  query: string;
  keyword: string;
  category: string;
}

export interface QueryProcessingInput {
  query: string;
  keyword?: string;
  category?: string;
}

export interface UserQueryApiResponse {
  success?: boolean;
  results?: Array<{
    providerId: string;
    status?: 'success' | 'error';
    data?: any;
    error?: string;
    responseTime?: number;
    timestamp?: string;
  }>;
  totalCost?: number;
}

export interface BuildQueryResultArgs {
  query: QueryProcessingInput;
  processingSessionId: string;
  processingSessionTimestamp: string;
  userQueryResponse: UserQueryApiResponse;
}

export interface QueryIdentitySource {
  query?: string;
  keyword?: string;
  category?: string;
}

function normalizeIdentityPart(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

// Stable identity for a tracked query definition and its persisted results.
// Intentionally excludes processingSessionId so all re-runs of the same tracked
// query collapse onto one UI identity.
export function buildTrackedQueryIdentity(source: QueryIdentitySource): string {
  return [
    normalizeIdentityPart(source.query, ''),
    normalizeIdentityPart(source.keyword, 'unknown'),
    normalizeIdentityPart(source.category, 'unknown'),
  ].map((part) => `${part.length}:${part}`).join('');
}

export function getCanonicalGoogleResult(
  results?: StoredQueryResults
): GoogleAIStoredResult | GeminiStoredResult | undefined {
  return results?.googleAI ?? results?.gemini;
}

export function getGoogleResultText(
  result?: GoogleAIStoredResult | GeminiStoredResult
): string {
  if (!result) return '';

  if ('aiOverview' in result && typeof result.aiOverview === 'string' && result.aiOverview.length > 0) {
    return result.aiOverview;
  }

  return result.response || '';
}

/**
 * Return the structured citation list stored with a provider response.
 * `undefined` means this is a historical row and callers may use their legacy
 * text extractor. An empty array is authoritative: the provider returned no
 * citations and text must not be reinterpreted as citation data.
 */
export function getStoredCitations(
  result?: BaseStoredProviderResult
): StoredCitation[] | undefined {
  return Array.isArray(result?.citationData) ? result.citationData : undefined;
}

function normalizeStoredCitations(value: unknown): StoredCitation[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const citations: StoredCitation[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const raw = candidate as Record<string, unknown>;
    if (typeof raw.url !== 'string') continue;

    let url: URL;
    try {
      url = new URL(raw.url);
    } catch {
      continue;
    }
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
    ) continue;

    const canonicalUrl = url.toString();
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);

    const sourceProvider = typeof raw.sourceProvider === 'string'
      ? raw.sourceProvider
      : undefined;
    const rawKind = typeof raw.rawKind === 'string' ? raw.rawKind : undefined;
    citations.push({
      url: canonicalUrl,
      text:
        (typeof raw.title === 'string' && raw.title.trim())
        || (typeof raw.domain === 'string' && raw.domain.trim())
        || url.hostname,
      source: sourceProvider,
      type: rawKind,
    });
  }
  return citations;
}

export function hasProviderContent(
  providerResult:
    | {
        response?: string;
        error?: string;
        aiOverview?: string;
        hasContent?: boolean;
      }
    | undefined
): boolean {
  if (!providerResult || providerResult.error) return false;

  return (
    (typeof providerResult.response === 'string' && providerResult.response.length > 0) ||
    (typeof providerResult.aiOverview === 'string' && providerResult.aiOverview.length > 0) ||
    providerResult.hasContent === true
  );
}

export function hasSuccessfulProviderResult(
  result: Pick<QueryProcessingResult, 'results'> | undefined
): boolean {
  if (!result?.results) return false;

  const providers = [
    result.results.chatgpt,
    getCanonicalGoogleResult(result.results),
    result.results.perplexity,
  ];

  return providers.some((providerResult) => {
    return hasProviderContent(providerResult);
  });
}

// Build the canonical QueryProcessingResult shape from a /api/user-query
// response. This keeps every caller on the same provider/result contract.
export function buildQueryResult(args: BuildQueryResultArgs): QueryProcessingResult {
  const {
    query,
    processingSessionId,
    processingSessionTimestamp,
    userQueryResponse,
  } = args;

  const queryResult: QueryProcessingResult = {
    date: new Date().toISOString(),
    processingSessionId,
    processingSessionTimestamp,
    query: query.query,
    keyword: query.keyword ?? 'unknown',
    category: query.category ?? 'unknown',
    results: {},
  };

  const results = userQueryResponse?.results ?? [];
  for (const r of results) {
    if (r.providerId === 'chatgptsearch') {
      queryResult.results.chatgpt = {
        response: r.data?.content || '',
        ...(r.error && { error: r.error }),
        timestamp: r.timestamp || new Date().toISOString(),
        responseTime: r.responseTime,
        webSearchUsed: r.data?.webSearchUsed || false,
        citations: r.data?.annotations?.length || 0,
        citationData: normalizeStoredCitations(r.data?.normalizedCitations),
      };
    } else if (r.providerId === 'google-ai-overview') {
      queryResult.results.googleAI = {
        response: `Found ${r.data?.totalItems || 0} search results`,
        ...(r.error && { error: r.error }),
        timestamp: r.timestamp || new Date().toISOString(),
        responseTime: r.responseTime,
        totalItems: r.data?.totalItems || 0,
        organicResults: r.data?.organicResultsCount || 0,
        peopleAlsoAsk: r.data?.peopleAlsoAskCount || 0,
        location: r.data?.location || 'Unknown',
        aiOverview: r.data?.aiOverview || undefined,
        aiOverviewReferencesCount: r.data?.aiOverviewReferences?.length || 0,
        citationData: normalizeStoredCitations(r.data?.normalizedCitations),
        hasAIOverview: r.data?.hasAIOverview || false,
        serpFeaturesCount: r.data?.serpFeatures?.length || 0,
        relatedSearchesCount: r.data?.relatedSearches?.length || 0,
        videoResultsCount: r.data?.videoResults?.length || 0,
        hasRawData: !!(r.data?.rawDataForSEOResponse),
      };
    } else if (r.providerId === 'perplexity') {
      queryResult.results.perplexity = {
        response: r.data?.content || '',
        ...(r.error && { error: r.error }),
        timestamp: r.timestamp || new Date().toISOString(),
        responseTime: r.responseTime,
        citations: r.data?.citations?.length || 0,
        realTimeData: r.data?.realTimeData || false,
        citationsData: r.data?.citations ? r.data.citations.join('|||') : '',
        searchResultsData: r.data?.searchResults
          ? r.data.searchResults.map((s: any) => `${s.title || ''}|||${s.url || ''}`).join('###')
          : '',
        structuredCitationsData: r.data?.structuredCitations
          ? r.data.structuredCitations.join('|||')
          : '',
        citationsCount: r.data?.citations?.length || 0,
        searchResultsCount: r.data?.searchResults?.length || 0,
        structuredCitationsCount: r.data?.structuredCitations?.length || 0,
        hasMetadata: !!(r.data?.metadata),
        hasUsageStats: !!(r.data?.usage),
        citationData: normalizeStoredCitations(r.data?.normalizedCitations),
      };
    }
  }

  return queryResult;
}

// Normalize historical `aiResponses` rows into the current stored result
// contract. Older rows used provider ids like `openai` / `gemini`.
export function normalizeLegacyAiResponses(
  aiResponses: Array<any> | undefined,
  fallbackTimestamp: string
): StoredQueryResults {
  const results: StoredQueryResults = {};

  for (const response of aiResponses ?? []) {
    const provider = String(response?.provider || '').toLowerCase();
    const timestamp = response?.timestamp || fallbackTimestamp;

    if (provider.includes('openai') || provider.includes('chatgpt')) {
      results.chatgpt = {
        response: response?.response || '',
        error: response?.error,
        timestamp,
        responseTime: response?.responseTime,
      };
      continue;
    }

    if (provider.includes('gemini') || provider.includes('google')) {
      results.googleAI = {
        response: response?.response || '',
        error: response?.error,
        timestamp,
        responseTime: response?.responseTime,
        aiOverview: response?.response || undefined,
        hasAIOverview: !!response?.response,
      };
      continue;
    }

    if (provider.includes('perplexity')) {
      results.perplexity = {
        response: response?.response || '',
        error: response?.error,
        timestamp,
        responseTime: response?.responseTime,
      };
    }
  }

  return results;
}
