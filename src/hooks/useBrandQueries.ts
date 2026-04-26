'use client'
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { getBrandInfo } from '@/firebase/firestore/brandDataService';
import { retrieveDocumentWithLargeData } from '@/firebase/storage/cloudStorage';
import { toIsoString } from '@/firebase/firestore/timestamps';
import {
  getCanonicalGoogleResult,
  hasProviderContent,
  type QueryProcessingResult,
} from '@/firebase/firestore/queryResultUtils';

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

      console.log('🔍 Fetching brand queries for brandId:', brandId);

      // Get brand info which contains queryProcessingResults
      let brand = await getBrandInfo(brandId!);

      if (activeFetchKeyRef.current !== requestKey) {
        return;
      }

      if (!brand) {
        setError('Brand not found');
        setQueries([]);
        return;
      }

      // If the brand document has storage references, retrieve full data from Cloud Storage
      if ((brand as any).storageReferences?.queryProcessingResults) {
        console.log('📥 Brand has Cloud Storage references, retrieving full query results...');
        try {
          const { document: fullBrandData } = await retrieveDocumentWithLargeData(
            'v8userbrands',
            brandId!,
            ['queryProcessingResults']
          );

          if (activeFetchKeyRef.current !== requestKey) {
            return;
          }

          if (fullBrandData?.queryProcessingResults) {
            brand.queryProcessingResults = fullBrandData.queryProcessingResults;
            console.log(`✅ Retrieved ${fullBrandData.queryProcessingResults.length} query results from Cloud Storage`);
          }
        } catch (storageError) {
          console.warn('⚠️ Failed to retrieve query results from Cloud Storage:', storageError);
          // Continue with truncated data from Firestore
        }
      }

      const queryResults = brand.queryProcessingResults || [];

      console.log('✅ Brand queries fetched:', {
        brandName: brand.companyName,
        queriesCount: queryResults.length,
        lastProcessed: toIsoString((brand as any).lastProcessedAt) || 'Never'
      });

      // Sort by date descending (newest first)
      const sortedQueries = queryResults.slice().sort((a, b) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      });

      setQueries(sortedQueries);
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
