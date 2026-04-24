'use client'
import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { getUserRecommendations, RecommendationData } from '@/firebase/firestore/dashboardData';

interface UseRecommendationsOptions {
  brandId?: string;
}

interface UseRecommendationsReturn {
  recommendations: RecommendationData[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useRecommendations({ brandId }: UseRecommendationsOptions): UseRecommendationsReturn {
  const { user } = useAuthContext();
  const [recommendations, setRecommendations] = useState<RecommendationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!user?.uid) {
      setRecommendations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { result, error: fetchError } = await getUserRecommendations(user.uid, brandId);
    if (fetchError) {
      setError('Failed to load recommendations');
      setRecommendations([]);
    } else {
      setRecommendations(result || []);
    }
    setLoading(false);
  }, [user?.uid, brandId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { recommendations, loading, error, refetch: fetch };
}
