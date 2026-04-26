import type { QueryProcessingResult } from './queryResultUtils';

export interface BrandBasicData {
  brandMentions: number;
  brandMentionsChange: number;
  brandValidity: number;
  brandValidityChange: number;
  lastUpdated: string;
  linkValidity: number;
  linkValidityChange: number;
  sentimentChange: number;
  sentimentScore: number;
}

export interface UserBrand {
  id: string;
  userId: string;
  domain: string;
  website?: string;
  companyName: string;
  shortDescription?: string;
  productsAndServices?: string[];
  keywords?: string[];
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
  brandsbasicData?: BrandBasicData;
  queryProcessingResults?: QueryProcessingResult[];
  lastProcessedAt?: any;
}

export type { QueryProcessingResult } from './queryResultUtils';
