import { useState } from 'react';
import { CompanyInfo } from '@/lib/get-company-info';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import { useAuthContext } from '@/context/AuthContext';

interface CompanyInfoState {
  loading: boolean;
  result: CompanyInfo | null;
  error: string | null;
  metadata: {
    timestamp?: string;
    source?: string;
  } | null;
}

interface UseCompanyInfoReturn {
  companyState: CompanyInfoState;
  getCompanyInfo: (domain: string) => Promise<void>;
  clearCompanyInfo: () => void;
}

export function useCompanyInfo(): UseCompanyInfoReturn {
  const { refreshUserProfile } = useAuthContext();
  const [companyState, setCompanyState] = useState<CompanyInfoState>({
    loading: false,
    result: null,
    error: null,
    metadata: null,
  });

  const getCompanyInfo = async (domain: string) => {
    setCompanyState({
      loading: true,
      result: null,
      error: null,
      metadata: null,
    });

    try {
      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      if (!idToken) {
        throw new Error('Authentication required');
      }
      
      const clientRequestId = crypto.randomUUID();

      const response = await fetch('/api/get-company-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ domain, clientRequestId }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to get company info');
      }

      if (!data.success) {
        throw new Error(data.error || 'Company info fetch was not successful');
      }

      setCompanyState({
        loading: false,
        result: data.data,
        error: null,
        metadata: data.metadata,
      });
      await refreshUserProfile().catch(() => undefined);

    } catch (error) {
      setCompanyState({
        loading: false,
        result: null,
        error: (error as Error).message,
        metadata: null,
      });
    }
  };

  const clearCompanyInfo = () => {
    setCompanyState({
      loading: false,
      result: null,
      error: null,
      metadata: null,
    });
  };

  return {
    companyState,
    getCompanyInfo,
    clearCompanyInfo,
  };
} 
