import type { QueryProcessingResult } from './queryResultUtils';

export interface BrandQueryCorpus {
  brand: any;
  dataTruncated: boolean;
  currentResults: QueryProcessingResult[];
  historicalResults: QueryProcessingResult[];
  allResults: QueryProcessingResult[];
}
