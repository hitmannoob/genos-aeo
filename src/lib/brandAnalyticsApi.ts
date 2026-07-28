'use client'
import type {
  BrandAnalyticsData,
  LifetimeBrandAnalytics,
} from '@/lib/analytics/brandAnalytics';
import type { RecommendationData } from '@/lib/recommendation-types';
import type { CompetitorAnalyticsData } from '@/utils/competitor-analytics';

export interface BrandAnalyticsBundleResponse {
  latestAnalytics: BrandAnalyticsData | null;
  lifetimeAnalytics: LifetimeBrandAnalytics | null;
  competitorAnalytics: {
    current: CompetitorAnalyticsData;
    previous: CompetitorAnalyticsData | null;
  } | null;
  recommendations: RecommendationData[];
}

export const brandAnalyticsBundleQueryKey = (
  brandId: string | undefined,
  userId: string | undefined,
  includeCompetitors: boolean
) => ['brandAnalyticsBundle', brandId, userId, includeCompetitors] as const;

export async function fetchBrandAnalyticsBundle(
  brandId: string,
  includeCompetitors: boolean = false
): Promise<BrandAnalyticsBundleResponse> {
  const response = await fetch(
    `/api/brands/${encodeURIComponent(brandId)}/analytics?includeCompetitors=${includeCompetitors ? 'true' : 'false'}`,
    {
      method: 'GET',
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to load brand analytics (${response.status})`);
  }

  return {
    latestAnalytics: payload?.latestAnalytics || null,
    lifetimeAnalytics: payload?.lifetimeAnalytics || null,
    competitorAnalytics: payload?.competitorAnalytics || null,
    recommendations: Array.isArray(payload?.recommendations) ? payload.recommendations : [],
  };
}
