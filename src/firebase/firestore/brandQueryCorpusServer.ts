import type { BrandQueryCorpus } from './brandQueryCorpus';
import { getBrandServer } from './getUserBrandsServer';
import { toIsoString } from './timestamps';
import {
  normalizeLegacyAiResponses,
  type QueryProcessingResult,
} from './queryResultUtils';
import { getQueriesByBrandServer } from './userQueriesServer';

function sortQueryResultsByDateDesc(results: QueryProcessingResult[]): QueryProcessingResult[] {
  return [...results].sort((left, right) => {
    const leftTime = left.date ? new Date(left.date).getTime() : 0;
    const rightTime = right.date ? new Date(right.date).getTime() : 0;
    return rightTime - leftTime;
  });
}

function convertHistoricalQuery(query: any): QueryProcessingResult | null {
  if (query?.status !== 'completed' || !Array.isArray(query?.aiResponses) || query.aiResponses.length === 0) {
    return null;
  }

  const fallbackTimestamp =
    toIsoString(query.processedAt) ||
    toIsoString(query.updatedAt) ||
    toIsoString(query.createdAt) ||
    new Date().toISOString();

  return {
    date: fallbackTimestamp,
    processingSessionId:
      query.sessionId ||
      (query.id ? `legacy_${query.id}` : 'legacy_session'),
    processingSessionTimestamp:
      toIsoString(query.processedAt) ||
      toIsoString(query.updatedAt) ||
      toIsoString(query.createdAt) ||
      fallbackTimestamp,
    query:
      query.originalQuery ||
      query.userQuery ||
      query.queryText ||
      'Unknown query',
    keyword: query.keyword || 'unknown',
    category: query.category || 'unknown',
    results: normalizeLegacyAiResponses(query.aiResponses, fallbackTimestamp),
  };
}

export async function loadBrandQueryCorpusServer(
  brandId: string,
  userId: string
): Promise<{ result?: BrandQueryCorpus; error?: any }> {
  try {
    const { result: brand, error } = await getBrandServer(brandId, userId, true);
    if (error || !brand) {
      return { error: error || new Error('Brand not found') };
    }

    const currentResults = sortQueryResultsByDateDesc(
      Array.isArray(brand.queryProcessingResults)
        ? brand.queryProcessingResults
        : []
    );

    let historicalResults: QueryProcessingResult[] = [];

    const { result: historicalQueries, error: historicalError } = await getQueriesByBrandServer(brandId);
    if (historicalError) {
      console.warn('⚠️ Failed to load historical v8userqueries data on server:', historicalError);
    } else {
      historicalResults = sortQueryResultsByDateDesc(
        (historicalQueries || [])
          .map(convertHistoricalQuery)
          .filter((result): result is QueryProcessingResult => result !== null)
      );
    }

    const allResults = sortQueryResultsByDateDesc([
      ...currentResults,
      ...historicalResults,
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
