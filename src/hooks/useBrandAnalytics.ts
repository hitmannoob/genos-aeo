'use client'
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/context/AuthContext';
import {
  getBrandAnalyticsHistory,
  getUserBrandAnalytics,
  calculateLifetimeBrandAnalytics,
  calculateLatestSessionFromBrandDocument,
  type BrandAnalyticsData,
  type BrandAnalyticsHistory,
} from '@/firebase/firestore/brandAnalytics';
import {
  loadBrandWithQueryResults,
  brandWithResultsQueryKey,
  type BrandWithResults,
} from '@/firebase/firestore/brandWithResults';

// Shared across all analytics hooks: matches useCompetitors to avoid duplicate fetches.
const BRAND_WITH_RESULTS_STALE_MS = 3 * 60 * 1000;

// Hook for getting latest brand analytics (session-based) - optimized with React Query
export function useLatestBrandAnalytics(brandId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userId = user?.uid;
  return useQuery({
    queryKey: ['latestBrandAnalytics', brandId, userId],
    queryFn: async () => {
      if (!brandId || !userId) return null;

      // Share the brand + queryProcessingResults fetch across sibling hooks via
      // queryClient. Only one Cloud Storage load happens per brand per stale window.
      const preloaded = await queryClient.fetchQuery<BrandWithResults>({
        queryKey: brandWithResultsQueryKey(brandId),
        queryFn: () => loadBrandWithQueryResults(brandId),
        staleTime: BRAND_WITH_RESULTS_STALE_MS,
      });

      const { result: lifetimeResult, error: lifetimeError } = await calculateLifetimeBrandAnalytics(brandId, userId, preloaded);

      if (lifetimeError) {
        throw new Error('Failed to fetch analytics');
      }

      if (!lifetimeResult) {
        return null;
      }

      // Extract latest session data from the already-loaded brand.
      const { result: latestSessionAnalytics } = await calculateLatestSessionFromBrandDocument(brandId, userId, preloaded);

      if (latestSessionAnalytics) {
        return latestSessionAnalytics;
      } else {
        // Fallback: convert lifetime to session format if no distinct session found
        const sessionAnalytics: BrandAnalyticsData = {
          id: undefined,
          userId: lifetimeResult.userId,
          brandId: lifetimeResult.brandId,
          brandName: lifetimeResult.brandName,
          brandDomain: lifetimeResult.brandDomain,
          processingSessionId: 'latest_session',
          processingSessionTimestamp: new Date().toISOString(),
          totalQueriesProcessed: lifetimeResult.totalQueriesProcessed,
          totalBrandMentions: lifetimeResult.totalBrandMentions,
          brandVisibilityScore: lifetimeResult.brandVisibilityScore,
          totalCitations: lifetimeResult.totalCitations,
          totalDomainCitations: lifetimeResult.totalDomainCitations,
          providerStats: lifetimeResult.providerStats,
          insights: {
            ...lifetimeResult.insights,
            brandVisibilityTrend: 'stable' as const,
            competitorMentionsDetected: 0
          },
          lastUpdated: lifetimeResult.calculatedAt,
          createdAt: lifetimeResult.calculatedAt
        };
        return sessionAnalytics;
      }
    },
    enabled: !!brandId && !!userId,
    staleTime: 3 * 60 * 1000, // Consider data fresh for 3 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false,
  });
}

// Hook for getting lifetime brand analytics (all historical data) - optimized with React Query
export function useLifetimeBrandAnalytics(brandId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const userId = user?.uid;
  return useQuery({
    queryKey: ['lifetimeBrandAnalytics', brandId, userId],
    queryFn: async () => {
      if (!brandId || !userId) return null;

      const preloaded = await queryClient.fetchQuery<BrandWithResults>({
        queryKey: brandWithResultsQueryKey(brandId),
        queryFn: () => loadBrandWithQueryResults(brandId),
        staleTime: BRAND_WITH_RESULTS_STALE_MS,
      });

      const { result, error: fetchError } = await calculateLifetimeBrandAnalytics(brandId, userId, preloaded);

      if (fetchError) {
        throw new Error('Failed to calculate lifetime analytics');
      }

      return result || null;
    },
    enabled: !!brandId && !!userId,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes (lifetime data changes less frequently)
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
  });
}

// Combined hook for getting both latest and lifetime analytics - optimized with React Query
export function useBrandAnalyticsCombined(brandId: string | undefined) {
  const latestQuery = useLatestBrandAnalytics(brandId);
  const lifetimeQuery = useLifetimeBrandAnalytics(brandId);

  const loading = latestQuery.isLoading || lifetimeQuery.isLoading;
  const error = latestQuery.error?.message || lifetimeQuery.error?.message || null;

  return {
    latestAnalytics: latestQuery.data || null,
    lifetimeAnalytics: lifetimeQuery.data || null,
    loading,
    error,
    hasLatestData: !!latestQuery.data,
    hasLifetimeData: !!lifetimeQuery.data,
    // Expose refetch functions for manual refresh
    refetchLatest: latestQuery.refetch,
    refetchLifetime: lifetimeQuery.refetch,
    // Expose individual query states for more granular control
    latestQuery,
    lifetimeQuery
  };
}

// Hook for getting brand analytics history with trend analysis
export function useBrandAnalyticsHistory(brandId: string | undefined) {
  const [history, setHistory] = useState<BrandAnalyticsHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      if (!brandId) {
        setHistory(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const { result, error: fetchError } = await getBrandAnalyticsHistory(brandId);
        
        if (fetchError) {
          setError('Failed to fetch analytics history');
          console.error('Analytics history error:', fetchError);
        } else {
          setHistory(result || null);
        }
      } catch (err) {
        setError('Failed to fetch analytics history');
        console.error('Analytics history error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
  }, [brandId]);

  return { history, loading, error };
}

// Hook for getting all user brand analytics
export function useUserBrandAnalytics(userId: string | undefined) {
  const [userAnalytics, setUserAnalytics] = useState<BrandAnalyticsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserAnalytics() {
      if (!userId) {
        setUserAnalytics([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const { result, error: fetchError } = await getUserBrandAnalytics(userId);
        
        if (fetchError) {
          setError('Failed to fetch user analytics');
          console.error('User analytics error:', fetchError);
        } else {
          setUserAnalytics(result || []);
        }
      } catch (err) {
        setError('Failed to fetch user analytics');
        console.error('User analytics error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchUserAnalytics();
  }, [userId]);

  return { userAnalytics, loading, error };
}

// Hook for aggregated user analytics summary
export function useUserAnalyticsSummary(userId: string | undefined) {
  const { userAnalytics, loading, error } = useUserBrandAnalytics(userId);

  const summary = {
    totalBrands: userAnalytics.length,
    totalBrandMentions: userAnalytics.reduce((sum, analytics) => sum + analytics.totalBrandMentions, 0),
    totalCitations: userAnalytics.reduce((sum, analytics) => sum + analytics.totalCitations, 0),
    averageVisibilityScore: userAnalytics.length > 0 
      ? userAnalytics.reduce((sum, analytics) => sum + analytics.brandVisibilityScore, 0) / userAnalytics.length
      : 0,
    topPerformingBrand: userAnalytics.length > 0
      ? userAnalytics.reduce((prev, current) => 
          prev.totalBrandMentions > current.totalBrandMentions ? prev : current
        ).brandName
      : null
  };

  return { summary, loading, error };
} 