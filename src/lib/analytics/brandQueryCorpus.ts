import type { QueryProcessingResult } from '@/lib/queryResultUtils';

export interface BrandQueryCorpus {
  brand: any;
  currentResults: QueryProcessingResult[];
  historicalResults: QueryProcessingResult[];
  allResults: QueryProcessingResult[];
}
