import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBrandContext } from '@/context/BrandContext';
import { useAuthContext } from '@/context/AuthContext';
import { calculateLiveCompetitorAnalytics } from '@/firebase/firestore/competitorAnalytics';
import {
  loadBrandWithQueryResults,
  brandWithResultsQueryKey,
  type BrandWithResults,
} from '@/firebase/firestore/brandWithResults';

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
  const { user } = useAuthContext();
  const { selectedBrand, selectedBrandId, loading: brandLoading } = useBrandContext();
  const queryClient = useQueryClient();
  const [competitors, setCompetitors] = useState<CompetitorData[]>([]);
  const [totalQueriesProcessed, setTotalQueriesProcessed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompetitors = useCallback(async () => {
    if (!user?.uid || !selectedBrandId || brandLoading || !selectedBrand) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Share the brand + queryProcessingResults fetch with brand analytics hooks
      // so a single Cloud Storage load serves every pipeline on the page.
      const preloaded = await queryClient.fetchQuery<BrandWithResults>({
        queryKey: brandWithResultsQueryKey(selectedBrandId),
        queryFn: () => loadBrandWithQueryResults(selectedBrandId),
        staleTime: 3 * 60 * 1000,
      });

      const { result, error: analyticsError } = await calculateLiveCompetitorAnalytics(selectedBrandId, user!.uid, preloaded);

      if (analyticsError) {
        throw new Error(typeof analyticsError === 'string' ? analyticsError : 'Failed to compute competitor analytics');
      }

      if (!result) {
        setCompetitors([]);
        setTotalQueriesProcessed(0);
        setLoading(false);
        return;
      }

      const { current, previous } = result;

      const competitorData: CompetitorData[] = Object.entries(current.competitorStats).map(([name, stats], index) => {
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

      setCompetitors(competitorData);
      setTotalQueriesProcessed(current.totalQueriesProcessed);
    } catch (err) {
      console.error('Error fetching competitors:', err);
      setError('Failed to load competitor analytics. Please process some queries first.');
      setCompetitors([]);
      setTotalQueriesProcessed(0);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, selectedBrandId, brandLoading, selectedBrand, queryClient]);

  useEffect(() => {
    fetchCompetitors();
  }, [fetchCompetitors]);

  return {
    competitors,
    totalQueriesProcessed,
    loading,
    error,
    refetch: fetchCompetitors
  };
} 