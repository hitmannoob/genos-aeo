'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/context/AuthContext';
import { toIsoString } from '@/lib/timestamps';
import {
  getCanonicalGoogleResult,
  hasProviderContent,
  type QueryProcessingResult,
} from '@/lib/queryResultUtils';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

export type ProcessedQueryResult = QueryProcessingResult;

interface UseBrandQueriesOptions {
  brandId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseBrandQueriesReturn {
  queries: ProcessedQueryResult[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  stats: {
    total: number;
    withChatGPT: number;
    withGoogleAI: number;
    withPerplexity: number;
    totalSessions: number;
  };
}

export function brandQueriesQueryKey(uid: string | undefined, brandId: string | undefined) {
  return ['brand-queries', uid, brandId] as const;
}

async function fetchBrandQueries(brandId: string): Promise<ProcessedQueryResult[]> {
  const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
  if (!idToken) {
    throw new Error('Failed to get authentication token');
  }

  const response = await fetch(
    `/api/brands/${encodeURIComponent(brandId)}?includeQueryResults=true`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch brand query results (${response.status})`);
  }

  const payload = await response.json();
  const brand = payload?.brand as
    | {
        companyName?: string;
        lastProcessedAt?: unknown;
        queryProcessingResults?: ProcessedQueryResult[];
      }
    | undefined;

  if (!brand) {
    throw new Error('Brand not found');
  }

  const queryResults = brand.queryProcessingResults || [];

  const sortedQueries = queryResults.slice().sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  console.log('✅ Brand queries fetched:', {
    brandName: brand.companyName,
    queriesCount: queryResults.length,
    lastProcessed: toIsoString((brand as { lastProcessedAt?: unknown }).lastProcessedAt) || 'Never',
  });

  return sortedQueries;
}

export function useBrandQueries(options: UseBrandQueriesOptions = {}): UseBrandQueriesReturn {
  const { user } = useAuthContext();
  const { brandId, autoRefresh = false, refreshInterval = 30000 } = options;

  // React Query gives us a shared cache across mounts/pages, so navigating
  // away and back renders cached results immediately while a background
  // refetch happens — no more "Unprocessed" flicker before the fetch lands.
  const query = useQuery({
    queryKey: brandQueriesQueryKey(user?.uid, brandId),
    queryFn: () => fetchBrandQueries(brandId!),
    enabled: !!user?.uid && !!brandId,
    refetchInterval: autoRefresh ? refreshInterval : false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const queries = useMemo(() => query.data ?? [], [query.data]);

  const stats = useMemo(
    () => ({
      total: queries.length,
      withChatGPT: queries.filter((q) => hasProviderContent(q.results?.chatgpt)).length,
      withGoogleAI: queries.filter((q) => hasProviderContent(getCanonicalGoogleResult(q.results))).length,
      withPerplexity: queries.filter((q) => hasProviderContent(q.results?.perplexity)).length,
      totalSessions: new Set(queries.map((q) => q.processingSessionId)).size,
    }),
    [queries]
  );

  return {
    queries,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: async () => {
      await query.refetch();
    },
    stats,
  };
}
