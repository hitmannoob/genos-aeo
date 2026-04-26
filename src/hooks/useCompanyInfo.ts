import { useState } from 'react';
import { CompanyInfo } from '@/lib/get-company-info';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

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
      console.log('🚀 Fetching company info for domain:', domain);

      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      if (!idToken) {
        throw new Error('Authentication required');
      }
      
      const response = await fetch('/api/get-company-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ domain }),
      });

      const data = await response.json();
      
      console.log('📄 API Response:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get company info');
      }

      if (!data.success) {
        throw new Error(data.error || 'Company info fetch was not successful');
      }

      console.log('✅ Company info fetched successfully:', {
        companyName: data.data.companyName,
        description: data.data.shortDescription?.substring(0, 100) + '...',
        productsCount: data.data.productsAndServices?.length || 0,
        keywordsCount: data.data.keywords?.length || 0,
        website: data.data.website
      });

      setCompanyState({
        loading: false,
        result: data.data,
        error: null,
        metadata: data.metadata,
      });

    } catch (error) {
      console.error('❌ Company info fetch failed:', error);
      
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
