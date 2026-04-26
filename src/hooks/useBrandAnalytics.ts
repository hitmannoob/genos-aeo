'use client'
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/context/AuthContext';
import {
  brandAnalyticsBundleQueryKey,
  fetchBrandAnalyticsBundle,
} from '@/lib/brandAnalyticsApi';

const ANALYTICS_STALE_MS = 3 * 60 * 1000;

export function useBrandAnalyticsBundle(
  brandId: string | undefined,
  includeCompetitors: boolean = false
) {
  const { user } = useAuthContext();
  const userId = user?.uid;

  return useQuery({
    queryKey: brandAnalyticsBundleQueryKey(brandId, userId, includeCompetitors),
    queryFn: async () => {
      if (!brandId) {
        return null;
      }

      return fetchBrandAnalyticsBundle(brandId, includeCompetitors);
    },
    enabled: !!brandId && !!userId,
    staleTime: ANALYTICS_STALE_MS,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// Hook for getting latest brand analytics (session-based) - optimized with React Query
export function useLatestBrandAnalytics(brandId: string | undefined) {
  const bundleQuery = useBrandAnalyticsBundle(brandId);

  return {
    ...bundleQuery,
    data: bundleQuery.data?.latestAnalytics || null,
  };
}

// Hook for getting lifetime brand analytics (all historical data) - optimized with React Query
export function useLifetimeBrandAnalytics(brandId: string | undefined) {
  const bundleQuery = useBrandAnalyticsBundle(brandId);

  return {
    ...bundleQuery,
    data: bundleQuery.data?.lifetimeAnalytics || null,
  };
}

// Combined hook for getting both latest and lifetime analytics - optimized with React Query
export function useBrandAnalyticsCombined(brandId: string | undefined) {
  const bundleQuery = useBrandAnalyticsBundle(brandId);
  const error = bundleQuery.error instanceof Error ? bundleQuery.error.message : null;

  return {
    latestAnalytics: bundleQuery.data?.latestAnalytics || null,
    lifetimeAnalytics: bundleQuery.data?.lifetimeAnalytics || null,
    recommendations: bundleQuery.data?.recommendations || [],
    loading: bundleQuery.isLoading,
    error,
    hasLatestData: !!bundleQuery.data?.latestAnalytics,
    hasLifetimeData: !!bundleQuery.data?.lifetimeAnalytics,
    refetchLatest: bundleQuery.refetch,
    refetchLifetime: bundleQuery.refetch,
    latestQuery: bundleQuery,
    lifetimeQuery: bundleQuery,
  };
}
