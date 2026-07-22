import type { QueryProcessingResult } from '@/lib/queryResultUtils';

export interface UserBrand {
  id: string;
  userId: string;
  domain: string;
  website?: string;
  companyName: string;
  shortDescription?: string;
  productsAndServices?: string[];
  keywords?: string[];
  competitors?: string[];
  queries?: Array<{
    keyword: string;
    query: string;
    category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase';
    containsBrand: 0 | 1;
    selected: boolean;
  }>;
  createdAt: string;
  updatedAt?: string;
  timestamp?: number;
  totalQueries?: number;
  setupComplete?: boolean;
  currentStep?: number;
  queryDistribution?: {
    awareness: number;
    interest: number;
    consideration: number;
    purchase: number;
  };
  aiAnalysis?: {
    providersUsed: string[];
    totalCost: number;
    completedAt: string;
    requestId: string | null;
  } | null;
  queryProcessingResults?: QueryProcessingResult[];
  lastProcessedAt?: unknown;
}

export type { QueryProcessingResult } from '@/lib/queryResultUtils';
