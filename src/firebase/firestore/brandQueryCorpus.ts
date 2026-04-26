import {
  loadBrandWithQueryResults,
  type BrandWithResults,
} from './brandWithResults';
import { toIsoString } from './timestamps';
import {
  normalizeLegacyAiResponses,
  type QueryProcessingResult,
} from './queryResultUtils';
import { getQueriesByBrand } from './userQueries';

export interface BrandQueryCorpus {
  brand: any;
  dataTruncated: boolean;
  currentResults: QueryProcessingResult[];
  historicalResults: QueryProcessingResult[];
  allResults: QueryProcessingResult[];
}

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

export async function loadBrandQueryCorpus(
  brandId: string,
  userId: string,
  preloaded?: BrandWithResults
): Promise<{ result?: BrandQueryCorpus; error?: any }> {
  try {
    let brand: any;
    let dataTruncated = false;

    if (preloaded) {
      brand = preloaded.brand;
      dataTruncated = preloaded.dataTruncated;
    } else {
      const loaded = await loadBrandWithQueryResults(brandId);
      brand = loaded.brand;
      dataTruncated = loaded.dataTruncated;
    }

    if (brand.userId !== userId) {
      throw new Error('Unauthorized: brand does not belong to user');
    }

    const currentResults = sortQueryResultsByDateDesc(
      Array.isArray(brand.queryProcessingResults)
        ? brand.queryProcessingResults
        : []
    );

    let historicalResults: QueryProcessingResult[] = [];

    try {
      const { result: historicalQueries, error: historicalError } = await getQueriesByBrand(brandId);
      if (historicalError) {
        throw historicalError;
      }

      historicalResults = sortQueryResultsByDateDesc(
        (historicalQueries || [])
          .map(convertHistoricalQuery)
          .filter((result): result is QueryProcessingResult => result !== null)
      );
    } catch (historicalError) {
      console.warn('⚠️ Failed to load historical v8userqueries data for brand corpus:', historicalError);
    }

    const allResults = sortQueryResultsByDateDesc([
      ...currentResults,
      ...historicalResults,
    ]);

    return {
      result: {
        brand,
        dataTruncated,
        currentResults,
        historicalResults,
        allResults,
      },
    };
  } catch (error) {
    return { error };
  }
}
