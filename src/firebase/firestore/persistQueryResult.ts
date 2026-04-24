// Per-query persistence helper shared by ProcessQueriesButton (user-triggered)
// and /api/cron/process-scheduled (scheduled). Keeps the write pipeline in
// one place so scheduled runs and manual runs persist identically.
//
// Writes to:
//   - v8detailed_query_results  (per-query detailed blob)
//   - v8userbrands/{id}.queryProcessingResults  (brand doc array)
//   - v8_user_brand_analytics   (per-session rollup)
// Does NOT refresh the lifetime snapshot — call refreshLifetimeSnapshot()
// once per batch after all queries finish.

import { updateBrandWithQueryResults } from './getUserBrands';
import { saveDetailedQueryResults } from './detailedQueryResults';
import {
  calculateCumulativeAnalytics,
  saveBrandAnalytics,
  calculateLifetimeBrandAnalytics,
  saveLifetimeAnalytics,
} from './brandAnalytics';

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
  userCredits?: {
    before?: number;
    after?: number;
    deducted?: number;
  };
  totalCost?: number;
}

export interface PersistQueryResultArgs {
  brandId: string;
  userId: string;
  companyName: string;
  brandDomain: string;
  query: QueryProcessingInput;
  processingSessionId: string;
  processingSessionTimestamp: string; // ISO
  userQueryResponse: UserQueryApiResponse;
  allPriorResults: any[];
}

// Build the canonical QueryProcessingResult shape from a /api/user-query
// response. Mirrors the transform in ProcessQueriesButton so persisted records
// from either caller look identical.
export function buildQueryResult(args: PersistQueryResultArgs): any {
  const {
    query,
    processingSessionId,
    processingSessionTimestamp,
    userQueryResponse,
  } = args;

  const queryResult: any = {
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
        aiOverview: r.data?.aiOverview || null,
        aiOverviewReferencesCount: r.data?.aiOverviewReferences?.length || 0,
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
      };
    }
  }

  if (userQueryResponse?.userCredits) {
    queryResult.creditInfo = {
      creditsDeducted: userQueryResponse.userCredits.deducted || 10,
      creditsAfter: userQueryResponse.userCredits.after,
      totalCost: userQueryResponse.totalCost,
    };
  }

  return queryResult;
}

// Persist one query across the three per-session collections. Returns the
// built queryResult and the updated accumulator so callers can feed it back
// on the next call.
export async function persistOneQueryResult(
  args: PersistQueryResultArgs
): Promise<{ queryResult: any; updatedAllResults: any[] }> {
  const queryResult = buildQueryResult(args);
  const updatedAllResults = [...args.allPriorResults, queryResult];

  try {
    await saveDetailedQueryResults(
      args.brandId,
      args.userId,
      args.companyName,
      [queryResult]
    );
  } catch (e) {
    console.error('❌ persistOneQueryResult: saveDetailedQueryResults failed', e);
    // Continue — brand-doc write is more critical.
  }

  try {
    await updateBrandWithQueryResults(args.brandId, updatedAllResults);
  } catch (e) {
    console.error('❌ persistOneQueryResult: updateBrandWithQueryResults failed', e);
    throw e;
  }

  try {
    const analyticsData = calculateCumulativeAnalytics(
      args.userId,
      args.brandId,
      args.companyName,
      args.brandDomain,
      args.processingSessionId,
      args.processingSessionTimestamp,
      updatedAllResults
    );
    await saveBrandAnalytics(analyticsData);
  } catch (e) {
    console.error('❌ persistOneQueryResult: saveBrandAnalytics failed (non-fatal)', e);
    // Analytics errors don't block the main flow.
  }

  return { queryResult, updatedAllResults };
}

// Recompute and save the lifetime snapshot for a brand. Call once per batch
// after all queries have been persisted. This keeps the Overview page's
// Lifetime tab in sync with reality after both manual and scheduled runs.
export async function refreshLifetimeSnapshot(
  brandId: string,
  userId: string
): Promise<{ success: boolean; error?: any }> {
  try {
    const { result, error } = await calculateLifetimeBrandAnalytics(brandId, userId);
    if (error) {
      console.error('❌ refreshLifetimeSnapshot: calculate failed', error);
      return { success: false, error };
    }
    if (!result) return { success: true };

    const { success, error: saveError } = await saveLifetimeAnalytics(result);
    if (!success) {
      console.error('❌ refreshLifetimeSnapshot: save failed', saveError);
      return { success: false, error: saveError };
    }
    return { success: true };
  } catch (e) {
    console.error('❌ refreshLifetimeSnapshot threw', e);
    return { success: false, error: e };
  }
}
