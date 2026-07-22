import { useState } from 'react';
import type { CompanyInfo } from '@/lib/get-company-info';
import type { GeneratedQuery } from '@/lib/queryGeneration';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import { useAuthContext } from '@/context/AuthContext';

interface QueryGenerationResult {
  requestId: string;
  data: GeneratedQuery[];
  sourceProvider: string;
  totalCost: number;
  completedAt: string;
}

interface QueryGenerationState {
  loading: boolean;
  result: QueryGenerationResult | null;
  error: string | null;
}

export function useQueryGeneration() {
  const { refreshUserProfile } = useAuthContext();
  const [queryState, setQueryState] = useState<QueryGenerationState>({
    loading: false,
    result: null,
    error: null,
  });

  const generateQueries = async (company: CompanyInfo): Promise<QueryGenerationResult | null> => {
    setQueryState({ loading: true, result: null, error: null });

    try {
      const idToken = await getFirebaseIdTokenWithRetry(3, 1_000);
      if (!idToken) throw new Error('Authentication required');

      const clientRequestId = crypto.randomUUID();
      const response = await fetch('/api/generate-queries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ company, clientRequestId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate search queries');
      }

      const result: QueryGenerationResult = {
        requestId: data.requestId,
        data: data.data,
        sourceProvider: data.sourceProvider,
        totalCost: data.totalCost,
        completedAt: data.completedAt,
      };
      setQueryState({ loading: false, result, error: null });
      await refreshUserProfile().catch(() => undefined);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate search queries';
      setQueryState({ loading: false, result: null, error: message });
      return null;
    }
  };

  return { queryState, generateQueries };
}
