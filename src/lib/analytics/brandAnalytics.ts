import { analyzeBrandMentions } from '@/lib/brand-mentions';
import { extractChatGPTCitations } from '@/lib/citations/chatgpt';
import { extractGoogleAIOverviewCitations } from '@/lib/citations/googleAIOverview';
import { extractPerplexityCitations } from '@/lib/citations/perplexity';
import { matchesWord } from '@/lib/competitor-matching';
import { toIsoString } from '@/lib/timestamps';
import {
  buildTrackedQueryIdentity,
  getCanonicalGoogleResult,
  getGoogleResultText,
  type QueryProcessingResult,
} from '@/lib/queryResultUtils';
import type { BrandQueryCorpus } from './brandQueryCorpus';

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

export function calculateLatestSessionAnalyticsFromCorpus(
  userId: string,
  corpus: BrandQueryCorpus
): BrandAnalyticsData | undefined {
  const { brand, allResults } = corpus;
  const brandId = brand.id;
  const brandName = brand.companyName;
  const brandDomain = brand.domain;

  if (allResults.length === 0) {
    return undefined;
  }

  const sessionGroups: { [sessionId: string]: QueryProcessingResult[] } = {};
  let latestSessionId = '';
  let latestSessionMs = -Infinity;
  let latestSessionTimestamp = '';

  allResults.forEach((query) => {
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

  const latestSessionQueries = sessionGroups[latestSessionId] || [];
  if (latestSessionQueries.length === 0) {
    return undefined;
  }

  return calculateCumulativeAnalytics(
    userId,
    brandId,
    brandName,
    brandDomain,
    latestSessionId,
    latestSessionTimestamp,
    latestSessionQueries
  );
}

export function calculateLifetimeBrandAnalyticsFromCorpus(
  userId: string,
  corpus: BrandQueryCorpus
): LifetimeBrandAnalytics {
  const {
    brand,
    currentResults,
    historicalResults,
    allResults,
  } = corpus;
  const brandId = brand.id;
  const brandName = brand.companyName;
  const brandDomain = brand.domain;
  const totalProcessingSessions = new Set(
    allResults
      .map((result) => result.processingSessionId)
      .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0)
  ).size;

  if (allResults.length === 0) {
    return {
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
      allCitations: [],
      trendData: [],
      providerStats: {
        chatgpt: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 },
        google: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 },
        perplexity: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 },
      },
      insights: {
        topPerformingProvider: 'none',
        topProviders: [],
        averageBrandMentionsPerResponse: 0,
        averageCitationsPerResponse: 0,
        averageBrandMentionsPerQuery: 0,
        averageCitationsPerQuery: 0,
      },
      calculatedAt: new Date().toISOString(),
    };
  }

  console.log(`📊 Analytics data collection summary:`, {
    totalQueries: allResults.length,
    totalSessions: totalProcessingSessions,
    brandDocumentQueries: currentResults.length,
    historicalQueries: historicalResults.length,
    brandId,
    brandName,
  });

  const querySourceBreakdown = allResults.reduce((acc, q) => {
    const isLegacy = q.processingSessionId?.startsWith('legacy_');
    acc[isLegacy ? 'historical' : 'current'] = (acc[isLegacy ? 'historical' : 'current'] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('🔍 Query source breakdown:', querySourceBreakdown);

  const sessionAnalytics = calculateCumulativeAnalytics(
    userId,
    brandId,
    brandName,
    brandDomain,
    'lifetime_analytics',
    new Date().toISOString(),
    allResults
  );

  const queryDates = allResults
    .map((q) => new Date(q.date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const firstQueryProcessed = queryDates.length > 0 ? queryDates[0].toISOString() : undefined;
  const lastQueryProcessed = queryDates.length > 0 ? queryDates[queryDates.length - 1].toISOString() : undefined;

  const extractDomainFromUrl = (url: string): string | undefined => {
    if (!url || !/^https?:\/\//i.test(url)) return undefined;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return undefined;
    }
  };

  const checkBrandMention = (text: string, url: string, brandNameValue: string, brandDomainValue?: string): boolean => {
    if (!brandNameValue || !text) return false;
    return matchesWord(text, brandNameValue);
  };

  const checkDomainCitation = (url: string, brandDomainValue?: string): boolean => {
    if (!brandDomainValue || !url) return false;
    try {
      const parsed = new URL(url);
      const urlHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const brandHost = brandDomainValue.toLowerCase().replace(/^www\./, '').trim();
      if (!urlHost || !brandHost) return false;
      return urlHost === brandHost;
    } catch {
      return false;
    }
  };

  const allCitations: LifetimeCitation[] = [];
  let citationId = 1;

  allResults.forEach((query) => {
    const queryTimestamp = toIsoString(query.date) || new Date().toISOString();
    const canonicalGoogleResult = getCanonicalGoogleResult(query.results);
    const googleOverview = getGoogleResultText(canonicalGoogleResult);

    if (query.results?.chatgpt?.response) {
      try {
        const chatgptCitations = extractChatGPTCitations(query.results.chatgpt.response);

        chatgptCitations.forEach((citation: any) => {
          const domain = extractDomainFromUrl(citation.url);
          if (!domain) return;

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
            processingSessionId: query.processingSessionId || 'unknown',
          });
        });
      } catch (error) {
        console.warn('⚠️ Error extracting ChatGPT citations:', error);
      }
    }

    if (canonicalGoogleResult && googleOverview) {
      try {
        const googleCitations = extractGoogleAIOverviewCitations(googleOverview, {
          ...canonicalGoogleResult,
          aiOverview: googleOverview,
        });

        googleCitations.forEach((citation: any) => {
          const domain = extractDomainFromUrl(citation.url);
          if (!domain) return;

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
            processingSessionId: query.processingSessionId || 'unknown',
          });
        });
      } catch (error) {
        console.warn('⚠️ Error extracting Google AI citations:', error);
      }
    }

    if (query.results?.perplexity?.response) {
      try {
        const perplexityCitations = extractPerplexityCitations(query.results.perplexity.response, query.results.perplexity);

        perplexityCitations.forEach((citation: any) => {
          const domain = extractDomainFromUrl(citation.url);
          if (!domain) return;

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
            processingSessionId: query.processingSessionId || 'unknown',
          });
        });
      } catch (error) {
        console.warn('⚠️ Error extracting Perplexity citations:', error);
      }
    }
  });

  const uniqueQueryCount = new Set(
    allResults
      .map((result) => buildTrackedQueryIdentity(result))
      .filter((identity) => identity.length > 0)
  ).size;

  return {
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
    allCitations,
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
      providerRankingDetails: sessionAnalytics.insights.providerRankingDetails,
    },
    calculatedAt: new Date().toISOString(),
  };
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

  queryResults.forEach(queryResult => {
    const canonicalGoogleResult = getCanonicalGoogleResult(queryResult.results);
    const googleOverview = getGoogleResultText(canonicalGoogleResult);

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

    totalBrandMentions += analysis.totals.totalBrandMentions;
    totalCitations += analysis.totals.totalCitations;
    totalDomainCitations += analysis.totals.totalDomainCitations;
    totalProvidersWithBrandMentions += analysis.totals.providersWithBrandMention;
    totalProviders += Object.keys(analysis.results).length;

    Object.entries(analysis.results).forEach(([providerKey, result]) => {
      if (result) {
        const provider = providerKey as keyof typeof providerStats;
        providerStats[provider].queriesProcessed++;
        providerStats[provider].brandMentions += result.brandMentionCount;
        providerStats[provider].citations += result.citationCount;
        providerStats[provider].domainCitations += result.domainCitationCount;

        const responseTime = provider === 'google'
          ? canonicalGoogleResult?.responseTime
          : queryResult.results?.[provider]?.responseTime;
        if (responseTime) {
          providerStats[provider].totalResponseTime += responseTime;
        }
      }
    });
  });

  const brandVisibilityScore = totalProviders > 0 ? (totalProvidersWithBrandMentions / totalProviders) * 100 : 0;
  const averageBrandMentionsPerResponse = totalProviders > 0 ? totalBrandMentions / totalProviders : 0;
  const averageCitationsPerResponse = totalProviders > 0 ? totalCitations / totalProviders : 0;
  const averageBrandMentionsPerQuery = queryResults.length > 0 ? totalBrandMentions / queryResults.length : 0;
  const averageCitationsPerQuery = queryResults.length > 0 ? totalCitations / queryResults.length : 0;

  let topPerformingProvider = 'none';
  let topProviders: string[] = [];

  const hasBrandPerformance = totalBrandMentions > 0 || totalDomainCitations > 0;

  if (!hasBrandPerformance) {
    topPerformingProvider = 'none';
    topProviders = [];
  } else {
    const providerRankings = Object.entries(providerStats)
      .filter(([_, stats]) => stats.queriesProcessed > 0)
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
      providerRankings.sort((a, b) => {
        if (a.brandMentions !== b.brandMentions) {
          return b.brandMentions - a.brandMentions;
        }

        if (Math.abs(a.domainCitationsRatio - b.domainCitationsRatio) > 0.001) {
          return b.domainCitationsRatio - a.domainCitationsRatio;
        }

        return b.totalCitations - a.totalCitations;
      });

      const topProvider = providerRankings[0];

      const topProviderHasPerformance = topProvider.brandMentions > 0 || topProvider.domainCitations > 0;

      if (!topProviderHasPerformance) {
        topPerformingProvider = 'none';
        topProviders = [];
      } else {
        const tiedProviders = providerRankings.filter(p =>
          p.brandMentions === topProvider.brandMentions &&
          Math.abs(p.domainCitationsRatio - topProvider.domainCitationsRatio) < 0.001 &&
          (p.brandMentions > 0 || p.domainCitations > 0)
        );

        if (tiedProviders.length > 1) {
          topPerformingProvider = tiedProviders.map(p => p.provider).join(' & ');
          topProviders = tiedProviders.map(p => p.provider);
        } else {
          topPerformingProvider = topProvider.provider;
          topProviders = [topProvider.provider];
        }
      }
    }
  }

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

  Object.values(finalProviderStats).forEach(stats => {
    delete (stats as any).totalResponseTime;
  });

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
      domainCitationsRatio: Math.round(ranking.domainCitationsRatio * 10000) / 100,
      totalCitations: ranking.totalCitations
    };
  });

  const nowIso = new Date().toISOString();

  return {
    userId,
    brandId,
    brandName,
    brandDomain,
    processingSessionId,
    processingSessionTimestamp,
    totalQueriesProcessed: queryResults.length,
    totalBrandMentions,
    brandVisibilityScore: Math.round(brandVisibilityScore * 100) / 100,
    totalCitations,
    totalDomainCitations,
    providerStats: finalProviderStats,
    insights: {
      topPerformingProvider,
      topProviders,
      brandVisibilityTrend: 'stable',
      averageBrandMentionsPerResponse: Math.round(averageBrandMentionsPerResponse * 100) / 100,
      averageCitationsPerResponse: Math.round(averageCitationsPerResponse * 100) / 100,
      averageBrandMentionsPerQuery: Math.round(averageBrandMentionsPerQuery * 100) / 100,
      averageCitationsPerQuery: Math.round(averageCitationsPerQuery * 100) / 100,
      competitorMentionsDetected: 0,
      providerRankingDetails
    },
    lastUpdated: nowIso,
    createdAt: nowIso
  };
}
