import 'server-only';

import {
  calculateLatestSessionAnalyticsFromCorpus,
  calculateLifetimeBrandAnalyticsFromCorpus,
  type BrandAnalyticsData,
  type LifetimeBrandAnalytics,
} from './brandAnalytics';
import { calculateLiveCompetitorAnalyticsFromCorpus } from './competitorAnalytics';
import { loadBrandQueryCorpusServer } from './brandQueryCorpusServer';
import { buildLiveRecommendations } from '@/lib/liveRecommendations';

function normalizeBrandAnalyticsForJson(
  analytics: BrandAnalyticsData | undefined
): BrandAnalyticsData | null {
  if (!analytics) {
    return null;
  }

  return {
    ...analytics,
    createdAt: analytics.processingSessionTimestamp,
    lastUpdated: analytics.processingSessionTimestamp,
  };
}

function normalizeLifetimeAnalyticsForJson(
  analytics: LifetimeBrandAnalytics | undefined
): LifetimeBrandAnalytics | null {
  if (!analytics) {
    return null;
  }

  return {
    ...analytics,
    calculatedAt: new Date().toISOString(),
  };
}

export async function calculateBrandAnalyticsBundleServer(
  brandId: string,
  userId: string,
  options: { includeCompetitors?: boolean } = {}
): Promise<{
  result?: {
    latestAnalytics: BrandAnalyticsData | null;
    lifetimeAnalytics: LifetimeBrandAnalytics | null;
    competitorAnalytics: ReturnType<typeof calculateLiveCompetitorAnalyticsFromCorpus> | null;
    recommendations: ReturnType<typeof buildLiveRecommendations>;
  };
  error?: any;
}> {
  try {
    const { result: corpus, error } = await loadBrandQueryCorpusServer(brandId, userId);
    if (error || !corpus) {
      return { error: error || new Error('Failed to load brand query corpus') };
    }

    const latestAnalytics = normalizeBrandAnalyticsForJson(
      calculateLatestSessionAnalyticsFromCorpus(userId, corpus)
    );
    const lifetimeAnalytics = normalizeLifetimeAnalyticsForJson(
      calculateLifetimeBrandAnalyticsFromCorpus(userId, corpus)
    );

    return {
      result: {
        latestAnalytics,
        lifetimeAnalytics,
        competitorAnalytics: options.includeCompetitors
          ? calculateLiveCompetitorAnalyticsFromCorpus(brandId, corpus)
          : null,
        recommendations: buildLiveRecommendations({
          brand: corpus.brand,
          latestAnalytics,
          lifetimeAnalytics,
        }),
      },
    };
  } catch (error) {
    console.error('❌ calculateBrandAnalyticsBundleServer failed:', error);
    return { error };
  }
}
