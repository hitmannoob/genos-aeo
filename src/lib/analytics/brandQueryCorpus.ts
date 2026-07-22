import type { QueryProcessingResult } from '@/lib/queryResultUtils';
import type { UserBrand } from '@/types/userBrand';

export interface BrandQueryCorpus {
  brand: UserBrand;
  currentResults: QueryProcessingResult[];
  historicalResults: QueryProcessingResult[];
  allResults: QueryProcessingResult[];
}
