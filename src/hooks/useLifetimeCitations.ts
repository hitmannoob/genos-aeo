'use client'
import { useEffect, useMemo } from 'react';
import {
  type LifetimeBrandAnalytics,
  type LifetimeCitation,
} from '@/lib/analytics/brandAnalytics';
import { useLifetimeBrandAnalytics } from './useBrandAnalytics';

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
export function useLifetimeCitations(options: UseLifetimeCitationsOptions = {}): UseLifetimeCitationsReturn {
  const { brandId, autoRefresh = false, refreshInterval = 30000 } = options;
  const lifetimeQuery = useLifetimeBrandAnalytics(brandId);
  const analytics = lifetimeQuery.data || null;
  const citations = useMemo(
    () => analytics?.allCitations || [],
    [analytics]
  );

  useEffect(() => {
    if (!autoRefresh || !brandId) return;
    const interval = setInterval(() => {
      void lifetimeQuery.refetch();
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, brandId, lifetimeQuery, refreshInterval]);

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
    loading: lifetimeQuery.isLoading,
    error: lifetimeQuery.error instanceof Error ? lifetimeQuery.error.message : null,
    analytics,
    refetch: async () => {
      await lifetimeQuery.refetch();
    },
    stats,
  };
}
