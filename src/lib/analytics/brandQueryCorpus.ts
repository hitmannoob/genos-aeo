import type { QueryProcessingResult } from '@/lib/queryResultUtils';

export interface BrandQueryCorpus {
  brand: any;
  dataTruncated: boolean;
  currentResults: QueryProcessingResult[];
  historicalResults: QueryProcessingResult[];
  allResults: QueryProcessingResult[];
}
