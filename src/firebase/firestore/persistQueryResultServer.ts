import { randomUUID } from 'crypto';
import admin, { adminApp, firestore, FieldValue } from '../firebase-admin';
import { calculateCumulativeAnalytics } from './brandAnalytics';
import {
  buildQueryResult,
  type QueryProcessingInput,
  type QueryProcessingResult,
  type UserQueryApiResponse,
} from './queryResultUtils';

interface StorageReferenceMetadata {
  originalDataType: string;
  compressionUsed?: boolean;
  originalSize?: number;
}

interface StorageReference {
  storageId: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  contentType: string;
  uploadedAt: admin.firestore.FieldValue;
  metadata?: StorageReferenceMetadata;
}

export interface PersistOneQueryResultServerArgs {
  brandId: string;
  userId: string;
  companyName: string;
  brandDomain: string;
  query: QueryProcessingInput;
  processingSessionId: string;
  processingSessionTimestamp: string;
  userQueryResponse: UserQueryApiResponse;
}

const FIRESTORE_SAFETY_LIMIT_BYTES = 800_000;
const FORCE_STORAGE_LIMIT_BYTES = 1_000_000;
const MAX_STORED_RESULTS_CLOUD = 100;
const MAX_STORED_RESULTS_FIRESTORE = 50;
const MAX_STORED_RESULTS_MINIMAL = 20;
const MAX_STORED_RESULTS_FALLBACK = 10;

function filterUndefinedValues<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function serializeSizeInBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function sortResultsByDateDesc(results: QueryProcessingResult[]): QueryProcessingResult[] {
  return [...results].sort((a, b) => {
    const dateA = new Date(b.date || 0).getTime();
    const dateB = new Date(a.date || 0).getTime();
    return dateA - dateB;
  });
}

function buildResultIdentity(result: Pick<QueryProcessingResult, 'processingSessionId' | 'query' | 'keyword' | 'category'>): string {
  return [
    result.processingSessionId,
    result.query,
    result.keyword,
    result.category,
  ].join('::');
}

function mergeQueryResult(
  existingResults: QueryProcessingResult[],
  queryResult: QueryProcessingResult
): QueryProcessingResult[] {
  const queryIdentity = buildResultIdentity(queryResult);
  const filtered = existingResults.filter(
    (existing) => buildResultIdentity(existing) !== queryIdentity
  );
  return sortResultsByDateDesc([...filtered, queryResult]);
}

function truncateResultsForFirestore(results: QueryProcessingResult[]): QueryProcessingResult[] {
  return results.map((result) => ({
    ...result,
    results: {
      ...result.results,
      ...(result.results?.chatgpt && {
        chatgpt: {
          ...result.results.chatgpt,
          response:
            result.results.chatgpt.response?.length > 3000
              ? `${result.results.chatgpt.response.substring(0, 3000)}...[truncated for size]`
              : result.results.chatgpt.response || '',
        },
      }),
      ...(result.results?.gemini && {
        gemini: {
          ...result.results.gemini,
          response:
            result.results.gemini.response?.length > 3000
              ? `${result.results.gemini.response.substring(0, 3000)}...[truncated for size]`
              : result.results.gemini.response || '',
        },
      }),
      ...(result.results?.googleAI && {
        googleAI: {
          ...result.results.googleAI,
          response:
            result.results.googleAI.response?.length > 3000
              ? `${result.results.googleAI.response.substring(0, 3000)}...[truncated for size]`
              : result.results.googleAI.response || '',
          ...(typeof result.results.googleAI.aiOverview === 'string' && {
            aiOverview:
              result.results.googleAI.aiOverview.length > 3000
                ? `${result.results.googleAI.aiOverview.substring(0, 3000)}...[truncated for size]`
                : result.results.googleAI.aiOverview,
          }),
        },
      }),
      ...(result.results?.perplexity && {
        perplexity: {
          ...result.results.perplexity,
          response:
            result.results.perplexity.response?.length > 3000
              ? `${result.results.perplexity.response.substring(0, 3000)}...[truncated for size]`
              : result.results.perplexity.response || '',
        },
      }),
    },
  }));
}

function buildMinimalResults(results: QueryProcessingResult[]): Array<Record<string, any>> {
  return results.slice(0, MAX_STORED_RESULTS_MINIMAL).map((result) => ({
    date: result.date,
    processingSessionId: result.processingSessionId,
    processingSessionTimestamp: result.processingSessionTimestamp,
    query: result.query
      ? `${result.query.substring(0, 100)}${result.query.length > 100 ? '...' : ''}`
      : '',
    keyword: result.keyword,
    category: result.category,
    results: {
      ...(result.results?.chatgpt && {
        chatgpt: {
          timestamp: result.results.chatgpt.timestamp,
          hasContent: !!result.results.chatgpt.response,
        },
      }),
      ...(result.results?.gemini && {
        gemini: {
          timestamp: result.results.gemini.timestamp,
          hasContent: !!result.results.gemini.response,
        },
      }),
      ...(result.results?.googleAI && {
        googleAI: {
          timestamp: result.results.googleAI.timestamp,
          hasContent: !!(result.results.googleAI.aiOverview || result.results.googleAI.response),
        },
      }),
      ...(result.results?.perplexity && {
        perplexity: {
          timestamp: result.results.perplexity.timestamp,
          hasContent: !!result.results.perplexity.response,
        },
      }),
    },
  }));
}

function buildFallbackMinimalResults(results: QueryProcessingResult[]): Array<Record<string, any>> {
  return results.slice(0, MAX_STORED_RESULTS_FALLBACK).map((result) => ({
    date: result.date,
    processingSessionId: result.processingSessionId,
    processingSessionTimestamp: result.processingSessionTimestamp,
    query: result.query || '',
    keyword: result.keyword || '',
    category: result.category || '',
    results: {
      ...(result.results?.chatgpt && {
        chatgpt: {
          timestamp: result.results.chatgpt.timestamp,
          error: result.results.chatgpt.error,
        },
      }),
      ...(result.results?.gemini && {
        gemini: {
          timestamp: result.results.gemini.timestamp,
          error: result.results.gemini.error,
        },
      }),
      ...(result.results?.googleAI && {
        googleAI: {
          timestamp: result.results.googleAI.timestamp,
          error: result.results.googleAI.error,
        },
      }),
      ...(result.results?.perplexity && {
        perplexity: {
          timestamp: result.results.perplexity.timestamp,
          error: result.results.perplexity.error,
        },
      }),
    },
  }));
}

function getStorageBucketName(): string | undefined {
  return (
    (adminApp.options.storageBucket as string | undefined) ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  );
}

function buildDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function deleteStoredQueryResultsFile(storagePath: string | undefined): Promise<void> {
  const bucketName = getStorageBucketName();
  if (!storagePath || !bucketName) return;

  try {
    await admin.storage().bucket(bucketName).file(storagePath).delete({ ignoreNotFound: true });
  } catch (error) {
    console.warn('⚠️ Failed to delete old queryProcessingResults storage file:', error);
  }
}

async function readStoredQueryResults(storageReference: any): Promise<QueryProcessingResult[]> {
  if (!storageReference) return [];

  try {
    const storagePath = storageReference.storagePath;
    const bucketName = getStorageBucketName();

    if (storagePath && bucketName) {
      const file = admin.storage().bucket(bucketName).file(storagePath);
      const [exists] = await file.exists();
      if (exists) {
        const [buffer] = await file.download();
        const parsed = JSON.parse(buffer.toString('utf8'));
        return Array.isArray(parsed) ? parsed : [];
      }
    }

    if (storageReference.downloadUrl) {
      const response = await fetch(storageReference.downloadUrl);
      if (response.ok) {
        const parsed = await response.json();
        return Array.isArray(parsed) ? parsed : [];
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to read queryProcessingResults from storage reference:', error);
  }

  return [];
}

async function saveDetailedQueryResultServer(
  brandId: string,
  userId: string,
  brandName: string,
  queryResult: QueryProcessingResult
): Promise<void> {
  const docRef = firestore.collection('v8detailed_query_results').doc();
  const detailedResult = {
    userId,
    brandId,
    brandName,
    processingSessionId: queryResult.processingSessionId,
    processingSessionTimestamp: queryResult.processingSessionTimestamp,
    query: queryResult.query,
    keyword: queryResult.keyword,
    category: queryResult.category,
    date: queryResult.date,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(queryResult.results?.chatgpt && {
      chatgptResult: filterUndefinedValues({
        response: queryResult.results.chatgpt.response,
        error: queryResult.results.chatgpt.error,
        timestamp: queryResult.results.chatgpt.timestamp,
        responseTime: queryResult.results.chatgpt.responseTime,
        webSearchUsed: queryResult.results.chatgpt.webSearchUsed,
        citations: queryResult.results.chatgpt.citations,
      }),
    }),
    ...(queryResult.results?.googleAI && {
      googleAIResult: filterUndefinedValues({
        response: queryResult.results.googleAI.response,
        error: queryResult.results.googleAI.error,
        timestamp: queryResult.results.googleAI.timestamp,
        responseTime: queryResult.results.googleAI.responseTime,
        totalItems: queryResult.results.googleAI.totalItems,
        organicResults: queryResult.results.googleAI.organicResults,
        peopleAlsoAsk: queryResult.results.googleAI.peopleAlsoAsk,
        location: queryResult.results.googleAI.location,
        aiOverview: queryResult.results.googleAI.aiOverview,
        aiOverviewReferencesCount: queryResult.results.googleAI.aiOverviewReferencesCount,
        hasAIOverview: queryResult.results.googleAI.hasAIOverview,
        serpFeaturesCount: queryResult.results.googleAI.serpFeaturesCount,
        relatedSearchesCount: queryResult.results.googleAI.relatedSearchesCount,
        videoResultsCount: queryResult.results.googleAI.videoResultsCount,
      }),
    }),
    ...(queryResult.results?.perplexity && {
      perplexityResult: filterUndefinedValues({
        response: queryResult.results.perplexity.response,
        error: queryResult.results.perplexity.error,
        timestamp: queryResult.results.perplexity.timestamp,
        responseTime: queryResult.results.perplexity.responseTime,
        citations: queryResult.results.perplexity.citations,
        realTimeData: queryResult.results.perplexity.realTimeData,
        citationsData: queryResult.results.perplexity.citationsData,
        searchResultsData: queryResult.results.perplexity.searchResultsData,
        structuredCitationsData: queryResult.results.perplexity.structuredCitationsData,
        citationsCount: queryResult.results.perplexity.citationsCount,
        searchResultsCount: queryResult.results.perplexity.searchResultsCount,
        structuredCitationsCount: queryResult.results.perplexity.structuredCitationsCount,
        hasMetadata: queryResult.results.perplexity.hasMetadata,
        hasUsageStats: queryResult.results.perplexity.hasUsageStats,
      }),
    }),
  };

  await docRef.set(detailedResult);
}

async function loadBrandQueryResults(
  brandRef: FirebaseFirestore.DocumentReference
): Promise<{
  brandData: FirebaseFirestore.DocumentData;
  existingResults: QueryProcessingResult[];
}> {
  const brandSnapshot = await brandRef.get();
  if (!brandSnapshot.exists) {
    throw new Error('Brand not found');
  }

  const brandData = brandSnapshot.data() || {};
  const storageReference = brandData.storageReferences?.queryProcessingResults;
  const storedResults = storageReference
    ? await readStoredQueryResults(storageReference)
    : [];
  const existingResults = storedResults.length > 0
    ? storedResults
    : (Array.isArray(brandData.queryProcessingResults)
      ? brandData.queryProcessingResults
      : []);

  return { brandData, existingResults };
}

export async function loadBrandQueryResultsServer(
  brandId: string
): Promise<{
  brandData: FirebaseFirestore.DocumentData;
  existingResults: QueryProcessingResult[];
}> {
  const brandRef = firestore.collection('v8userbrands').doc(brandId);
  return loadBrandQueryResults(brandRef);
}

async function saveQueryResultsToBrand(
  brandRef: FirebaseFirestore.DocumentReference,
  brandData: FirebaseFirestore.DocumentData,
  updatedResults: QueryProcessingResult[]
): Promise<void> {
  const sortedResults = sortResultsByDateDesc(updatedResults);
  const oldStoragePath = brandData.storageReferences?.queryProcessingResults?.storagePath as string | undefined;

  const fullDataSize = serializeSizeInBytes({
    queryProcessingResults: sortedResults,
    lastProcessedAt: new Date().toISOString(),
  });
  const shouldUseCloudStorage =
    fullDataSize > FIRESTORE_SAFETY_LIMIT_BYTES || fullDataSize > FORCE_STORAGE_LIMIT_BYTES;

  if (shouldUseCloudStorage) {
    const limitedResults = sortedResults.slice(0, MAX_STORED_RESULTS_CLOUD);
    const serialized = JSON.stringify(limitedResults);
    const storagePath = `v8userbrands/${brandRef.id}/queryProcessingResults/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    const bucketName = getStorageBucketName();

    if (!bucketName) {
      throw new Error('Cloud Storage bucket is not configured');
    }

    const token = randomUUID();
    await admin.storage().bucket(bucketName).file(storagePath).save(serialized, {
      contentType: 'application/json',
      metadata: {
        metadata: {
          dataType: 'queryProcessingResults',
          documentId: brandRef.id,
          fieldName: 'queryProcessingResults',
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const storageReference: StorageReference = {
      storageId: storagePath.split('/').pop()?.replace(/\.json$/, '') || randomUUID(),
      storagePath,
      downloadUrl: buildDownloadUrl(bucketName, storagePath, token),
      size: serializeSizeInBytes(limitedResults),
      contentType: 'application/json',
      uploadedAt: FieldValue.serverTimestamp(),
      metadata: {
        originalDataType: 'queryProcessingResults',
        originalSize: serializeSizeInBytes(sortedResults),
        compressionUsed: false,
      },
    };

    await brandRef.set({
      queryProcessingResults: FieldValue.delete(),
      storageReferences: {
        ...(brandData.storageReferences || {}),
        queryProcessingResults: storageReference,
      },
      lastProcessedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (oldStoragePath && oldStoragePath !== storagePath) {
      await deleteStoredQueryResultsFile(oldStoragePath);
    }

    return;
  }

  const limitedResults = sortedResults.slice(0, MAX_STORED_RESULTS_FIRESTORE);
  const truncatedResults = truncateResultsForFirestore(limitedResults);
  const truncatedPayload = {
    queryProcessingResults: truncatedResults,
    lastProcessedAt: new Date().toISOString(),
  };

  const firestorePayload =
    serializeSizeInBytes(truncatedPayload) > FIRESTORE_SAFETY_LIMIT_BYTES
      ? buildMinimalResults(truncatedResults)
      : truncatedResults;

  try {
    await brandRef.set({
      queryProcessingResults: firestorePayload,
      lastProcessedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (brandData.storageReferences?.queryProcessingResults) {
      await brandRef.update({
        'storageReferences.queryProcessingResults': FieldValue.delete(),
      });
      await deleteStoredQueryResultsFile(oldStoragePath);
    }
  } catch (error) {
    console.warn('⚠️ Full Firestore save failed, retrying with fallback minimal query results:', error);
    await brandRef.set({
      queryProcessingResults: buildFallbackMinimalResults(sortedResults),
      lastProcessedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      largeDataStorageError: true,
      largeDataNote: 'Full query results stored in Cloud Storage due to size constraints',
    }, { merge: true });

    if (brandData.storageReferences?.queryProcessingResults) {
      await brandRef.update({
        'storageReferences.queryProcessingResults': FieldValue.delete(),
      });
      await deleteStoredQueryResultsFile(oldStoragePath);
    }
  }
}

async function saveSessionAnalytics(
  args: PersistOneQueryResultServerArgs,
  sessionResults: QueryProcessingResult[]
): Promise<void> {
  const analytics = calculateCumulativeAnalytics(
    args.userId,
    args.brandId,
    args.companyName,
    args.brandDomain,
    args.processingSessionId,
    args.processingSessionTimestamp,
    sessionResults
  ) as Record<string, any>;

  const { createdAt: _createdAt, lastUpdated: _lastUpdated, ...analyticsData } = analytics;
  const docRef = firestore
    .collection('v8_user_brand_analytics')
    .doc(`${args.brandId}_${args.processingSessionId}`);

  await docRef.set({
    ...analyticsData,
    createdAt: FieldValue.serverTimestamp(),
    lastUpdated: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function persistOneQueryResultServer(
  args: PersistOneQueryResultServerArgs
): Promise<{
  queryResult: QueryProcessingResult;
  updatedResults: QueryProcessingResult[];
  sessionResults: QueryProcessingResult[];
}> {
  const brandRef = firestore.collection('v8userbrands').doc(args.brandId);
  const { brandData, existingResults } = await loadBrandQueryResults(brandRef);

  if (brandData.userId !== args.userId) {
    throw new Error('Unauthorized: brand does not belong to user');
  }

  const resolvedCompanyName = brandData.companyName || args.companyName;
  const resolvedBrandDomain = brandData.domain || args.brandDomain;
  const queryResult = buildQueryResult(args);
  const updatedResults = mergeQueryResult(existingResults, queryResult);
  const sessionResults = updatedResults.filter(
    (result) => result.processingSessionId === args.processingSessionId
  );

  await saveDetailedQueryResultServer(
    args.brandId,
    args.userId,
    resolvedCompanyName,
    queryResult
  );
  await saveQueryResultsToBrand(brandRef, brandData, updatedResults);
  await saveSessionAnalytics({
    ...args,
    companyName: resolvedCompanyName,
    brandDomain: resolvedBrandDomain,
  }, sessionResults);

  return { queryResult, updatedResults, sessionResults };
}
