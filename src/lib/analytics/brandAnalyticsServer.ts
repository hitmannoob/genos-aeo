import 'server-only';

import {
  calculateLatestSessionAnalyticsFromCorpus,
  calculateLifetimeBrandAnalyticsFromCorpus,
  type BrandAnalyticsData,
  type LifetimeBrandAnalytics,
} from './brandAnalytics';
import { calculateLiveCompetitorAnalyticsFromCorpus } from './competitorAnalytics';
import { loadBrandQueryCorpusServer } from './brandQueryCorpusServer';
import type { BrandQueryCorpusLoadErrorCode } from './brandQueryCorpusServer';
import { buildLiveRecommendations } from '@/lib/liveRecommendations';
import { logger } from '@/lib/logger';

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
  error?: {
    code: BrandQueryCorpusLoadErrorCode | 'ANALYTICS_ERROR';
    message: string;
  };
}> {
  try {
    const { result: corpus, error } = await loadBrandQueryCorpusServer(brandId, userId);
    if (error || !corpus) {
      return {
        error: error || {
          code: 'DATABASE_ERROR',
          message: 'Failed to load brand query corpus',
        },
      };
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
    logger.error('Failed to calculate brand analytics', error);
    return {
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to calculate brand analytics',
      },
    };
  }
}
