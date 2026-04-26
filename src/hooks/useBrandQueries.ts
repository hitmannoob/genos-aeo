'use client'
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { toIsoString } from '@/firebase/firestore/timestamps';
import {
  getCanonicalGoogleResult,
  hasProviderContent,
  type QueryProcessingResult,
} from '@/firebase/firestore/queryResultUtils';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

// Canonical processed-query shape stored on brand documents.
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

export function useBrandQueries(options: UseBrandQueriesOptions = {}): UseBrandQueriesReturn {
  const { user } = useAuthContext();
  const [queries, setQueries] = useState<ProcessedQueryResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { brandId, autoRefresh = false, refreshInterval = 30000 } = options;

  // Tracks the (uid, brandId) pair an in-flight fetch was started for. If
  // either changes mid-flight, we drop the late response so the newer fetch
  // wins instead of being clobbered by a slower call for a different brand.
  const activeFetchKeyRef = useRef<string | null>(null);

  // Fetch queries from brand document
  const fetchQueries = useCallback(async () => {
    const requestKey = user?.uid && brandId ? `${user.uid}::${brandId}` : null;
    activeFetchKeyRef.current = requestKey;

    if (!requestKey) {
      setQueries([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      if (!idToken) {
        throw new Error('Failed to get authentication token');
      }

      const response = await fetch(
        `/api/brands/${encodeURIComponent(brandId!)}?includeQueryResults=true`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch brand query results (${response.status})`);
      }

      const payload = await response.json();
      const brand = payload?.brand as {
        companyName?: string;
        lastProcessedAt?: any;
        queryProcessingResults?: ProcessedQueryResult[];
      } | undefined;

      if (activeFetchKeyRef.current !== requestKey) {
        return;
      }

      if (!brand) {
        setError('Brand not found');
        setQueries([]);
        return;
      }

      const queryResults = brand.queryProcessingResults || [];

      // Sort by date descending (newest first)
      const sortedQueries = queryResults.slice().sort((a: ProcessedQueryResult, b: ProcessedQueryResult) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      });

      setQueries(sortedQueries);

      console.log('✅ Brand queries fetched:', {
        brandName: brand.companyName,
        queriesCount: queryResults.length,
        lastProcessed: toIsoString((brand as any).lastProcessedAt) || 'Never',
      });
    } catch (err) {
      if (activeFetchKeyRef.current !== requestKey) {
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch brand queries';
      setError(errorMessage);
      console.error('Error fetching brand queries:', err);
    } finally {
      if (activeFetchKeyRef.current === requestKey) {
        setLoading(false);
      }
    }
  }, [user?.uid, brandId]);

  // Initial fetch
  useEffect(() => {
    fetchQueries();
  }, [fetchQueries]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchQueries();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchQueries]);

  // Calculate stats
  const stats = {
    total: queries.length,
    withChatGPT: queries.filter(q => hasProviderContent(q.results?.chatgpt)).length,
    withGoogleAI: queries.filter(q => hasProviderContent(getCanonicalGoogleResult(q.results))).length,
    withPerplexity: queries.filter(q => hasProviderContent(q.results?.perplexity)).length,
    totalSessions: new Set(queries.map(q => q.processingSessionId)).size,
  };

  return {
    queries,
    loading,
    error,
    refetch: fetchQueries,
    stats,
  };
} 
