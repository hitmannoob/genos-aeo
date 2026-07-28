import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import type { UserBrand } from '@/types/userBrand';
import { toIsoString } from '@/lib/timestamps';

interface UseUserBrandsReturn {
  brands: UserBrand[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useUserBrands(): UseUserBrandsReturn {
  const { user } = useAuthContext();
  const [brands, setBrands] = useState<UserBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tracks the uid an in-flight fetch was started for. If the local workspace
  // is reset before a slow fetch resolves, discard the stale response.
  const fetchSequenceRef = useRef(0);
  // Tracks whether brands have ever loaded for the local workspace. Refetches
  // run silently (loading stays false) so consumers that gate rendering on
  // `loading` don't unmount their subtree mid-refresh — that was causing
  // QueriesOverview to unmount/remount on every refetchBrands call, which
  // re-fired its child fetches.
  const hasLoadedRef = useRef(false);

  // Reset the "has loaded" flag when the local workspace is reconfigured.
  useEffect(() => {
    fetchSequenceRef.current += 1;
    hasLoadedRef.current = false;
  }, [user?.uid]);

  const fetchBrands = useCallback(async () => {
    const requestUid = user?.uid ?? null;
    const requestSequence = ++fetchSequenceRef.current;

    if (!requestUid) {
      setLoading(false);
      setBrands([]);
      setError(null);
      return;
    }

    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch('/api/brands');

      const payload = await response.json();
      const result = Array.isArray(payload?.brands) ? payload.brands : [];
      const fetchError = !response.ok ? (payload?.error || 'Failed to load brands') : null;

      // If the user changed during the fetch, the response is for a stale
      // identity — drop it so the newer fetch's result wins.
      if (fetchSequenceRef.current !== requestSequence) {
        return;
      }

      if (fetchError) {
        throw new Error(fetchError);
      } else {
        // Sort brands by timestamp (or createdAt) descending (latest first).
        // Normalize defensively so historical timestamp shapes cannot break
        // sorting even though the current API returns ISO strings.
        const sortedBrands = (result as UserBrand[]).slice().sort((a, b) => {
          const aIso = toIsoString(a.createdAt);
          const bIso = toIsoString(b.createdAt);
          const aTime = a.timestamp || (aIso ? new Date(aIso).getTime() : 0);
          const bTime = b.timestamp || (bIso ? new Date(bIso).getTime() : 0);
          return bTime - aTime;
        });
        setBrands(sortedBrands);
        hasLoadedRef.current = true;
      }
    } catch (fetchError) {
      if (fetchSequenceRef.current !== requestSequence) {
        return;
      }
      setError('Failed to load brands. Please try again.');
      if (!hasLoadedRef.current) setBrands([]);
      throw fetchError;
    } finally {
      if (fetchSequenceRef.current === requestSequence) {
        setLoading(false);
      }
    }
  }, [user?.uid]);

  // Initial data fetch
  useEffect(() => {
    void fetchBrands().catch(() => undefined);
  }, [user?.uid, fetchBrands]);

  return {
    brands,
    loading,
    error,
    refetch: fetchBrands
  };
} 
