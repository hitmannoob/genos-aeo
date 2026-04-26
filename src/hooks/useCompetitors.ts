import { useMemo } from 'react';
import { useBrandContext } from '@/context/BrandContext';
import { useBrandAnalyticsBundle } from './useBrandAnalytics';
import type { CompetitorAnalyticsData } from '@/utils/competitor-analytics';

interface CompetitorData {
  id: string;
  name: string;
  domain?: string;
  mentions: number;
  visibility: number;
  queriesAnalyzed: number;
  topProvider: string;
  lastUpdated: string;
  mentionsChange: number | null; // delta vs previous-session slice of same corpus; null if no prior data
}

interface UseCompetitorsReturn {
  competitors: CompetitorData[];
  totalQueriesProcessed: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCompetitors(): UseCompetitorsReturn {
  const { selectedBrand, selectedBrandId, loading: brandLoading } = useBrandContext();
  const analyticsQuery = useBrandAnalyticsBundle(selectedBrandId || undefined, true);

  const competitors = useMemo(() => {
    const result = analyticsQuery.data?.competitorAnalytics;
    if (!selectedBrandId || !selectedBrand || !result) {
      return [];
    }

    const { current, previous } = result;
    return Object.entries(current.competitorStats as CompetitorAnalyticsData['competitorStats']).map(([name, stats], index) => {
      const priorMentions = previous?.competitorStats?.[name]?.totalMentions;
      const mentionsChange =
        typeof priorMentions === 'number' ? stats.totalMentions - priorMentions : null;

      return {
        id: (index + 1).toString(),
        name,
        domain: undefined,
        mentions: stats.totalMentions,
        visibility: Math.round(stats.visibilityScore),
        queriesAnalyzed: current.totalQueriesProcessed,
        topProvider: stats.topProvider,
        lastUpdated: current.processingSessionTimestamp,
        mentionsChange,
      };
    });
  }, [analyticsQuery.data?.competitorAnalytics, selectedBrand, selectedBrandId]);

  const totalQueriesProcessed = analyticsQuery.data?.competitorAnalytics?.current.totalQueriesProcessed || 0;

  return {
    competitors,
    totalQueriesProcessed,
    loading: brandLoading || analyticsQuery.isLoading,
    error: analyticsQuery.error instanceof Error
      ? analyticsQuery.error.message
      : null,
    refetch: async () => {
      await analyticsQuery.refetch();
    },
  };
}
