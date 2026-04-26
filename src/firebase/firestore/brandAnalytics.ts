import firebase_app from "../config";
import { getFirestore, collection, doc, setDoc, getDoc, serverTimestamp, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { analyzeBrandMentions } from '@/lib/brand-mentions';
import { extractChatGPTCitations } from '@/lib/citations/chatgpt';
import { extractGoogleAIOverviewCitations } from '@/lib/citations/googleAIOverview';
import { extractPerplexityCitations } from '@/lib/citations/perplexity';
import { loadBrandQueryCorpus } from './brandQueryCorpus';
import { matchesWord } from '@/lib/competitor-matching';
import { toIsoString } from './timestamps';
import {
  buildTrackedQueryIdentity,
  getCanonicalGoogleResult,
  getGoogleResultText,
  type QueryProcessingResult,
} from './queryResultUtils';

// Get the Firestore instance
const db = getFirestore(firebase_app);

// Interface for brand analytics data
export interface BrandAnalyticsData {
  id?: string;
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  
  // Processing session information
  processingSessionId: string;
  processingSessionTimestamp: string;
  totalQueriesProcessed: number;
  
  // Cumulative metrics across all queries in this session
  totalBrandMentions: number;
  brandVisibilityScore: number; // Calculated as (providers with brand mentions / total providers) across all queries
  totalCitations: number;
  totalDomainCitations: number;
  
  // Provider-specific aggregated data
  providerStats: {
    chatgpt: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    google: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    perplexity: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
  };
  
  // Additional insights
  insights: {
    topPerformingProvider: string; // Provider(s) with best performance (brand mentions -> domain citations ratio -> total citations)
    topProviders: string[]; // Array of top performing providers (useful for ties)
    brandVisibilityTrend: 'improving' | 'declining' | 'stable';
    /**
     * Average brand mentions per AI response (i.e. totalBrandMentions / totalProviders).
     * Matches the "response" unit used by brandVisibilityScore: if N providers each return a
     * response and the brand is mentioned in M responses, the brand mention density across
     * responses is M/N. Prefer this field over averageBrandMentionsPerQuery.
     */
    averageBrandMentionsPerResponse: number;
    /** Average citations per AI response (totalCitations / totalProviders). */
    averageCitationsPerResponse: number;
    /**
     * @deprecated Use averageBrandMentionsPerResponse. This field is the per-query
     * aggregate summed across providers and mixes provider and query units, which
     * is confusing. Retained for backwards compatibility with persisted documents.
     */
    averageBrandMentionsPerQuery: number;
    /**
     * @deprecated Use averageCitationsPerResponse. See averageBrandMentionsPerQuery.
     */
    averageCitationsPerQuery: number;
    competitorMentionsDetected: number; // Future feature
    providerRankingDetails?: {
      [provider: string]: {
        rank: number;
        brandMentions: number;
        domainCitationsRatio: number;
        totalCitations: number;
      };
    };
  };

  // Timestamps
  lastUpdated: any;
  createdAt: any;
}

// Interface for individual citation data in lifetime analytics
export interface LifetimeCitation {
  id: string;
  url: string;
  text: string;
  source: string;
  provider: 'chatgpt' | 'perplexity' | 'googleAI';
  query: string;
  queryId: string;
  brandName: string;
  domain?: string;
  timestamp: string;
  type?: string;
  isBrandMention?: boolean;
  isDomainCitation?: boolean;
  processingSessionId: string;
}

// Interface for lifetime analytics data (aggregated across all historical queries)
export interface LifetimeBrandAnalytics {
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  
  // Lifetime aggregated metrics
  totalQueriesProcessed: number;
  totalProcessingSessions: number;
  totalBrandMentions: number;
  brandVisibilityScore: number;
  totalCitations: number;
  totalDomainCitations: number;
  
  // Individual citation data for detailed analysis
  allCitations: LifetimeCitation[];

  // Daily trend series derived from the same lifetime query corpus used for
  // the aggregate metrics above.
  trendData?: Array<{
    date: string;
    brandMentions: number;
    citations: number;
  }>;
  
  // Provider-specific lifetime data
  providerStats: {
    chatgpt: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    google: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    perplexity: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
  };
  
  // Lifetime insights
  insights: {
    topPerformingProvider: string;
    topProviders: string[];
    /** Average brand mentions per AI response. See BrandAnalyticsData for details. */
    averageBrandMentionsPerResponse: number;
    /** Average citations per AI response. */
    averageCitationsPerResponse: number;
    /** @deprecated Use averageBrandMentionsPerResponse. */
    averageBrandMentionsPerQuery: number;
    /** @deprecated Use averageCitationsPerResponse. */
    averageCitationsPerQuery: number;
    firstQueryProcessed?: string;
    lastQueryProcessed?: string;
    providerRankingDetails?: {
      [provider: string]: {
        rank: number;
        brandMentions: number;
        domainCitationsRatio: number;
        totalCitations: number;
      };
    };
  };
  
  // Timestamps
  calculatedAt: any;

  // Set when Cloud Storage retrieval failed and analytics fell back to the
  // truncated Firestore copy (~50 queries). Callers should surface a warning
  // so users don't act on silently-incomplete numbers.
  dataTruncated?: boolean;
}

// Interface for historical analytics summary
export interface BrandAnalyticsHistory {
  brandId: string;
  totalSessions: number;
  latestAnalytics: BrandAnalyticsData;
  previousAnalytics?: BrandAnalyticsData;
  trend: {
    brandMentionsChange: number;
    citationsChange: number;
    visibilityChange: number;
  };
}

const ANALYTICS_SESSION_READ_LIMIT = 25;

function dedupeAnalyticsSessions(
  analytics: BrandAnalyticsData[],
  maxSessions?: number
): BrandAnalyticsData[] {
  const deduped: BrandAnalyticsData[] = [];
  const seen = new Set<string>();

  for (const item of analytics) {
    const key = `${item.brandId}::${item.processingSessionId || item.id || 'unknown'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);

    if (maxSessions !== undefined && deduped.length >= maxSessions) {
      break;
    }
  }

  return deduped;
}

function buildLifetimeTrendData(
  queryResults: QueryProcessingResult[],
  brandName: string,
  brandDomain: string
): Array<{ date: string; brandMentions: number; citations: number }> {
  const byDay: Record<string, { date: string; brandMentions: number; citations: number }> = {};

  queryResults.forEach((queryResult) => {
    const day = queryResult.date
      ? new Date(queryResult.date).toISOString().slice(0, 10)
      : 'Unknown';

    const chatgptCitations = queryResult.results?.chatgpt
      ? extractChatGPTCitations(queryResult.results.chatgpt.response || '')
      : [];

    const canonicalGoogleResult = getCanonicalGoogleResult(queryResult.results);
    const googleResult = canonicalGoogleResult
      ? {
          ...canonicalGoogleResult,
          aiOverview: getGoogleResultText(canonicalGoogleResult),
        }
      : undefined;
    const googleCitations = googleResult
      ? extractGoogleAIOverviewCitations(googleResult.aiOverview || '', googleResult)
      : [];

    const perplexityCitations = queryResult.results?.perplexity
      ? extractPerplexityCitations(
          queryResult.results.perplexity.response || '',
          queryResult.results.perplexity
        )
      : [];

    const analysis = analyzeBrandMentions(
      brandName,
      brandDomain,
      {
        chatgpt: queryResult.results?.chatgpt
          ? {
              response: queryResult.results.chatgpt.response || '',
              citations: chatgptCitations,
            }
          : undefined,
        googleAI: googleResult
          ? {
              aiOverview: googleResult.aiOverview || '',
              citations: googleCitations,
            }
          : undefined,
        perplexity: queryResult.results?.perplexity
          ? {
              response: queryResult.results.perplexity.response || '',
              citations: perplexityCitations,
            }
          : undefined,
      },
      []
    );

    if (!byDay[day]) {
      byDay[day] = { date: day, brandMentions: 0, citations: 0 };
    }

    byDay[day].brandMentions += analysis.totals.totalBrandMentions;
    byDay[day].citations += analysis.totals.totalCitations;
  });

  return Object.values(byDay).sort((left, right) => left.date.localeCompare(right.date));
}

// Calculate cumulative analytics from query processing results
export function calculateCumulativeAnalytics(
  userId: string,
  brandId: string,
  brandName: string,
  brandDomain: string,
  processingSessionId: string,
  processingSessionTimestamp: string,
  queryResults: any[]
): BrandAnalyticsData {
  
  const providerStats = {
    chatgpt: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0, totalResponseTime: 0 },
    google: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0, totalResponseTime: 0 },
    perplexity: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0, totalResponseTime: 0 }
  };

  let totalBrandMentions = 0;
  let totalCitations = 0;
  let totalDomainCitations = 0;
  let totalProvidersWithBrandMentions = 0;
  let totalProviders = 0;

  // Process each query result
  queryResults.forEach(queryResult => {
    const canonicalGoogleResult = getCanonicalGoogleResult(queryResult.results);
    const googleOverview = getGoogleResultText(canonicalGoogleResult);

    // Extract citations for each provider
    const chatgptCitations = queryResult.results?.chatgpt ? 
      extractChatGPTCitations(queryResult.results.chatgpt.response || '') : [];
    const googleCitations = canonicalGoogleResult
      ? extractGoogleAIOverviewCitations(googleOverview, {
          ...canonicalGoogleResult,
          aiOverview: googleOverview,
        })
      : [];
    const perplexityCitations = queryResult.results?.perplexity ? 
      extractPerplexityCitations(queryResult.results.perplexity.response || '', queryResult.results.perplexity) : [];

    // Analyze brand mentions for this query
    const analysis = analyzeBrandMentions(brandName, brandDomain, {
      chatgpt: queryResult.results?.chatgpt ? {
        response: queryResult.results.chatgpt.response || '',
        citations: chatgptCitations
      } : undefined,
      googleAI: canonicalGoogleResult ? {
        aiOverview: googleOverview,
        citations: googleCitations
      } : undefined,
      perplexity: queryResult.results?.perplexity ? {
        response: queryResult.results.perplexity.response || '',
        citations: perplexityCitations
      } : undefined
    });

    // Accumulate totals
    totalBrandMentions += analysis.totals.totalBrandMentions;
    totalCitations += analysis.totals.totalCitations;
    totalDomainCitations += analysis.totals.totalDomainCitations;
    totalProvidersWithBrandMentions += analysis.totals.providersWithBrandMention;
    totalProviders += Object.keys(analysis.results).length;

    // Update provider-specific stats
    Object.entries(analysis.results).forEach(([providerKey, result]) => {
      if (result) {
        const provider = providerKey as keyof typeof providerStats;
        providerStats[provider].queriesProcessed++;
        providerStats[provider].brandMentions += result.brandMentionCount;
        providerStats[provider].citations += result.citationCount;
        providerStats[provider].domainCitations += result.domainCitationCount;
        
        // Add response time if available
        const responseTime = provider === 'google'
          ? canonicalGoogleResult?.responseTime
          : queryResult.results?.[provider]?.responseTime;
        if (responseTime) {
          providerStats[provider].totalResponseTime += responseTime;
        }
      }
    });
  });

  // Calculate averages and insights
  const brandVisibilityScore = totalProviders > 0 ? (totalProvidersWithBrandMentions / totalProviders) * 100 : 0;
  // Per-response averages: totalBrandMentions and totalCitations are summed
  // across all returning provider responses, so dividing by totalProviders gives
  // a per-response figure that matches the "response" unit in brandVisibilityScore.
  const averageBrandMentionsPerResponse = totalProviders > 0 ? totalBrandMentions / totalProviders : 0;
  const averageCitationsPerResponse = totalProviders > 0 ? totalCitations / totalProviders : 0;
  // Legacy per-query aggregate (summed across providers for each query); retained
  // for backwards compatibility only — new readers should use the per-response fields.
  const averageBrandMentionsPerQuery = queryResults.length > 0 ? totalBrandMentions / queryResults.length : 0;
  const averageCitationsPerQuery = queryResults.length > 0 ? totalCitations / queryResults.length : 0;

  // Determine top performing provider with sophisticated ranking
  let topPerformingProvider = 'none';
  let topProviders: string[] = [];
  
  // Check if there's any meaningful brand performance to measure
  const hasBrandPerformance = totalBrandMentions > 0 || totalDomainCitations > 0;
  
  if (!hasBrandPerformance) {
    // No brand mentions or domain citations - no meaningful performance to rank
    topPerformingProvider = 'none';
    topProviders = [];
  } else {
    // Create array of providers with their performance metrics
    const providerRankings = Object.entries(providerStats)
      .filter(([_, stats]) => stats.queriesProcessed > 0) // Only consider providers that processed queries
      .map(([provider, stats]) => ({
        provider,
        brandMentions: stats.brandMentions,
        domainCitationsRatio: stats.citations > 0 ? stats.domainCitations / stats.citations : 0,
        totalCitations: stats.citations,
        domainCitations: stats.domainCitations
      }));

    if (providerRankings.length === 0) {
      topPerformingProvider = 'none';
      topProviders = [];
    } else {
      // Sort by: 1) Brand mentions (desc), 2) Domain citations ratio (desc), 3) Total citations (desc)
      providerRankings.sort((a, b) => {
        // Primary: Brand mentions
        if (a.brandMentions !== b.brandMentions) {
          return b.brandMentions - a.brandMentions;
        }
        
        // Secondary: Domain citations ratio
        if (Math.abs(a.domainCitationsRatio - b.domainCitationsRatio) > 0.001) { // Use small epsilon for float comparison
          return b.domainCitationsRatio - a.domainCitationsRatio;
        }
        
        // Tertiary: Total citations
        return b.totalCitations - a.totalCitations;
      });

      const topProvider = providerRankings[0];
      
      // Additional check: Top provider must have at least 1 brand mention OR domain citation
      const topProviderHasPerformance = topProvider.brandMentions > 0 || topProvider.domainCitations > 0;
      
      if (!topProviderHasPerformance) {
        topPerformingProvider = 'none';
        topProviders = [];
      } else {
        // Check for ties - find all providers with same brand mentions and domain citations ratio
        const tiedProviders = providerRankings.filter(p => 
          p.brandMentions === topProvider.brandMentions && 
          Math.abs(p.domainCitationsRatio - topProvider.domainCitationsRatio) < 0.001 &&
          (p.brandMentions > 0 || p.domainCitations > 0) // Only include providers with actual performance
        );

        if (tiedProviders.length > 1) {
          // Multiple providers tied - show all of them
          topPerformingProvider = tiedProviders.map(p => p.provider).join(' & ');
          topProviders = tiedProviders.map(p => p.provider);
        } else {
          // Single top performer
          topPerformingProvider = topProvider.provider;
          topProviders = [topProvider.provider];
        }
      }
    }
  }

  // Calculate average response times (Firebase doesn't allow undefined values)
  const finalProviderStats = {
    chatgpt: {
      ...providerStats.chatgpt,
      ...(providerStats.chatgpt.queriesProcessed > 0 && {
        averageResponseTime: providerStats.chatgpt.totalResponseTime / providerStats.chatgpt.queriesProcessed
      })
    },
    google: {
      ...providerStats.google,
      ...(providerStats.google.queriesProcessed > 0 && {
        averageResponseTime: providerStats.google.totalResponseTime / providerStats.google.queriesProcessed
      })
    },
    perplexity: {
      ...providerStats.perplexity,
      ...(providerStats.perplexity.queriesProcessed > 0 && {
        averageResponseTime: providerStats.perplexity.totalResponseTime / providerStats.perplexity.queriesProcessed
      })
    }
  };

  // Remove totalResponseTime from final stats
  Object.values(finalProviderStats).forEach(stats => {
    delete (stats as any).totalResponseTime;
  });

  // Create provider ranking details for insights
  const providerRankingDetails: { [provider: string]: { rank: number; brandMentions: number; domainCitationsRatio: number; totalCitations: number; } } = {};
  const providerRankings = Object.entries(providerStats)
    .filter(([_, stats]) => stats.queriesProcessed > 0)
    .map(([provider, stats]) => ({
      provider,
      brandMentions: stats.brandMentions,
      domainCitationsRatio: stats.citations > 0 ? stats.domainCitations / stats.citations : 0,
      totalCitations: stats.citations,
      domainCitations: stats.domainCitations
    }))
    .sort((a, b) => {
      if (a.brandMentions !== b.brandMentions) return b.brandMentions - a.brandMentions;
      if (Math.abs(a.domainCitationsRatio - b.domainCitationsRatio) > 0.001) return b.domainCitationsRatio - a.domainCitationsRatio;
      return b.totalCitations - a.totalCitations;
    });
    
  providerRankings.forEach((ranking, index) => {
    providerRankingDetails[ranking.provider] = {
      rank: index + 1,
      brandMentions: ranking.brandMentions,
      domainCitationsRatio: Math.round(ranking.domainCitationsRatio * 10000) / 100, // Convert to percentage with 2 decimal places
      totalCitations: ranking.totalCitations
    };
  });

  return {
    userId,
    brandId,
    brandName,
    brandDomain,
    processingSessionId,
    processingSessionTimestamp,
    totalQueriesProcessed: queryResults.length,
    totalBrandMentions,
    brandVisibilityScore: Math.round(brandVisibilityScore * 100) / 100, // Round to 2 decimal places
    totalCitations,
    totalDomainCitations,
    providerStats: finalProviderStats,
    insights: {
      topPerformingProvider,
      topProviders,
      brandVisibilityTrend: 'stable', // Will be calculated by comparing with previous data
      averageBrandMentionsPerResponse: Math.round(averageBrandMentionsPerResponse * 100) / 100,
      averageCitationsPerResponse: Math.round(averageCitationsPerResponse * 100) / 100,
      averageBrandMentionsPerQuery: Math.round(averageBrandMentionsPerQuery * 100) / 100,
      averageCitationsPerQuery: Math.round(averageCitationsPerQuery * 100) / 100,
      competitorMentionsDetected: 0, // Future feature
      providerRankingDetails
    },
    lastUpdated: serverTimestamp(),
    createdAt: serverTimestamp()
  };
}

// Calculate latest session analytics from brand document (unified data source).
// Accepts pre-loaded BrandWithResults to avoid redundant Cloud Storage fetches.
// userId is the authenticated caller's uid — required to verify brand ownership
// so a signed-in user can't read another user's analytics by passing any brandId.
export async function calculateLatestSessionFromBrandDocument(
  brandId: string,
  userId: string,
  preloaded?: { brand: any; dataTruncated: boolean }
): Promise<{ result?: BrandAnalyticsData; error?: any }> {
  try {
    console.log('🔄 Calculating latest session analytics from brand document:', brandId);

    const { result: corpus, error: corpusError } = await loadBrandQueryCorpus(
      brandId,
      userId,
      preloaded
    );

    if (corpusError || !corpus) {
      return { error: corpusError || new Error('Failed to load brand query corpus') };
    }

    const { brand, allResults } = corpus;
    const brandName = brand.companyName;
    const brandDomain = brand.domain;

    if (allResults.length === 0) {
      return { result: undefined };
    }
    
    // Group queries by processing session and find the latest session.
    // Parse timestamps as Date to handle mixed ISO / legacy string formats;
    // string compare alone would mis-order non-ISO timestamps.
    const sessionGroups: { [sessionId: string]: any[] } = {};
    let latestSessionId = '';
    let latestSessionMs = -Infinity;
    let latestSessionTimestamp = '';

    allResults.forEach(query => {
      const sessionId = query.processingSessionId || 'unknown_session';
      const sessionTimestamp = query.processingSessionTimestamp || query.date || '';

      if (!sessionGroups[sessionId]) {
        sessionGroups[sessionId] = [];
      }
      sessionGroups[sessionId].push(query);

      const ms = sessionTimestamp ? new Date(sessionTimestamp).getTime() : NaN;
      if (!Number.isNaN(ms) && ms > latestSessionMs) {
        latestSessionMs = ms;
        latestSessionTimestamp = sessionTimestamp;
        latestSessionId = sessionId;
      }
    });
    
    // Get queries from the latest session only
    const latestSessionQueries = sessionGroups[latestSessionId] || [];
    
    if (latestSessionQueries.length === 0) {
      return { result: undefined };
    }
    
    console.log(`📊 Found latest session: ${latestSessionId} with ${latestSessionQueries.length} queries`);
    
    // Calculate analytics for the latest session only
    const sessionAnalytics = calculateCumulativeAnalytics(
      userId,
      brandId,
      brandName,
      brandDomain,
      latestSessionId,
      latestSessionTimestamp,
      latestSessionQueries
    );
    
    console.log('✅ Latest session analytics calculated:', {
      sessionId: latestSessionId,
      totalQueries: latestSessionQueries.length,
      totalBrandMentions: sessionAnalytics.totalBrandMentions,
      topProvider: sessionAnalytics.insights.topPerformingProvider
    });
    
    return { result: sessionAnalytics };
    
  } catch (error) {
    console.error('❌ Error calculating latest session analytics from brand document:', error);
    return { error };
  }
}

// Calculate lifetime analytics across ALL historical queries for a brand.
// Accepts a pre-loaded BrandWithResults to avoid re-fetching Cloud Storage when
// multiple hooks on one page need the same data.
// userId is the authenticated caller's uid — required to verify brand ownership
// so a signed-in user can't read another user's analytics by passing any brandId.
export async function calculateLifetimeBrandAnalytics(
  brandId: string,
  userId: string,
  preloaded?: { brand: any; dataTruncated: boolean }
): Promise<{ result?: LifetimeBrandAnalytics; error?: any }> {
  try {
    console.log('🔄 Calculating lifetime analytics for brand:', brandId);

    const { result: corpus, error: corpusError } = await loadBrandQueryCorpus(
      brandId,
      userId,
      preloaded
    );

    if (corpusError || !corpus) {
      return { error: corpusError || new Error('Failed to load brand query corpus') };
    }

    const {
      brand,
      dataTruncated,
      currentResults,
      historicalResults,
      allResults,
    } = corpus;

    const brandName = brand.companyName;
    const brandDomain = brand.domain;
    const totalProcessingSessions = new Set(
      allResults
        .map((result) => result.processingSessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0)
    ).size;
    
    console.log(`📊 Analytics data collection summary:`, {
      totalQueries: allResults.length,
      totalSessions: totalProcessingSessions,
      brandDocumentQueries: currentResults.length,
      historicalQueries: historicalResults.length,
      brandId,
      brandName
    });
    
    // Additional diagnostic: Log query source breakdown
    const querySourceBreakdown = allResults.reduce((acc, q) => {
      const isLegacy = q.processingSessionId?.startsWith('legacy_');
      acc[isLegacy ? 'historical' : 'current'] = (acc[isLegacy ? 'historical' : 'current'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('🔍 Query source breakdown:', querySourceBreakdown);
    
    // Analytics debug functionality removed - no longer needed
    // const shouldRunDiagnostics = typeof window !== 'undefined' && 
    //   (localStorage.getItem(`analyticsDebug_${brandId}`) === 'true' || allQueryResults.length <= 50);
    
    // if (shouldRunDiagnostics) {
    //   try {
    //     const { diagnoseAnalyticsIssues, logAnalyticsDiagnostic } = await import('@/utils/analyticsDebug');
    //     const diagnostic = diagnoseAnalyticsIssues(
    //       brandId,
    //       allQueryResults,
    //       !!(brand as any).storageReferences?.queryProcessingResults,
    //       brand.queryProcessingResults && brand.queryProcessingResults.length > (brand as any)._originalFirestoreQueryCount || 0,
    //       undefined // We'd need to pass storage errors from the retry logic above
    //     );
    //     logAnalyticsDiagnostic(diagnostic);
    //   } catch (debugError) {
    //     console.warn('⚠️ Could not run analytics diagnostics:', debugError);
    //   }
    // }
    
    if (allResults.length === 0) {
      // Return empty analytics if no queries found
      return {
        result: {
          userId,
          brandId,
          brandName,
          brandDomain,
          totalQueriesProcessed: 0,
          totalProcessingSessions: 0,
          totalBrandMentions: 0,
          brandVisibilityScore: 0,
          totalCitations: 0,
          totalDomainCitations: 0,
          allCitations: [], // Add required field
          trendData: [],
          providerStats: {
            chatgpt: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 },
            google: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 },
            perplexity: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 }
          },
          insights: {
            topPerformingProvider: 'none',
            topProviders: [],
            averageBrandMentionsPerResponse: 0,
            averageCitationsPerResponse: 0,
            averageBrandMentionsPerQuery: 0,
            averageCitationsPerQuery: 0
          },
          calculatedAt: serverTimestamp(),
          dataTruncated
        }
      };
    }
    
    // Use existing analytics calculation logic but for lifetime data
    const sessionAnalytics = calculateCumulativeAnalytics(
      userId,
      brandId,
      brandName,
      brandDomain,
      'lifetime_analytics',
      new Date().toISOString(),
      allResults
    );
    
    // Find first and last query dates
    const queryDates = allResults
      .map(q => new Date(q.date))
      .filter(date => !isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    
    const firstQueryProcessed = queryDates.length > 0 ? queryDates[0].toISOString() : undefined;
    const lastQueryProcessed = queryDates.length > 0 ? queryDates[queryDates.length - 1].toISOString() : undefined;
    
    // Helper functions for citation extraction
    const extractDomainFromUrl = (url: string): string | undefined => {
      if (!url || !/^https?:\/\//i.test(url)) return undefined;
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return undefined;
      }
    };
    
    // Use non-alphanumeric boundary matching so "Apple" doesn't match inside
    // "pineapple"; matchesWord handles regex escaping for us.
    const checkBrandMention = (text: string, url: string, brandName: string, brandDomain?: string): boolean => {
      if (!brandName || !text) return false;
      return matchesWord(text, brandName);
    };

    // Compare hostnames exactly (after stripping www. and lowercasing) so
    // "apple.com" doesn't get credited for "pineapple.com" or a phishing
    // subdomain like "apple.com.evil.net".
    const checkDomainCitation = (url: string, brandDomain?: string): boolean => {
      if (!brandDomain || !url) return false;
      try {
        const parsed = new URL(url);
        const urlHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const brandHost = brandDomain.toLowerCase().replace(/^www\./, '').trim();
        if (!urlHost || !brandHost) return false;
        return urlHost === brandHost;
      } catch {
        return false;
      }
    };
    
    // Extract all individual citations from historical queries
    console.log('🔍 Extracting individual citations from all historical queries...');
    const allCitations: LifetimeCitation[] = [];
    let citationId = 1;
    
    allResults.forEach(query => {
      const queryTimestamp = toIsoString(query.date) || new Date().toISOString();
      const canonicalGoogleResult = getCanonicalGoogleResult(query.results);
      const googleOverview = getGoogleResultText(canonicalGoogleResult);
      
      // Extract ChatGPT citations
      // (extractChatGPTCitations lives in the UI layer because it handles the
      // markdown/HTML cleanup needed for display — moving it into the provider
      // layer would require factoring out that coupling. TODO: migrate to the
      // provider-side `ChatGPTSearchProvider.extractNormalizedCitations` once
      // upstream data flows store the raw response.)
      if (query.results?.chatgpt?.response) {
        try {
          const chatgptCitations = extractChatGPTCitations(query.results.chatgpt.response);

          chatgptCitations.forEach((citation: any) => {
            const domain = extractDomainFromUrl(citation.url);
            if (!domain) return; // Skip invalid domains only
            
            allCitations.push({
              id: `lifetime-chatgpt-${citationId++}`,
              url: citation.url,
              text: citation.text,
              source: citation.source || 'ChatGPT',
              provider: 'chatgpt',
              query: query.query,
              queryId: buildTrackedQueryIdentity(query),
              brandName,
              domain,
              timestamp: queryTimestamp,
              type: 'text_extraction',
              isBrandMention: checkBrandMention(citation.text, citation.url, brandName, brandDomain),
              isDomainCitation: checkDomainCitation(citation.url, brandDomain),
              processingSessionId: query.processingSessionId || 'unknown'
            });
          });
        } catch (error) {
          console.warn('⚠️ Error extracting ChatGPT citations:', error);
        }
      }
      
      // Extract Google AI citations
      if (canonicalGoogleResult && googleOverview) {
        try {
          const googleCitations = extractGoogleAIOverviewCitations(googleOverview, {
            ...canonicalGoogleResult,
            aiOverview: googleOverview,
          });
          
          googleCitations.forEach((citation: any) => {
            const domain = extractDomainFromUrl(citation.url);
            if (!domain) return; // Skip invalid domains only
            
            allCitations.push({
              id: `lifetime-google-${citationId++}`,
              url: citation.url,
              text: citation.text,
              source: citation.source || 'Google AI Overview',
              provider: 'googleAI',
              query: query.query,
              queryId: buildTrackedQueryIdentity(query),
              brandName,
              domain,
              timestamp: queryTimestamp,
              type: 'ai_overview',
              isBrandMention: checkBrandMention(citation.text, citation.url, brandName, brandDomain),
              isDomainCitation: checkDomainCitation(citation.url, brandDomain),
              processingSessionId: query.processingSessionId || 'unknown'
            });
          });
        } catch (error) {
          console.warn('⚠️ Error extracting Google AI citations:', error);
        }
      }
      
      // Extract Perplexity citations
      if (query.results?.perplexity?.response) {
        try {
          const perplexityCitations = extractPerplexityCitations(query.results.perplexity.response, query.results.perplexity);
          
          perplexityCitations.forEach((citation: any) => {
            const domain = extractDomainFromUrl(citation.url);
            if (!domain) return; // Skip invalid domains only
            
            allCitations.push({
              id: `lifetime-perplexity-${citationId++}`,
              url: citation.url,
              text: citation.text,
              source: citation.source || 'Perplexity',
              provider: 'perplexity',
              query: query.query,
              queryId: buildTrackedQueryIdentity(query),
              brandName,
              domain,
              timestamp: queryTimestamp,
              type: citation.type || 'structured',
              isBrandMention: checkBrandMention(citation.text, citation.url, brandName, brandDomain),
              isDomainCitation: checkDomainCitation(citation.url, brandDomain),
              processingSessionId: query.processingSessionId || 'unknown'
            });
          });
        } catch (error) {
          console.warn('⚠️ Error extracting Perplexity citations:', error);
        }
      }
    });
    
    console.log(`✅ Extracted ${allCitations.length} individual citations from ${allResults.length} historical queries`);

    // Lifetime totals count unique tracked query identities so duplicate query
    // text under different topic/category buckets still shows up correctly in
    // the UI.
    const uniqueQueryCount = new Set(
      allResults
        .map((result) => buildTrackedQueryIdentity(result))
        .filter((identity) => identity.length > 0)
    ).size;

    // Convert to lifetime analytics format
    const lifetimeAnalytics: LifetimeBrandAnalytics = {
      userId,
      brandId,
      brandName,
      brandDomain,
      totalQueriesProcessed: uniqueQueryCount,
      totalProcessingSessions,
      totalBrandMentions: sessionAnalytics.totalBrandMentions,
      brandVisibilityScore: sessionAnalytics.brandVisibilityScore,
      totalCitations: sessionAnalytics.totalCitations,
      totalDomainCitations: sessionAnalytics.totalDomainCitations,
      allCitations, // Add the extracted individual citations
      trendData: buildLifetimeTrendData(allResults, brandName, brandDomain),
      providerStats: sessionAnalytics.providerStats,
      insights: {
        topPerformingProvider: sessionAnalytics.insights.topPerformingProvider,
        topProviders: sessionAnalytics.insights.topProviders,
        averageBrandMentionsPerResponse: sessionAnalytics.insights.averageBrandMentionsPerResponse,
        averageCitationsPerResponse: sessionAnalytics.insights.averageCitationsPerResponse,
        averageBrandMentionsPerQuery: sessionAnalytics.insights.averageBrandMentionsPerQuery,
        averageCitationsPerQuery: sessionAnalytics.insights.averageCitationsPerQuery,
        firstQueryProcessed,
        lastQueryProcessed,
        providerRankingDetails: sessionAnalytics.insights.providerRankingDetails
      },
      calculatedAt: serverTimestamp(),
      dataTruncated
    };
    
    console.log('✅ Lifetime analytics calculated:', {
      totalQueries: lifetimeAnalytics.totalQueriesProcessed,
      totalSessions: lifetimeAnalytics.totalProcessingSessions,
      totalBrandMentions: lifetimeAnalytics.totalBrandMentions,
      topProvider: lifetimeAnalytics.insights.topPerformingProvider
    });
    
    return { result: lifetimeAnalytics };
    
  } catch (error) {
    console.error('❌ Error calculating lifetime analytics:', error);
    return { error };
  }
}

// Save brand analytics to Firestore
export async function saveBrandAnalytics(analyticsData: BrandAnalyticsData): Promise<{ success: boolean; error?: any }> {
  try {
    const documentId = `${analyticsData.brandId}_${analyticsData.processingSessionId}`;
    const docRef = doc(db, 'v8_user_brand_analytics', documentId);
    await setDoc(docRef, analyticsData, { merge: true });
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error saving brand analytics:', error);
    return { success: false, error };
  }
}

// Save lifetime analytics to Firestore for historical tracking
export async function saveLifetimeAnalytics(analyticsData: LifetimeBrandAnalytics): Promise<{ success: boolean; error?: any }> {
  try {
    // Create a unique document ID based on brand and timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const documentId = `${analyticsData.brandId}_lifetime_${timestamp}`;
    
    // Create a copy for Firestore with potential data optimization
    const analyticsDataForFirestore: any = {
      ...analyticsData,
      createdAt: serverTimestamp(),
      documentType: 'lifetime_analytics',
      originalCitationCount: analyticsData.allCitations?.length || 0,
      dataTruncated: false,
      storedInCloudStorage: false
    };
    
    // Check if the data is still too large and needs Cloud Storage
    const { exceedsFirestoreLimit } = await import('@/firebase/storage/cloudStorage');
    
    if (exceedsFirestoreLimit(analyticsDataForFirestore)) {
      console.log('📦 Analytics data exceeds Firestore limits, storing in Cloud Storage...');
      
      // Store large data in Cloud Storage
      const { storeLargeData } = await import('@/firebase/storage/cloudStorage');
      const { storageRef, error: storageError } = await storeLargeData(
        analyticsData, // Store full data in Cloud Storage
        `lifetime-analytics/${analyticsData.brandId}`,
        'lifetime_analytics',
        {
          brandId: analyticsData.brandId,
          citationCount: analyticsData.allCitations?.length || 0
        }
      );
      
      if (storageError) {
        console.warn('⚠️ Failed to store analytics in Cloud Storage, truncating citations for Firestore');
        // Only truncate if Cloud Storage fails
        analyticsDataForFirestore.allCitations = analyticsData.allCitations?.slice(0, 100) || [];
        analyticsDataForFirestore.dataTruncated = true;
        analyticsDataForFirestore.truncationReason = 'cloud_storage_failed';
      } else {
        // Successfully stored in Cloud Storage - save only a reference and summary in Firestore
        if (storageRef?.storagePath) {
          analyticsDataForFirestore.storageRef = storageRef.storagePath;
        }
        analyticsDataForFirestore.allCitations = []; // Remove citations from Firestore document
        analyticsDataForFirestore.dataTruncated = false;
        analyticsDataForFirestore.storedInCloudStorage = true;
        console.log(`✅ Full analytics data with ${analyticsData.allCitations?.length || 0} citations stored in Cloud Storage`);
      }
    } else {
      // Data fits in Firestore, keep all citations
      analyticsDataForFirestore.dataTruncated = false;
      analyticsDataForFirestore.storedInCloudStorage = false;
      console.log(`✅ Analytics data with ${analyticsData.allCitations?.length || 0} citations stored directly in Firestore`);
    }
    
    // Remove undefined fields before saving to Firebase (deep clean)
    const cleanUndefinedFields = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      
      if (Array.isArray(obj)) {
        return obj.map(cleanUndefinedFields);
      }
      
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          cleaned[key] = cleanUndefinedFields(value);
        }
      }
      return cleaned;
    };

    const cleanedData = cleanUndefinedFields(analyticsDataForFirestore);

    const docRef = doc(db, 'v8_lifetime_brand_analytics', documentId);
    await setDoc(docRef, cleanedData);
    
    console.log('✅ Lifetime analytics saved to Firestore:', {
      documentId: docRef.id,
      citationCount: analyticsData.allCitations?.length || 0,
      dataTruncated: cleanedData.dataTruncated,
      usedCloudStorage: cleanedData.storedInCloudStorage,
      storageRef: cleanedData.storageRef
    });
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error saving lifetime analytics:', error);
    
    // If it's a write stream exhaustion error, try saving with minimal data
    if ((error as any)?.code === 'resource-exhausted' || (error as any)?.message?.includes('Write stream exhausted')) {
      console.log('🔄 Retrying with minimal analytics data due to write stream exhaustion...');
      
      try {
        const minimalAnalytics = {
          userId: analyticsData.userId,
          brandId: analyticsData.brandId,
          brandName: analyticsData.brandName,
          brandDomain: analyticsData.brandDomain,
          totalQueriesProcessed: analyticsData.totalQueriesProcessed,
          totalBrandMentions: analyticsData.totalBrandMentions,
          brandVisibilityScore: analyticsData.brandVisibilityScore,
          totalCitations: analyticsData.totalCitations,
          totalDomainCitations: analyticsData.totalDomainCitations,
          totalProcessingSessions: analyticsData.totalProcessingSessions,
          providerStats: analyticsData.providerStats,
          insights: analyticsData.insights,
          calculatedAt: analyticsData.calculatedAt,
          // Exclude large arrays
          allCitations: [],
          createdAt: serverTimestamp(),
          documentType: 'lifetime_analytics',
          dataTruncated: true,
          storedInCloudStorage: false,
          originalCitationCount: analyticsData.allCitations?.length || 0,
          truncationReason: 'write_stream_exhausted'
        };
        
        const minimalTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const docRef = doc(db, 'v8_lifetime_brand_analytics', `${analyticsData.brandId}_lifetime_minimal_${minimalTimestamp}`);
        await setDoc(docRef, minimalAnalytics);
        
        console.log('✅ Minimal lifetime analytics saved after write stream exhaustion');
        return { success: true };
      } catch (retryError) {
        console.error('❌ Failed to save even minimal analytics:', retryError);
        return { success: false, error: retryError };
      }
    }
    
    return { success: false, error };
  }
}

// Get latest brand analytics for a specific brand
export async function getLatestBrandAnalytics(brandId: string): Promise<{ result?: BrandAnalyticsData; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8_user_brand_analytics'),
      where('brandId', '==', brandId),
      orderBy('processingSessionTimestamp', 'desc'),
      limit(ANALYTICS_SESSION_READ_LIMIT)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return { result: undefined };
    }
    
    const deduped = dedupeAnalyticsSessions(
      querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as BrandAnalyticsData)),
      1
    );
    
    return { result: deduped[0] };
  } catch (error) {
    console.error('❌ Error fetching latest brand analytics:', error);
    return { error };
  }
}

// Get brand analytics history with trend analysis
export async function getBrandAnalyticsHistory(brandId: string): Promise<{ result?: BrandAnalyticsHistory; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8_user_brand_analytics'),
      where('brandId', '==', brandId),
      orderBy('processingSessionTimestamp', 'desc'),
      limit(ANALYTICS_SESSION_READ_LIMIT)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return { result: undefined };
    }
    
    const analyticsDocs = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    } as BrandAnalyticsData));
    const deduped = dedupeAnalyticsSessions(analyticsDocs, 2);
    const latestAnalytics = deduped[0];
    const previousAnalytics = deduped.length > 1 ? deduped[1] : undefined;
    
    // Calculate trends
    let trend = {
      brandMentionsChange: 0,
      citationsChange: 0,
      visibilityChange: 0
    };
    
    if (previousAnalytics) {
      trend = {
        brandMentionsChange: latestAnalytics.totalBrandMentions - previousAnalytics.totalBrandMentions,
        citationsChange: latestAnalytics.totalCitations - previousAnalytics.totalCitations,
        visibilityChange: latestAnalytics.brandVisibilityScore - previousAnalytics.brandVisibilityScore
      };
      
      // Update trend direction in latest analytics
      latestAnalytics.insights.brandVisibilityTrend = 
        trend.visibilityChange > 1 ? 'improving' : 
        trend.visibilityChange < -1 ? 'declining' : 'stable';
    }
    
    const history: BrandAnalyticsHistory = {
      brandId,
      totalSessions: dedupeAnalyticsSessions(analyticsDocs).length,
      latestAnalytics,
      previousAnalytics,
      trend
    };
    
    return { result: history };
  } catch (error) {
    console.error('❌ Error fetching brand analytics history:', error);
    return { error };
  }
}

// Get all analytics for a user across all brands
export async function getUserBrandAnalytics(userId: string): Promise<{ result?: BrandAnalyticsData[]; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8_user_brand_analytics'),
      where('userId', '==', userId),
      orderBy('processingSessionTimestamp', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    
    const analytics = dedupeAnalyticsSessions(
      querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      } as BrandAnalyticsData))
    );
    
    return { result: analytics };
  } catch (error) {
    console.error('❌ Error fetching user brand analytics:', error);
    return { error };
  }
}
