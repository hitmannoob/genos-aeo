'use client'
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/context/AuthContext';
import {
  calculateLifetimeBrandAnalytics,
  type LifetimeBrandAnalytics,
  type LifetimeCitation,
} from '@/firebase/firestore/brandAnalytics';
import {
  brandWithResultsQueryKey,
  loadBrandWithQueryResults,
  type BrandWithResults,
} from '@/firebase/firestore/brandWithResults';

interface UseLifetimeCitationsOptions {
  brandId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseLifetimeCitationsReturn {
  citations: LifetimeCitation[];
  loading: boolean;
  error: string | null;
  analytics: LifetimeBrandAnalytics | null;
  refetch: () => Promise<void>;
  stats: {
    totalCitations: number;
    uniqueDomains: number;
    brandMentions: number;
    domainCitations: number;
    byProvider: {
      chatgpt: number;
      googleAI: number;
      perplexity: number;
    };
  };
}

const BRAND_WITH_RESULTS_STALE_MS = 3 * 60 * 1000;

/**
 * Returns the lifetime citation list for a brand. Source of truth is the same
 * live pipeline that powers brand analytics and competitor analytics on the
 * rest of the dashboard — calculateLifetimeBrandAnalytics over the shared
 * brandWithResults cache. The old v8_lifetime_brand_analytics snapshot read
 * has been removed so citations can't drift from the numbers shown elsewhere.
 */
export function useLifetimeCitations(options: UseLifetimeCitationsOptions = {}): UseLifetimeCitationsReturn {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const [citations, setCitations] = useState<LifetimeCitation[]>([]);
  const [analytics, setAnalytics] = useState<LifetimeBrandAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { brandId, autoRefresh = false, refreshInterval = 30000 } = options;

  const fetchLifetimeCitations = useCallback(async () => {
    if (!user?.uid || !brandId) {
      setCitations([]);
      setAnalytics(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const preloaded = await queryClient.fetchQuery<BrandWithResults>({
        queryKey: brandWithResultsQueryKey(brandId),
        queryFn: () => loadBrandWithQueryResults(brandId),
        staleTime: BRAND_WITH_RESULTS_STALE_MS,
      });

      const { result, error: computeError } = await calculateLifetimeBrandAnalytics(brandId, user!.uid, preloaded);

      if (computeError) {
        throw new Error(typeof computeError === 'string' ? computeError : 'Failed to compute lifetime citations');
      }

      if (!result) {
        setCitations([]);
        setAnalytics(null);
        return;
      }

      setAnalytics(result);
      setCitations(result.allCitations || []);
    } catch (err) {
      console.error('❌ useLifetimeCitations failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load citations');
      setCitations([]);
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, brandId, queryClient]);

  useEffect(() => {
    fetchLifetimeCitations();
  }, [fetchLifetimeCitations]);

  useEffect(() => {
    if (!autoRefresh || !brandId) return;
    const interval = setInterval(() => {
      fetchLifetimeCitations();
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, brandId, fetchLifetimeCitations]);

  const stats = {
    totalCitations: citations.length,
    uniqueDomains: new Set(citations.map(c => c.domain)).size,
    brandMentions: citations.filter(c => c.isBrandMention).length,
    domainCitations: citations.filter(c => c.isDomainCitation).length,
    byProvider: {
      chatgpt: citations.filter(c => c.provider === 'chatgpt').length,
      googleAI: citations.filter(c => c.provider === 'googleAI').length,
      perplexity: citations.filter(c => c.provider === 'perplexity').length,
    },
  };

  return {
    citations,
    loading,
    error,
    analytics,
    refetch: fetchLifetimeCitations,
    stats,
  };
}
