import { useState } from 'react';
import { APIResponse } from '@/lib/api-providers/types';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

export interface AIQueryResult {
  requestId: string;
  data: any;
  results: APIResponse[];
  totalCost: number;
  completedAt: Date;
  debug?: {
    providersExecuted: string[];
  };
}

export interface AIQueryState {
  loading: boolean;
  result: AIQueryResult | null;
  error: string | null;
}

export function useAIQuery() {
  const [queryState, setQueryState] = useState<AIQueryState>({
    loading: false,
    result: null,
    error: null,
  });

  const executeQuery = async (
    prompt: string,
    providers: string[] = ['chatgptsearch', 'google-gemini'],
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<AIQueryResult | null> => {
    setQueryState(prev => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      console.log('🚀 Executing AI Query:', {
        prompt: prompt.substring(0, 100) + '...',
        providers,
        priority,
      });

      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      if (!idToken) {
        throw new Error('Authentication required');
      }

      const response = await fetch('/api/ai-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          prompt,
          providers,
          priority,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'API query failed');
      }

      const result: AIQueryResult = {
        requestId: data.requestId,
        data: data.data,
        results: data.results,
        totalCost: data.totalCost,
        completedAt: new Date(data.completedAt),
        debug: data.debug,
      };

      console.log('✅ AI Query Completed:', {
        requestId: result.requestId,
        resultsCount: result.results?.length || 0,
        totalCost: result.totalCost,
        providersExecuted: result.debug?.providersExecuted || []
      });

      setQueryState(prev => ({
        ...prev,
        loading: false,
        result,
        error: null,
      }));

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('❌ AI Query Error:', errorMessage);
      
      setQueryState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));

      return null;
    }
  };

  const clearQuery = () => {
    setQueryState({
      loading: false,
      result: null,
      error: null,
    });
  };

  return {
    queryState,
    executeQuery,
    clearQuery,
  };
}
