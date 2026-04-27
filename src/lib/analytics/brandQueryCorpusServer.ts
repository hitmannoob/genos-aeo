import 'server-only';

import type { BrandQueryCorpus } from './brandQueryCorpus';
import { getBrandSql } from '@/lib/db/brands';
import type { QueryProcessingResult } from '@/lib/queryResultUtils';

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
): Promise<{ result?: BrandQueryCorpus; error?: any }> {
  try {
    const brand = await getBrandSql(brandId, userId, true);
    if (!brand) {
      return { error: new Error('Brand not found') };
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
        dataTruncated: false,
        currentResults,
        historicalResults,
        allResults,
      },
    };
  } catch (error) {
    console.error('❌ loadBrandQueryCorpusServer failed:', error);
    return { error };
  }
}
