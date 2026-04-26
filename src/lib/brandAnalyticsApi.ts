'use client'

import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import type {
  BrandAnalyticsData,
  LifetimeBrandAnalytics,
} from '@/firebase/firestore/brandAnalytics';
import type { RecommendationData } from '@/lib/recommendation-types';

export interface BrandAnalyticsBundleResponse {
  latestAnalytics: BrandAnalyticsData | null;
  lifetimeAnalytics: LifetimeBrandAnalytics | null;
  competitorAnalytics: any | null;
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
  const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
  if (!idToken) {
    throw new Error('Failed to get authentication token');
  }

  const response = await fetch(
    `/api/brands/${encodeURIComponent(brandId)}/analytics?includeCompetitors=${includeCompetitors ? 'true' : 'false'}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
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
