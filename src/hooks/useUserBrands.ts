import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { getUserBrands, UserBrand } from '@/firebase/firestore/getUserBrands';
import { toIsoString } from '@/firebase/firestore/timestamps';

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

  const fetchBrands = useCallback(async () => {
    console.log('🔍 useUserBrands - fetchBrands called:', { 
      userUid: user?.uid, 
      hasUser: !!user,
      userEmail: user?.email 
    });
    
    if (!user?.uid) {
      console.log('⚠️ useUserBrands - No user UID, stopping fetch');
      setLoading(false);
      setBrands([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('🚀 useUserBrands - Calling getUserBrands with UID:', user.uid);
      const { result, error: fetchError } = await getUserBrands(user.uid);
      
      if (fetchError) {
        console.error('❌ useUserBrands - Error fetching user brands:', fetchError);
        setError('Failed to load brands. Please try again.');
        setBrands([]);
      } else {
        // Sort brands by timestamp (or createdAt) descending (latest first).
        // createdAt may be a Firestore Timestamp (serverTimestamp write), a
        // legacy ISO string, or a Date — normalise through toIsoString so
        // new Date(...).getTime() behaves consistently.
        const sortedBrands = (result || []).slice().sort((a, b) => {
          const aIso = toIsoString((a as any).createdAt);
          const bIso = toIsoString((b as any).createdAt);
          const aTime = (a as any).timestamp || (aIso ? new Date(aIso).getTime() : 0);
          const bTime = (b as any).timestamp || (bIso ? new Date(bIso).getTime() : 0);
          return bTime - aTime;
        });
        console.log('✅ useUserBrands - Successfully fetched brands:', {
          brandsCount: sortedBrands.length,
          brands: sortedBrands.map(b => ({ id: b.id, name: b.companyName }))
        });
        setBrands(sortedBrands);
      }
    } catch (err) {
      console.error('💥 useUserBrands - Unexpected error fetching brands:', err);
      setError('Failed to load brands. Please try again.');
      setBrands([]);
    } finally {
      setLoading(false);
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