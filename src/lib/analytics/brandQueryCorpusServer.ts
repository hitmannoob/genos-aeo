import 'server-only';

import type { BrandQueryCorpus } from './brandQueryCorpus';
import { getBrandSql } from '@/lib/db/brands';
import type { QueryProcessingResult } from '@/lib/queryResultUtils';
import { logger } from '@/lib/logger';

export type BrandQueryCorpusLoadErrorCode = 'BRAND_NOT_FOUND' | 'DATABASE_ERROR';

export interface BrandQueryCorpusLoadError {
  code: BrandQueryCorpusLoadErrorCode;
  message: string;
}

function sortQueryResultsByDateDesc(results: QueryProcessingResult[]): QueryProcessingResult[] {
  return [...results].sort((left, right) => {
    const leftTime = left.date ? new Date(left.date).getTime() : 0;
    const rightTime = right.date ? new Date(right.date).getTime() : 0;
    return rightTime - leftTime;
  });
}

export async function loadBrandQueryCorpusServer(
  brandId: string,
  userId: string
): Promise<{ result?: BrandQueryCorpus; error?: BrandQueryCorpusLoadError }> {
  try {
    const brand = await getBrandSql(brandId, userId, true);
    if (!brand) {
      return {
        error: {
          code: 'BRAND_NOT_FOUND',
          message: 'Brand not found',
        } satisfies BrandQueryCorpusLoadError,
      };
    }

    const currentResults = sortQueryResultsByDateDesc(
      Array.isArray(brand.queryProcessingResults)
        ? brand.queryProcessingResults
        : []
    );

    const historicalResults: QueryProcessingResult[] = [];

    const allResults = sortQueryResultsByDateDesc([
      ...currentResults,
    ]);

    return {
      result: {
        brand,
        currentResults,
        historicalResults,
        allResults,
      },
    };
  } catch (error) {
    logger.error('Failed to load brand query corpus', error);
    return {
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to load brand query corpus',
      } satisfies BrandQueryCorpusLoadError,
    };
  }
}
