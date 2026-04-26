import { firestore } from '../firebase-admin';
import {
  calculateCumulativeAnalytics,
  type BrandAnalyticsData,
} from './brandAnalytics';
import { loadBrandQueryResultsServer } from './persistQueryResultServer';
import { toIsoString } from './timestamps';
import {
  getCanonicalGoogleResult,
  hasProviderContent,
  hasSuccessfulProviderResult,
  type QueryProcessingResult,
} from './queryResultUtils';

const DEFAULT_MAX_BRANDS = 20;
const MAX_MAX_BRANDS = 100;
const DEFAULT_MAX_ISSUES = 200;
const MAX_MAX_ISSUES = 1000;
const DEFAULT_MAX_LEDGER_DOCS = 200;
const MAX_MAX_LEDGER_DOCS = 1000;
const ANALYTICS_DOC_LIMIT_PER_BRAND = 500;
const VALID_CATEGORIES = new Set([
  'Awareness',
  'Interest',
  'Consideration',
  'Purchase',
  'unknown',
]);

export type DataSanitySeverity = 'error' | 'warning' | 'info';

export interface DataSanityIssue {
  severity: DataSanitySeverity;
  code: string;
  message: string;
  collection?: string;
  docId?: string;
  brandId?: string;
  userId?: string;
  processingSessionId?: string;
  details?: any;
}

export interface DataSanityBrandSummary {
  brandId: string;
  userId?: string;
  companyName?: string;
  domain?: string;
  totalQueryResults: number;
  totalSessions: number;
  analyticsSessionsFound: number;
  issueCounts: Record<DataSanitySeverity, number>;
}

export interface DataSanityCheckOptions {
  brandId?: string;
  userId?: string;
  maxBrands?: number;
  maxIssues?: number;
  maxLedgerDocs?: number;
  includeAnalytics?: boolean;
  includeLedger?: boolean;
}

export interface DataSanityReport {
  generatedAt: string;
  filters: {
    brandId?: string;
    userId?: string;
    maxBrands: number;
    maxIssues: number;
    maxLedgerDocs: number;
    includeAnalytics: boolean;
    includeLedger: boolean;
  };
  summary: {
    brandsScanned: number;
    queryResultsScanned: number;
    processingSessionsScanned: number;
    analyticsDocsScanned: number;
    ledgerDocsScanned: number;
    errors: number;
    warnings: number;
    info: number;
    maxIssuesReached: boolean;
  };
  brands: DataSanityBrandSummary[];
  issues: DataSanityIssue[];
}

interface LedgerDoc {
  id: string;
  userId?: string | null;
  brandId?: string | null;
  clientRequestId?: string | null;
  status?: 'processing' | 'completed' | 'failed' | string;
  leaseExpiresAtMs?: number;
  replayResponse?: any;
  lastError?: {
    code?: string;
    message?: string;
    httpStatus?: number;
    refundApplied?: boolean;
  } | null;
  processingSessionId?: string | null;
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value as number)));
}

function buildEmptySeverityCounts(): Record<DataSanitySeverity, number> {
  return { error: 0, warning: 0, info: 0 };
}

function isValidIsoString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nearlyEqual(left: number, right: number, tolerance = 0.01): boolean {
  return Math.abs(left - right) <= tolerance;
}

function compareMetric(
  left: unknown,
  right: unknown,
  tolerance = 0.01
): boolean {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);

  if (leftNumber === null || rightNumber === null) {
    return left === right;
  }

  return nearlyEqual(leftNumber, rightNumber, tolerance);
}

function buildQueryIdentity(
  result: Pick<QueryProcessingResult, 'processingSessionId' | 'query' | 'keyword' | 'category'>
): string {
  return [
    result.processingSessionId || '',
    result.query || '',
    result.keyword || '',
    result.category || '',
  ].join('::');
}

function chooseAnalyticsDoc(
  analyticsDocs: Array<BrandAnalyticsData & { id: string }>,
  brandId: string,
  processingSessionId: string
): (BrandAnalyticsData & { id: string }) | undefined {
  return analyticsDocs.find((doc) => doc.id === `${brandId}_${processingSessionId}`) || analyticsDocs[0];
}

function buildAnalyticsMetricSnapshot(doc: BrandAnalyticsData | undefined): Record<string, number | undefined> {
  if (!doc) {
    return {};
  }

  return {
    totalQueriesProcessed: doc.totalQueriesProcessed,
    totalBrandMentions: doc.totalBrandMentions,
    brandVisibilityScore: doc.brandVisibilityScore,
    totalCitations: doc.totalCitations,
    totalDomainCitations: doc.totalDomainCitations,
    chatgptQueriesProcessed: doc.providerStats?.chatgpt?.queriesProcessed,
    chatgptBrandMentions: doc.providerStats?.chatgpt?.brandMentions,
    chatgptCitations: doc.providerStats?.chatgpt?.citations,
    chatgptDomainCitations: doc.providerStats?.chatgpt?.domainCitations,
    googleQueriesProcessed: doc.providerStats?.google?.queriesProcessed,
    googleBrandMentions: doc.providerStats?.google?.brandMentions,
    googleCitations: doc.providerStats?.google?.citations,
    googleDomainCitations: doc.providerStats?.google?.domainCitations,
    perplexityQueriesProcessed: doc.providerStats?.perplexity?.queriesProcessed,
    perplexityBrandMentions: doc.providerStats?.perplexity?.brandMentions,
    perplexityCitations: doc.providerStats?.perplexity?.citations,
    perplexityDomainCitations: doc.providerStats?.perplexity?.domainCitations,
  };
}

export async function runDataSanityChecks(
  options: DataSanityCheckOptions = {}
): Promise<DataSanityReport> {
  const maxBrands = clampInteger(options.maxBrands, DEFAULT_MAX_BRANDS, 1, MAX_MAX_BRANDS);
  const maxIssues = clampInteger(options.maxIssues, DEFAULT_MAX_ISSUES, 1, MAX_MAX_ISSUES);
  const maxLedgerDocs = clampInteger(
    options.maxLedgerDocs,
    DEFAULT_MAX_LEDGER_DOCS,
    1,
    MAX_MAX_LEDGER_DOCS
  );
  const includeAnalytics = options.includeAnalytics !== false;
  const includeLedger = options.includeLedger !== false;

  const issues: DataSanityIssue[] = [];
  const globalCounts = buildEmptySeverityCounts();
  const brandCounts = new Map<string, Record<DataSanitySeverity, number>>();

  let brandsScanned = 0;
  let queryResultsScanned = 0;
  let processingSessionsScanned = 0;
  let analyticsDocsScanned = 0;
  let ledgerDocsScanned = 0;
  let maxIssuesReached = false;

  const pushIssue = (issue: DataSanityIssue) => {
    globalCounts[issue.severity] += 1;

    if (issue.brandId) {
      const existing = brandCounts.get(issue.brandId) || buildEmptySeverityCounts();
      existing[issue.severity] += 1;
      brandCounts.set(issue.brandId, existing);
    }

    if (issues.length < maxIssues) {
      issues.push(issue);
      return;
    }

    maxIssuesReached = true;
  };

  let brandSnapshots:
    | FirebaseFirestore.QueryDocumentSnapshot[]
    | FirebaseFirestore.DocumentSnapshot[] = [];

  if (options.brandId) {
    const brandSnapshot = await firestore.collection('v8userbrands').doc(options.brandId).get();
    brandSnapshots = brandSnapshot.exists ? [brandSnapshot] : [];

    if (!brandSnapshot.exists) {
      pushIssue({
        severity: 'error',
        code: 'BRAND_NOT_FOUND',
        message: `Brand ${options.brandId} was not found.`,
        collection: 'v8userbrands',
        docId: options.brandId,
        brandId: options.brandId,
      });
    }
  } else {
    let brandsQuery: FirebaseFirestore.Query = firestore.collection('v8userbrands').limit(maxBrands);

    if (options.userId) {
      brandsQuery = firestore.collection('v8userbrands').where('userId', '==', options.userId).limit(maxBrands);
    }

    const brandSnapshot = await brandsQuery.get();
    brandSnapshots = brandSnapshot.docs;
  }

  const brandSummaries: DataSanityBrandSummary[] = [];
  const scannedBrandIds = new Set<string>();

  for (const brandSnapshot of brandSnapshots) {
    if (!brandSnapshot.exists) {
      continue;
    }

    brandsScanned += 1;
    const brandId = brandSnapshot.id;
    scannedBrandIds.add(brandId);

    const baseBrandData = brandSnapshot.data() || {};
    const brandIssueCounts = brandCounts.get(brandId) || buildEmptySeverityCounts();

    if (!baseBrandData.userId) {
      pushIssue({
        severity: 'error',
        code: 'BRAND_MISSING_USER_ID',
        message: 'Brand document is missing userId.',
        collection: 'v8userbrands',
        docId: brandId,
        brandId,
      });
    }

    if (!baseBrandData.companyName) {
      pushIssue({
        severity: 'warning',
        code: 'BRAND_MISSING_COMPANY_NAME',
        message: 'Brand document is missing companyName.',
        collection: 'v8userbrands',
        docId: brandId,
        brandId,
        userId: baseBrandData.userId,
      });
    }

    if (!baseBrandData.domain) {
      pushIssue({
        severity: 'warning',
        code: 'BRAND_MISSING_DOMAIN',
        message: 'Brand document is missing domain.',
        collection: 'v8userbrands',
        docId: brandId,
        brandId,
        userId: baseBrandData.userId,
      });
    }

    const storageReference = baseBrandData.storageReferences?.queryProcessingResults;
    if (storageReference && !storageReference.storagePath && !storageReference.downloadUrl) {
      pushIssue({
        severity: 'error',
        code: 'BROKEN_QUERY_RESULTS_STORAGE_REFERENCE',
        message: 'Brand has a queryProcessingResults storage reference without a usable location.',
        collection: 'v8userbrands',
        docId: brandId,
        brandId,
        userId: baseBrandData.userId,
      });
    }

    let loadedBrandData = baseBrandData;
    let queryResults: QueryProcessingResult[] = [];

    try {
      const loaded = await loadBrandQueryResultsServer(brandId);
      loadedBrandData = loaded.brandData || baseBrandData;
      queryResults = loaded.existingResults || [];
    } catch (error) {
      pushIssue({
        severity: 'error',
        code: 'FAILED_TO_LOAD_BRAND_QUERY_RESULTS',
        message: 'Failed to load full brand queryProcessingResults.',
        collection: 'v8userbrands',
        docId: brandId,
        brandId,
        userId: baseBrandData.userId,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    if (storageReference && !Array.isArray(baseBrandData.queryProcessingResults) && queryResults.length === 0) {
      pushIssue({
        severity: 'warning',
        code: 'EMPTY_STORED_QUERY_RESULTS',
        message: 'Brand points at stored queryProcessingResults but no results could be loaded.',
        collection: 'v8userbrands',
        docId: brandId,
        brandId,
        userId: baseBrandData.userId,
      });
    }

    const seenQueryIdentities = new Set<string>();
    const sessionResultsMap = new Map<string, QueryProcessingResult[]>();

    for (const result of queryResults) {
      queryResultsScanned += 1;

      if (!isValidIsoString(result?.date)) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_INVALID_DATE',
          message: 'Query result has an invalid or missing date.',
          collection: 'v8userbrands',
          docId: brandId,
          brandId,
          userId: loadedBrandData.userId,
          processingSessionId: result?.processingSessionId,
          details: {
            query: result?.query,
            date: result?.date,
          },
        });
      }

      if (!result?.processingSessionId) {
        pushIssue({
          severity: 'error',
          code: 'QUERY_RESULT_MISSING_SESSION_ID',
          message: 'Query result is missing processingSessionId.',
          collection: 'v8userbrands',
          docId: brandId,
          brandId,
          userId: loadedBrandData.userId,
          details: {
            query: result?.query,
          },
        });
      }

      if (!isValidIsoString(result?.processingSessionTimestamp)) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_INVALID_SESSION_TIMESTAMP',
          message: 'Query result has an invalid or missing processingSessionTimestamp.',
          collection: 'v8userbrands',
          docId: brandId,
          brandId,
          userId: loadedBrandData.userId,
          processingSessionId: result?.processingSessionId,
          details: {
            query: result?.query,
            processingSessionTimestamp: result?.processingSessionTimestamp,
          },
        });
      }

      if (!result?.query) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_MISSING_QUERY_TEXT',
          message: 'Query result is missing query text.',
          collection: 'v8userbrands',
          docId: brandId,
          brandId,
          userId: loadedBrandData.userId,
          processingSessionId: result?.processingSessionId,
        });
      }

      if (!VALID_CATEGORIES.has(result?.category || '')) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_INVALID_CATEGORY',
          message: 'Query result has an unexpected category value.',
          collection: 'v8userbrands',
          docId: brandId,
          brandId,
          userId: loadedBrandData.userId,
          processingSessionId: result?.processingSessionId,
          details: {
            query: result?.query,
            category: result?.category,
          },
        });
      }

      if (!result?.results || Object.keys(result.results).length === 0) {
        pushIssue({
          severity: 'error',
          code: 'QUERY_RESULT_MISSING_RESULTS',
          message: 'Query result has no provider results object.',
          collection: 'v8userbrands',
          docId: brandId,
          brandId,
          userId: loadedBrandData.userId,
          processingSessionId: result?.processingSessionId,
          details: {
            query: result?.query,
          },
        });
      } else {
        const identity = buildQueryIdentity(result);
        if (seenQueryIdentities.has(identity)) {
          pushIssue({
            severity: 'warning',
            code: 'QUERY_RESULT_DUPLICATE_IDENTITY',
            message: 'Brand contains duplicate query results for the same session/query identity.',
            collection: 'v8userbrands',
            docId: brandId,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId: result.processingSessionId,
            details: {
              query: result.query,
              keyword: result.keyword,
              category: result.category,
            },
          });
        } else {
          seenQueryIdentities.add(identity);
        }

        for (const [providerId, providerResult] of Object.entries(result.results)) {
          if (!providerResult) continue;

          if (!isValidIsoString(providerResult.timestamp)) {
            pushIssue({
              severity: 'warning',
              code: 'PROVIDER_INVALID_TIMESTAMP',
              message: `${providerId} result is missing a valid timestamp.`,
              collection: 'v8userbrands',
              docId: brandId,
              brandId,
              userId: loadedBrandData.userId,
              processingSessionId: result.processingSessionId,
              details: {
                query: result.query,
                providerId,
                timestamp: providerResult.timestamp,
              },
            });
          }

          const hasError = typeof providerResult.error === 'string' && providerResult.error.length > 0;
          if (!hasProviderContent(providerResult) && !hasError) {
            pushIssue({
              severity: 'warning',
              code: 'PROVIDER_EMPTY_RESULT',
              message: `${providerId} result has neither usable content nor an error.`,
              collection: 'v8userbrands',
              docId: brandId,
              brandId,
              userId: loadedBrandData.userId,
              processingSessionId: result.processingSessionId,
              details: {
                query: result.query,
                providerId,
              },
            });
          }
        }

        const googleResult = getCanonicalGoogleResult(result.results);
        if (googleResult) {
          const aiOverview =
            'aiOverview' in googleResult && typeof googleResult.aiOverview === 'string'
              ? googleResult.aiOverview
              : '';
          const hasAiOverviewFlag =
            'hasAIOverview' in googleResult ? googleResult.hasAIOverview : undefined;
          const hasOverviewText = !!aiOverview;

          if (hasAiOverviewFlag === true && !hasOverviewText) {
            pushIssue({
              severity: 'warning',
              code: 'GOOGLE_AI_OVERVIEW_FLAG_MISMATCH',
              message: 'Google result claims an AI overview exists, but no overview text was stored.',
              collection: 'v8userbrands',
              docId: brandId,
              brandId,
              userId: loadedBrandData.userId,
              processingSessionId: result.processingSessionId,
              details: {
                query: result.query,
              },
            });
          }

          if (hasAiOverviewFlag === false && hasOverviewText) {
            pushIssue({
              severity: 'warning',
              code: 'GOOGLE_AI_OVERVIEW_FLAG_MISMATCH',
              message: 'Google result has AI overview text, but hasAIOverview is false.',
              collection: 'v8userbrands',
              docId: brandId,
              brandId,
              userId: loadedBrandData.userId,
              processingSessionId: result.processingSessionId,
              details: {
                query: result.query,
              },
            });
          }
        }

        if (!hasSuccessfulProviderResult(result)) {
          const hasProviderError = Object.values(result.results).some(
            (providerResult) => !!providerResult?.error
          );

          pushIssue({
            severity: hasProviderError ? 'info' : 'warning',
            code: 'QUERY_RESULT_NO_SUCCESSFUL_PROVIDERS',
            message: hasProviderError
              ? 'Query result only contains provider errors.'
              : 'Query result contains provider records, but none have usable content.',
            collection: 'v8userbrands',
            docId: brandId,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId: result.processingSessionId,
            details: {
              query: result.query,
            },
          });
        }
      }

      if (result?.creditInfo) {
        const creditsDeducted = toNumber(result.creditInfo.creditsDeducted);
        const creditsAfter = toNumber(result.creditInfo.creditsAfter);

        if (creditsDeducted !== null && creditsDeducted < 0) {
          pushIssue({
            severity: 'warning',
            code: 'QUERY_RESULT_NEGATIVE_CREDITS',
            message: 'Query result has a negative creditsDeducted value.',
            collection: 'v8userbrands',
            docId: brandId,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId: result.processingSessionId,
            details: {
              query: result.query,
              creditsDeducted,
            },
          });
        }

        if (creditsAfter !== null && creditsAfter < 0) {
          pushIssue({
            severity: 'error',
            code: 'QUERY_RESULT_NEGATIVE_CREDITS_AFTER',
            message: 'Query result has a negative creditsAfter value.',
            collection: 'v8userbrands',
            docId: brandId,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId: result.processingSessionId,
            details: {
              query: result.query,
              creditsAfter,
            },
          });
        }
      }

      if (result?.processingSessionId) {
        const existingSessionResults = sessionResultsMap.get(result.processingSessionId) || [];
        existingSessionResults.push(result);
        sessionResultsMap.set(result.processingSessionId, existingSessionResults);
      }
    }

    processingSessionsScanned += sessionResultsMap.size;

    const lastProcessedAtIso = toIsoString(loadedBrandData.lastProcessedAt);
    if (queryResults.length > 0 && !lastProcessedAtIso) {
      pushIssue({
        severity: 'warning',
        code: 'PROCESSED_BRAND_WITHOUT_LAST_PROCESSED_AT',
        message: 'Brand has queryProcessingResults but no lastProcessedAt timestamp.',
        collection: 'v8userbrands',
        docId: brandId,
        brandId,
        userId: loadedBrandData.userId,
      });
    }

    if (queryResults.length > 0 && lastProcessedAtIso) {
      const parsedResultDates = queryResults
        .map((result) => Date.parse(result.date || ''))
        .filter((value) => !Number.isNaN(value));
      const latestResultMs =
        parsedResultDates.length > 0 ? Math.max(...parsedResultDates) : Number.NaN;
      const lastProcessedAtMs = Date.parse(lastProcessedAtIso);

      if (!Number.isNaN(latestResultMs) && !Number.isNaN(lastProcessedAtMs)) {
        const diffMs = Math.abs(lastProcessedAtMs - latestResultMs);
        if (diffMs > 24 * 60 * 60 * 1000) {
          pushIssue({
            severity: 'warning',
            code: 'LAST_PROCESSED_AT_OUT_OF_SYNC',
            message: 'Brand lastProcessedAt is more than 24 hours away from the most recent query result date.',
            collection: 'v8userbrands',
            docId: brandId,
            brandId,
            userId: loadedBrandData.userId,
            details: {
              lastProcessedAt: lastProcessedAtIso,
              latestResultDate: new Date(latestResultMs).toISOString(),
            },
          });
        }
      }
    }

    let analyticsSessionsFound = 0;

    if (includeAnalytics) {
      const analyticsSnapshot = await firestore
        .collection('v8_user_brand_analytics')
        .where('brandId', '==', brandId)
        .limit(ANALYTICS_DOC_LIMIT_PER_BRAND)
        .get();

      const analyticsDocs = analyticsSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as BrandAnalyticsData),
      }));
      analyticsDocsScanned += analyticsDocs.length;

      const analyticsBySession = new Map<string, Array<BrandAnalyticsData & { id: string }>>();

      for (const analyticsDoc of analyticsDocs) {
        const sessionId = analyticsDoc.processingSessionId || 'missing-session-id';
        const sessionDocs = analyticsBySession.get(sessionId) || [];
        sessionDocs.push(analyticsDoc);
        analyticsBySession.set(sessionId, sessionDocs);

        if (!analyticsDoc.processingSessionId) {
          pushIssue({
            severity: 'error',
            code: 'ANALYTICS_MISSING_SESSION_ID',
            message: 'Brand analytics document is missing processingSessionId.',
            collection: 'v8_user_brand_analytics',
            docId: analyticsDoc.id,
            brandId,
            userId: loadedBrandData.userId,
          });
        }

        if (analyticsDoc.brandVisibilityScore < 0 || analyticsDoc.brandVisibilityScore > 100) {
          pushIssue({
            severity: 'error',
            code: 'ANALYTICS_VISIBILITY_OUT_OF_RANGE',
            message: 'Brand analytics has a visibility score outside 0-100.',
            collection: 'v8_user_brand_analytics',
            docId: analyticsDoc.id,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId: analyticsDoc.processingSessionId,
            details: {
              brandVisibilityScore: analyticsDoc.brandVisibilityScore,
            },
          });
        }

        if (analyticsDoc.totalDomainCitations > analyticsDoc.totalCitations) {
          pushIssue({
            severity: 'error',
            code: 'ANALYTICS_DOMAIN_CITATIONS_EXCEED_TOTAL',
            message: 'Brand analytics has more domain citations than total citations.',
            collection: 'v8_user_brand_analytics',
            docId: analyticsDoc.id,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId: analyticsDoc.processingSessionId,
          });
        }

        if (
          analyticsDoc.userId !== loadedBrandData.userId ||
          analyticsDoc.brandName !== loadedBrandData.companyName ||
          analyticsDoc.brandDomain !== loadedBrandData.domain
        ) {
          pushIssue({
            severity: 'warning',
            code: 'ANALYTICS_BRAND_METADATA_MISMATCH',
            message: 'Brand analytics metadata no longer matches the current brand document.',
            collection: 'v8_user_brand_analytics',
            docId: analyticsDoc.id,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId: analyticsDoc.processingSessionId,
            details: {
              analyticsUserId: analyticsDoc.userId,
              brandUserId: loadedBrandData.userId,
              analyticsBrandName: analyticsDoc.brandName,
              brandName: loadedBrandData.companyName,
              analyticsBrandDomain: analyticsDoc.brandDomain,
              brandDomain: loadedBrandData.domain,
            },
          });
        }
      }

      analyticsSessionsFound = analyticsBySession.size;

      for (const [processingSessionId, sessionResults] of Array.from(sessionResultsMap.entries())) {
        const docsForSession = analyticsBySession.get(processingSessionId) || [];

        if (docsForSession.length === 0) {
          pushIssue({
            severity: 'warning',
            code: 'MISSING_SESSION_ANALYTICS',
            message: 'Processing session has query results but no stored brand analytics document.',
            collection: 'v8_user_brand_analytics',
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId,
          });
          continue;
        }

        if (docsForSession.length > 1) {
          pushIssue({
            severity: 'warning',
            code: 'DUPLICATE_SESSION_ANALYTICS',
            message: 'Multiple brand analytics documents exist for the same processing session.',
            collection: 'v8_user_brand_analytics',
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId,
            details: {
              docIds: docsForSession.map((doc: BrandAnalyticsData & { id: string }) => doc.id),
            },
          });
        }

        const selectedAnalyticsDoc = chooseAnalyticsDoc(docsForSession, brandId, processingSessionId);
        if (!selectedAnalyticsDoc) {
          continue;
        }

        const expectedAnalytics = calculateCumulativeAnalytics(
          loadedBrandData.userId || '',
          brandId,
          loadedBrandData.companyName || '',
          loadedBrandData.domain || '',
          processingSessionId,
          sessionResults[0]?.processingSessionTimestamp || '',
          sessionResults
        );

        const actualMetrics = buildAnalyticsMetricSnapshot(selectedAnalyticsDoc);
        const expectedMetrics = buildAnalyticsMetricSnapshot(expectedAnalytics);

        const mismatchedMetrics = Object.keys(expectedMetrics).filter((metricKey) => {
          return !compareMetric(actualMetrics[metricKey], expectedMetrics[metricKey]);
        });

        if (mismatchedMetrics.length > 0) {
          pushIssue({
            severity: 'warning',
            code: 'ANALYTICS_METRIC_MISMATCH',
            message: 'Stored brand analytics does not match a fresh recalculation from session query results.',
            collection: 'v8_user_brand_analytics',
            docId: selectedAnalyticsDoc.id,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId,
            details: {
              mismatchedMetrics,
              actual: actualMetrics,
              expected: expectedMetrics,
            },
          });
        }

        const sessionQueryCount = sessionResults.length;
        const providerQueryCounts = {
          chatgpt: selectedAnalyticsDoc.providerStats?.chatgpt?.queriesProcessed || 0,
          google: selectedAnalyticsDoc.providerStats?.google?.queriesProcessed || 0,
          perplexity: selectedAnalyticsDoc.providerStats?.perplexity?.queriesProcessed || 0,
        };

        for (const [providerId, queryCount] of Object.entries(providerQueryCounts)) {
          if (queryCount > sessionQueryCount) {
            pushIssue({
              severity: 'warning',
              code: 'ANALYTICS_PROVIDER_QUERIES_EXCEED_SESSION',
              message: `${providerId} providerStats.queriesProcessed exceeds the number of session query results.`,
              collection: 'v8_user_brand_analytics',
              docId: selectedAnalyticsDoc.id,
              brandId,
              userId: loadedBrandData.userId,
              processingSessionId,
              details: {
                providerId,
                queryCount,
                sessionQueryCount,
              },
            });
          }
        }
      }

      for (const [processingSessionId, docsForSession] of Array.from(analyticsBySession.entries())) {
        if (processingSessionId === 'missing-session-id') {
          continue;
        }

        if (!sessionResultsMap.has(processingSessionId)) {
          pushIssue({
            severity: 'info',
            code: 'ORPHAN_ANALYTICS_SESSION',
            message: 'Brand analytics exists for a processing session that has no brand query results.',
            collection: 'v8_user_brand_analytics',
            docId: docsForSession[0]?.id,
            brandId,
            userId: loadedBrandData.userId,
            processingSessionId,
            details: {
              docIds: docsForSession.map((doc: BrandAnalyticsData & { id: string }) => doc.id),
            },
          });
        }
      }
    }

    brandSummaries.push({
      brandId,
      userId: loadedBrandData.userId,
      companyName: loadedBrandData.companyName,
      domain: loadedBrandData.domain,
      totalQueryResults: queryResults.length,
      totalSessions: sessionResultsMap.size,
      analyticsSessionsFound,
      issueCounts: brandCounts.get(brandId) || brandIssueCounts,
    });
  }

  if (includeLedger) {
    let ledgerQuery: FirebaseFirestore.Query = firestore.collection('v8_query_executions');

    if (options.brandId) {
      ledgerQuery = ledgerQuery.where('brandId', '==', options.brandId);
    } else if (options.userId) {
      ledgerQuery = ledgerQuery.where('userId', '==', options.userId);
    }

    const ledgerSnapshot = await ledgerQuery.limit(maxLedgerDocs).get();
    ledgerDocsScanned = ledgerSnapshot.size;

    for (const ledgerDocSnapshot of ledgerSnapshot.docs) {
      const ledgerDoc = {
        id: ledgerDocSnapshot.id,
        ...(ledgerDocSnapshot.data() as Omit<LedgerDoc, 'id'>),
      } as LedgerDoc;

      if (!ledgerDoc.userId) {
        pushIssue({
          severity: 'error',
          code: 'LEDGER_MISSING_USER_ID',
          message: 'Query execution ledger document is missing userId.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId || undefined,
        });
      }

      if (!ledgerDoc.clientRequestId) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_MISSING_CLIENT_REQUEST_ID',
          message: 'Query execution ledger document is missing clientRequestId.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId || undefined,
          userId: ledgerDoc.userId || undefined,
        });
      }

      if (!ledgerDoc.status || !['processing', 'completed', 'failed'].includes(ledgerDoc.status)) {
        pushIssue({
          severity: 'error',
          code: 'LEDGER_INVALID_STATUS',
          message: 'Query execution ledger document has an invalid status.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId || undefined,
          userId: ledgerDoc.userId || undefined,
          processingSessionId: ledgerDoc.processingSessionId || undefined,
          details: {
            status: ledgerDoc.status,
          },
        });
        continue;
      }

      if (
        ledgerDoc.status === 'processing' &&
        typeof ledgerDoc.leaseExpiresAtMs === 'number' &&
        ledgerDoc.leaseExpiresAtMs < Date.now()
      ) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_STALE_PROCESSING',
          message: 'Query execution ledger document is still marked processing after its lease expired.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId || undefined,
          userId: ledgerDoc.userId || undefined,
          processingSessionId: ledgerDoc.processingSessionId || undefined,
          details: {
            leaseExpiresAtMs: ledgerDoc.leaseExpiresAtMs,
          },
        });
      }

      if (ledgerDoc.status === 'completed' && !ledgerDoc.replayResponse) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_COMPLETED_WITHOUT_REPLAY_RESPONSE',
          message: 'Completed query execution ledger document has no replayResponse payload.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId || undefined,
          userId: ledgerDoc.userId || undefined,
          processingSessionId: ledgerDoc.processingSessionId || undefined,
        });
      }

      if (ledgerDoc.status === 'failed' && !ledgerDoc.lastError) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_FAILED_WITHOUT_ERROR',
          message: 'Failed query execution ledger document has no lastError payload.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId || undefined,
          userId: ledgerDoc.userId || undefined,
          processingSessionId: ledgerDoc.processingSessionId || undefined,
        });
      }

      if (
        ledgerDoc.status === 'completed' &&
        ledgerDoc.replayResponse?.persistence?.persisted === true &&
        !ledgerDoc.replayResponse?.persistedQueryResult
      ) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_REPLAY_MISSING_PERSISTED_RESULT',
          message: 'Completed persistent execution does not include persistedQueryResult in the replay payload.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId || undefined,
          userId: ledgerDoc.userId || undefined,
          processingSessionId: ledgerDoc.processingSessionId || undefined,
        });
      }

      if (ledgerDoc.brandId && scannedBrandIds.size > 0 && !scannedBrandIds.has(ledgerDoc.brandId)) {
        pushIssue({
          severity: 'info',
          code: 'LEDGER_OUTSIDE_SCANNED_BRANDS',
          message: 'Ledger document matched the filter set but does not belong to one of the scanned brands.',
          collection: 'v8_query_executions',
          docId: ledgerDoc.id,
          brandId: ledgerDoc.brandId,
          userId: ledgerDoc.userId || undefined,
          processingSessionId: ledgerDoc.processingSessionId || undefined,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      ...(options.brandId && { brandId: options.brandId }),
      ...(options.userId && { userId: options.userId }),
      maxBrands,
      maxIssues,
      maxLedgerDocs,
      includeAnalytics,
      includeLedger,
    },
    summary: {
      brandsScanned,
      queryResultsScanned,
      processingSessionsScanned,
      analyticsDocsScanned,
      ledgerDocsScanned,
      errors: globalCounts.error,
      warnings: globalCounts.warning,
      info: globalCounts.info,
      maxIssuesReached,
    },
    brands: brandSummaries,
    issues,
  };
}
