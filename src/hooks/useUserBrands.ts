import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import type { UserBrand } from '@/types/userBrand';
import { toIsoString } from '@/lib/timestamps';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

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

  // Tracks the uid an in-flight fetch was started for. If the user changes
  // (signout-then-signin, account switch) before a slow fetch resolves, we
  // discard the late response so it can't overwrite the new user's data.
  const activeFetchUidRef = useRef<string | null>(null);
  // Tracks whether brands have ever loaded for the current user. Refetches
  // run silently (loading stays false) so consumers that gate rendering on
  // `loading` don't unmount their subtree mid-refresh — that was causing
  // QueriesOverview to unmount/remount on every refetchBrands call, which
  // re-fired its child fetches.
  const hasLoadedRef = useRef(false);

  // Reset the "has loaded" flag when the user changes so a new sign-in shows
  // the loading state instead of reusing the previous account's flag.
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [user?.uid]);

  const fetchBrands = useCallback(async () => {
    const requestUid = user?.uid ?? null;
    activeFetchUidRef.current = requestUid;

    console.log('🔍 useUserBrands - fetchBrands called:', {
      userUid: requestUid,
      hasUser: !!user,
      userEmail: user?.email
    });

    if (!requestUid) {
      console.log('⚠️ useUserBrands - No user UID, stopping fetch');
      setLoading(false);
      setBrands([]);
      return;
    }

    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      console.log('🚀 useUserBrands - Calling /api/brands with UID:', requestUid);
      const idToken = await getFirebaseIdTokenWithRetry(3, 500);
      if (!idToken) {
        throw new Error('Failed to get authentication token');
      }

      const response = await fetch('/api/brands', {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      const payload = await response.json();
      const result = Array.isArray(payload?.brands) ? payload.brands : [];
      const fetchError = !response.ok ? (payload?.error || 'Failed to load brands') : null;

      // If the user changed during the fetch, the response is for a stale
      // identity — drop it so the newer fetch's result wins.
      if (activeFetchUidRef.current !== requestUid) {
        console.log('🚫 useUserBrands - Discarding stale response for', requestUid);
        return;
      }

      if (fetchError) {
        console.error('❌ useUserBrands - Error fetching user brands:', fetchError);
        setError('Failed to load brands. Please try again.');
        setBrands([]);
      } else {
        // Sort brands by timestamp (or createdAt) descending (latest first).
        // createdAt may be a Firestore Timestamp (serverTimestamp write), a
        // legacy ISO string, or a Date — normalise through toIsoString so
        // new Date(...).getTime() behaves consistently.
        const sortedBrands = (result || []).slice().sort((a: UserBrand, b: UserBrand) => {
          const aIso = toIsoString((a as any).createdAt);
          const bIso = toIsoString((b as any).createdAt);
          const aTime = (a as any).timestamp || (aIso ? new Date(aIso).getTime() : 0);
          const bTime = (b as any).timestamp || (bIso ? new Date(bIso).getTime() : 0);
          return bTime - aTime;
        });
        console.log('✅ useUserBrands - Successfully fetched brands:', {
          brandsCount: sortedBrands.length,
          brands: sortedBrands.map((brand: UserBrand) => ({ id: brand.id, name: brand.companyName }))
        });
        setBrands(sortedBrands);
        hasLoadedRef.current = true;
      }
    } catch (err) {
      if (activeFetchUidRef.current !== requestUid) {
        return;
      }
      console.error('💥 useUserBrands - Unexpected error fetching brands:', err);
      setError('Failed to load brands. Please try again.');
      setBrands([]);
    } finally {
      if (activeFetchUidRef.current === requestUid) {
        setLoading(false);
      }
    }
  }, [user?.uid]);

  // Initial data fetch
  useEffect(() => {
    fetchBrands();
  }, [user?.uid, fetchBrands]);

  return {
    brands,
    loading,
    error,
    refetch: fetchBrands
  };
} 
