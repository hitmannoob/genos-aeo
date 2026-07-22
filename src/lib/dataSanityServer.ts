import 'server-only';

import { sql } from '@/lib/db/postgres';
import {
  getCanonicalGoogleResult,
  hasProviderContent,
  hasSuccessfulProviderResult,
  type QueryProcessingResult,
} from '@/lib/queryResultUtils';

const DEFAULT_MAX_BRANDS = 20;
const MAX_MAX_BRANDS = 100;
const DEFAULT_MAX_ISSUES = 200;
const MAX_MAX_ISSUES = 1000;
const DEFAULT_MAX_LEDGER_DOCS = 200;
const MAX_MAX_LEDGER_DOCS = 1000;
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
  details?: Record<string, unknown>;
}

export interface DataSanityBrandSummary {
  brandId: string;
  userId?: string;
  companyName?: string;
  domain?: string;
  totalQueryResults: number;
  totalSessions: number;
  providerResultsScanned: number;
  issueCounts: Record<DataSanitySeverity, number>;
}

export interface DataSanityCheckOptions {
  brandId?: string;
  userId?: string;
  maxBrands?: number;
  maxIssues?: number;
  maxLedgerDocs?: number;
  includeProviderResults?: boolean;
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
    includeProviderResults: boolean;
    includeLedger: boolean;
  };
  summary: {
    brandsScanned: number;
    queryResultsScanned: number;
    processingSessionsScanned: number;
    providerResultsScanned: number;
    ledgerDocsScanned: number;
    errors: number;
    warnings: number;
    info: number;
    maxIssuesReached: boolean;
  };
  brands: DataSanityBrandSummary[];
  issues: DataSanityIssue[];
}

interface BrandRow {
  uuid: string;
  public_brand_id: string;
  user_id: string;
  firebase_uid: string;
  company_name: string;
  domain: string;
}

interface QueryRunRow {
  id: string;
  brand_id: string;
  processing_session_id: string;
  processing_session_timestamp: Date | string;
  query: string;
  keyword: string;
  category: string;
  raw_result: QueryProcessingResult | null;
  credit_cost: number;
  credits_after: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  total_provider_cost: number | string;
}

interface ProviderResultRow {
  query_run_id: string;
  provider_key: string;
  status: 'success' | 'error' | 'timeout' | 'skipped' | string;
  response_text: string | null;
  error_message: string | null;
  cost: number | string;
}

interface LedgerReplayResponse {
  persistence?: {
    persisted?: boolean;
  };
  persistedQueryResult?: unknown;
}

interface LedgerRow {
  id: string;
  user_id: string;
  brand_id: string | null;
  firebase_uid: string;
  public_brand_id: string | null;
  client_request_id: string | null;
  status: 'processing' | 'completed' | 'failed' | string;
  lease_expires_at: Date | string | null;
  replay_response: LedgerReplayResponse | null;
  last_error: Record<string, unknown> | null;
  processing_session_id: string | null;
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

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
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

async function loadBrands(options: DataSanityCheckOptions, maxBrands: number): Promise<BrandRow[]> {
  if (options.brandId) {
    const result = await sql<BrandRow>(
      `
        select
          b.id as uuid,
          coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
          b.user_id,
          u.firebase_uid,
          b.company_name,
          b.domain
        from brands b
        join app_users u on u.id = b.user_id
        where b.id::text = $1 or b.legacy_firestore_id = $1
        limit 1
      `,
      [options.brandId]
    );
    return result.rows;
  }

  if (options.userId) {
    const result = await sql<BrandRow>(
      `
        select
          b.id as uuid,
          coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
          b.user_id,
          u.firebase_uid,
          b.company_name,
          b.domain
        from brands b
        join app_users u on u.id = b.user_id
        where u.firebase_uid = $1
        order by b.created_at desc
        limit $2
      `,
      [options.userId, maxBrands]
    );
    return result.rows;
  }

  const result = await sql<BrandRow>(
    `
      select
        b.id as uuid,
        coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
        b.user_id,
        u.firebase_uid,
        b.company_name,
        b.domain
      from brands b
      join app_users u on u.id = b.user_id
      order by b.created_at desc
      limit $1
    `,
    [maxBrands]
  );
  return result.rows;
}

async function loadBrandQueryRuns(brandUuid: string): Promise<QueryRunRow[]> {
  const result = await sql<QueryRunRow>(
    `
      select
        id,
        brand_id,
        processing_session_id,
        processing_session_timestamp,
        query,
        keyword,
        category,
        raw_result,
        credit_cost,
        credits_after,
        created_at,
        updated_at,
        completed_at,
        total_provider_cost
      from query_runs
      where brand_id = $1
      order by created_at desc
    `,
    [brandUuid]
  );
  return result.rows;
}

async function loadBrandProviderResults(brandUuid: string): Promise<ProviderResultRow[]> {
  const result = await sql<ProviderResultRow>(
    `
      select
        pr.query_run_id,
        pr.provider_key,
        pr.status,
        pr.response_text,
        pr.error_message,
        pr.cost
      from provider_results pr
      join query_runs qr on qr.id = pr.query_run_id
      where qr.brand_id = $1
      order by pr.created_at desc
    `,
    [brandUuid]
  );
  return result.rows;
}

function storedProviderKeys(result: QueryProcessingResult): Set<string> {
  const keys = new Set<string>();
  if (result.results.chatgpt) keys.add('chatgptsearch');
  if (result.results.googleAI) keys.add('google-ai-overview');
  if (result.results.gemini) keys.add('google-gemini');
  if (result.results.perplexity) keys.add('perplexity');
  return keys;
}

async function loadLedgerEntries(
  options: DataSanityCheckOptions,
  maxLedgerDocs: number
): Promise<LedgerRow[]> {
  if (options.brandId) {
    const result = await sql<LedgerRow>(
      `
        select
          q.id,
          q.user_id,
          q.brand_id,
          u.firebase_uid,
          coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
          q.client_request_id,
          q.status,
          q.lease_expires_at,
          q.replay_response,
          q.last_error,
          q.processing_session_id
        from query_execution_requests q
        join app_users u on u.id = q.user_id
        left join brands b on b.id = q.brand_id
        where b.id::text = $1 or b.legacy_firestore_id = $1
        order by q.created_at desc
        limit $2
      `,
      [options.brandId, maxLedgerDocs]
    );
    return result.rows;
  }

  if (options.userId) {
    const result = await sql<LedgerRow>(
      `
        select
          q.id,
          q.user_id,
          q.brand_id,
          u.firebase_uid,
          coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
          q.client_request_id,
          q.status,
          q.lease_expires_at,
          q.replay_response,
          q.last_error,
          q.processing_session_id
        from query_execution_requests q
        join app_users u on u.id = q.user_id
        left join brands b on b.id = q.brand_id
        where u.firebase_uid = $1
        order by q.created_at desc
        limit $2
      `,
      [options.userId, maxLedgerDocs]
    );
    return result.rows;
  }

  const result = await sql<LedgerRow>(
    `
      select
        q.id,
        q.user_id,
        q.brand_id,
        u.firebase_uid,
        coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
        q.client_request_id,
        q.status,
        q.lease_expires_at,
        q.replay_response,
        q.last_error,
        q.processing_session_id
      from query_execution_requests q
      join app_users u on u.id = q.user_id
      left join brands b on b.id = q.brand_id
      order by q.created_at desc
      limit $1
    `,
    [maxLedgerDocs]
  );
  return result.rows;
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
  const includeProviderResults = options.includeProviderResults !== false;
  const includeLedger = options.includeLedger !== false;

  const issues: DataSanityIssue[] = [];
  const globalCounts = buildEmptySeverityCounts();
  const brandCounts = new Map<string, Record<DataSanitySeverity, number>>();

  let brandsScanned = 0;
  let queryResultsScanned = 0;
  let processingSessionsScanned = 0;
  let ledgerDocsScanned = 0;
  let providerResultsScanned = 0;
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

  const brands = await loadBrands(options, maxBrands);

  if (options.brandId && brands.length === 0) {
    pushIssue({
      severity: 'error',
      code: 'BRAND_NOT_FOUND',
      message: `Brand ${options.brandId} was not found.`,
      collection: 'brands',
      docId: options.brandId,
      brandId: options.brandId,
    });
  }

  const brandSummaries: DataSanityBrandSummary[] = [];
  const scannedBrandIds = new Set<string>();

  for (const brand of brands) {
    brandsScanned += 1;
    const brandId = brand.public_brand_id;
    scannedBrandIds.add(brandId);

    const brandIssueCounts = brandCounts.get(brandId) || buildEmptySeverityCounts();

    if (!brand.company_name) {
      pushIssue({
        severity: 'warning',
        code: 'BRAND_MISSING_COMPANY_NAME',
        message: 'Brand row is missing companyName.',
        collection: 'brands',
        docId: brandId,
        brandId,
        userId: brand.firebase_uid,
      });
    }

    if (!brand.domain) {
      pushIssue({
        severity: 'warning',
        code: 'BRAND_MISSING_DOMAIN',
        message: 'Brand row is missing domain.',
        collection: 'brands',
        docId: brandId,
        brandId,
        userId: brand.firebase_uid,
      });
    }

    const queryRuns = await loadBrandQueryRuns(brand.uuid);
    const providerResults = includeProviderResults
      ? await loadBrandProviderResults(brand.uuid)
      : [];
    providerResultsScanned += providerResults.length;
    const providerResultsByRun = new Map<string, ProviderResultRow[]>();
    for (const providerResult of providerResults) {
      const rows = providerResultsByRun.get(providerResult.query_run_id) || [];
      rows.push(providerResult);
      providerResultsByRun.set(providerResult.query_run_id, rows);
    }

    const seenQueryIdentities = new Set<string>();
    const sessionResultsMap = new Map<string, QueryProcessingResult[]>();

    for (const run of queryRuns) {
      queryResultsScanned += 1;
      const result = run.raw_result;
      const normalizedProviderResults = providerResultsByRun.get(run.id) || [];

      if (!result) {
        pushIssue({
          severity: 'error',
          code: 'QUERY_RESULT_MISSING_RESULTS',
          message: 'Query run has no stored raw_result payload.',
          collection: 'query_runs',
          docId: run.id,
          brandId,
          userId: brand.firebase_uid,
          processingSessionId: run.processing_session_id,
          details: { query: run.query },
        });
        continue;
      }

      if (includeProviderResults) {
        const expectedProviderKeys = storedProviderKeys(result);
        const normalizedProviderKeys = new Set(
          normalizedProviderResults.map((providerResult) => providerResult.provider_key)
        );
        const missingProviderKeys = Array.from(expectedProviderKeys)
          .filter((providerKey) => !normalizedProviderKeys.has(providerKey));
        const unexpectedProviderKeys = Array.from(normalizedProviderKeys)
          .filter((providerKey) => !expectedProviderKeys.has(providerKey));

        if (missingProviderKeys.length > 0 || unexpectedProviderKeys.length > 0) {
          pushIssue({
            severity: 'warning',
            code: 'PROVIDER_RESULT_SET_MISMATCH',
            message: 'The raw query payload and normalized provider rows do not contain the same providers.',
            collection: 'provider_results',
            docId: run.id,
            brandId,
            userId: brand.firebase_uid,
            processingSessionId: run.processing_session_id,
            details: { missingProviderKeys, unexpectedProviderKeys },
          });
        }

        for (const providerResult of normalizedProviderResults) {
          if (providerResult.status === 'success' && !providerResult.response_text) {
            pushIssue({
              severity: 'warning',
              code: 'PROVIDER_ROW_SUCCESS_WITHOUT_RESPONSE',
              message: `${providerResult.provider_key} is marked successful but has no response text.`,
              collection: 'provider_results',
              docId: run.id,
              brandId,
              userId: brand.firebase_uid,
              processingSessionId: run.processing_session_id,
              details: { providerKey: providerResult.provider_key },
            });
          }
          if (providerResult.status !== 'success' && !providerResult.error_message) {
            pushIssue({
              severity: 'warning',
              code: 'PROVIDER_ROW_FAILURE_WITHOUT_ERROR',
              message: `${providerResult.provider_key} is not successful but has no stored error.`,
              collection: 'provider_results',
              docId: run.id,
              brandId,
              userId: brand.firebase_uid,
              processingSessionId: run.processing_session_id,
              details: { providerKey: providerResult.provider_key, status: providerResult.status },
            });
          }
        }

        const normalizedCost = normalizedProviderResults.reduce(
          (total, providerResult) => total + Number(providerResult.cost || 0),
          0
        );
        const runCost = Number(run.total_provider_cost || 0);
        if (Math.abs(normalizedCost - runCost) > 0.000001) {
          pushIssue({
            severity: 'warning',
            code: 'PROVIDER_COST_MISMATCH',
            message: 'The query-run provider cost does not equal the normalized provider-row total.',
            collection: 'provider_results',
            docId: run.id,
            brandId,
            userId: brand.firebase_uid,
            processingSessionId: run.processing_session_id,
            details: { runCost, normalizedCost },
          });
        }
      }

      if (!isValidIsoString(result.date)) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_INVALID_DATE',
          message: 'Query result has an invalid or missing date.',
          collection: 'query_runs',
          docId: run.id,
          brandId,
          userId: brand.firebase_uid,
          processingSessionId: result.processingSessionId,
          details: { query: result.query, date: result.date },
        });
      }

      if (!result.processingSessionId) {
        pushIssue({
          severity: 'error',
          code: 'QUERY_RESULT_MISSING_SESSION_ID',
          message: 'Query result is missing processingSessionId.',
          collection: 'query_runs',
          docId: run.id,
          brandId,
          userId: brand.firebase_uid,
          details: { query: result.query },
        });
      }

      if (!isValidIsoString(result.processingSessionTimestamp)) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_INVALID_SESSION_TIMESTAMP',
          message: 'Query result has an invalid or missing processingSessionTimestamp.',
          collection: 'query_runs',
          docId: run.id,
          brandId,
          userId: brand.firebase_uid,
          processingSessionId: result.processingSessionId,
          details: {
            query: result.query,
            processingSessionTimestamp: result.processingSessionTimestamp,
          },
        });
      }

      if (!result.query) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_MISSING_QUERY_TEXT',
          message: 'Query result is missing query text.',
          collection: 'query_runs',
          docId: run.id,
          brandId,
          userId: brand.firebase_uid,
          processingSessionId: result.processingSessionId,
        });
      }

      if (!VALID_CATEGORIES.has(result.category || '')) {
        pushIssue({
          severity: 'warning',
          code: 'QUERY_RESULT_INVALID_CATEGORY',
          message: 'Query result has an unexpected category value.',
          collection: 'query_runs',
          docId: run.id,
          brandId,
          userId: brand.firebase_uid,
          processingSessionId: result.processingSessionId,
          details: { query: result.query, category: result.category },
        });
      }

      if (!result.results || Object.keys(result.results).length === 0) {
        pushIssue({
          severity: 'error',
          code: 'QUERY_RESULT_MISSING_RESULTS',
          message: 'Query result has no provider results object.',
          collection: 'query_runs',
          docId: run.id,
          brandId,
          userId: brand.firebase_uid,
          processingSessionId: result.processingSessionId,
          details: { query: result.query },
        });
      } else {
        const identity = buildQueryIdentity(result);
        if (seenQueryIdentities.has(identity)) {
          pushIssue({
            severity: 'warning',
            code: 'QUERY_RESULT_DUPLICATE_IDENTITY',
            message: 'Brand contains duplicate query results for the same session/query identity.',
            collection: 'query_runs',
            docId: run.id,
            brandId,
            userId: brand.firebase_uid,
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
              collection: 'query_runs',
              docId: run.id,
              brandId,
              userId: brand.firebase_uid,
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
              collection: 'query_runs',
              docId: run.id,
              brandId,
              userId: brand.firebase_uid,
              processingSessionId: result.processingSessionId,
              details: { query: result.query, providerId },
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
              collection: 'query_runs',
              docId: run.id,
              brandId,
              userId: brand.firebase_uid,
              processingSessionId: result.processingSessionId,
              details: { query: result.query },
            });
          }

          if (hasAiOverviewFlag === false && hasOverviewText) {
            pushIssue({
              severity: 'warning',
              code: 'GOOGLE_AI_OVERVIEW_FLAG_MISMATCH',
              message: 'Google result has AI overview text, but hasAIOverview is false.',
              collection: 'query_runs',
              docId: run.id,
              brandId,
              userId: brand.firebase_uid,
              processingSessionId: result.processingSessionId,
              details: { query: result.query },
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
            collection: 'query_runs',
            docId: run.id,
            brandId,
            userId: brand.firebase_uid,
            processingSessionId: result.processingSessionId,
            details: { query: result.query },
          });
        }
      }

      if (result.creditInfo) {
        const creditsDeducted = toNumber(result.creditInfo.creditsDeducted);
        const creditsAfter = toNumber(result.creditInfo.creditsAfter);

        if (creditsDeducted !== null && creditsDeducted < 0) {
          pushIssue({
            severity: 'warning',
            code: 'QUERY_RESULT_NEGATIVE_CREDITS',
            message: 'Query result has a negative creditsDeducted value.',
            collection: 'query_runs',
            docId: run.id,
            brandId,
            userId: brand.firebase_uid,
            processingSessionId: result.processingSessionId,
            details: { query: result.query, creditsDeducted },
          });
        }

        if (creditsAfter !== null && creditsAfter < 0) {
          pushIssue({
            severity: 'error',
            code: 'QUERY_RESULT_NEGATIVE_CREDITS_AFTER',
            message: 'Query result has a negative creditsAfter value.',
            collection: 'query_runs',
            docId: run.id,
            brandId,
            userId: brand.firebase_uid,
            processingSessionId: result.processingSessionId,
            details: { query: result.query, creditsAfter },
          });
        }
      }

      if (result.processingSessionId) {
        const existingSessionResults = sessionResultsMap.get(result.processingSessionId) || [];
        existingSessionResults.push(result);
        sessionResultsMap.set(result.processingSessionId, existingSessionResults);
      }
    }

    processingSessionsScanned += sessionResultsMap.size;

    brandSummaries.push({
      brandId,
      userId: brand.firebase_uid,
      companyName: brand.company_name,
      domain: brand.domain,
      totalQueryResults: queryRuns.length,
      totalSessions: sessionResultsMap.size,
      providerResultsScanned: providerResults.length,
      issueCounts: brandCounts.get(brandId) || brandIssueCounts,
    });
  }

  if (includeLedger) {
    const ledgerEntries = await loadLedgerEntries(options, maxLedgerDocs);
    ledgerDocsScanned = ledgerEntries.length;

    for (const entry of ledgerEntries) {
      if (!entry.firebase_uid) {
        pushIssue({
          severity: 'error',
          code: 'LEDGER_MISSING_USER_ID',
          message: 'Query execution request is missing userId.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id || undefined,
        });
      }

      if (!entry.client_request_id) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_MISSING_CLIENT_REQUEST_ID',
          message: 'Query execution request is missing clientRequestId.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id || undefined,
          userId: entry.firebase_uid || undefined,
        });
      }

      if (!entry.status || !['processing', 'completed', 'failed'].includes(entry.status)) {
        pushIssue({
          severity: 'error',
          code: 'LEDGER_INVALID_STATUS',
          message: 'Query execution request has an invalid status.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id || undefined,
          userId: entry.firebase_uid || undefined,
          processingSessionId: entry.processing_session_id || undefined,
          details: { status: entry.status },
        });
        continue;
      }

      const leaseExpiresAtMs = entry.lease_expires_at
        ? new Date(entry.lease_expires_at).getTime()
        : null;

      if (
        entry.status === 'processing' &&
        leaseExpiresAtMs !== null &&
        leaseExpiresAtMs < Date.now()
      ) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_STALE_PROCESSING',
          message: 'Query execution request is still marked processing after its lease expired.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id || undefined,
          userId: entry.firebase_uid || undefined,
          processingSessionId: entry.processing_session_id || undefined,
          details: { leaseExpiresAt: toIsoOrNull(entry.lease_expires_at) },
        });
      }

      if (entry.status === 'completed' && !entry.replay_response) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_COMPLETED_WITHOUT_REPLAY_RESPONSE',
          message: 'Completed query execution request has no replayResponse payload.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id || undefined,
          userId: entry.firebase_uid || undefined,
          processingSessionId: entry.processing_session_id || undefined,
        });
      }

      if (entry.status === 'failed' && !entry.last_error) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_FAILED_WITHOUT_ERROR',
          message: 'Failed query execution request has no lastError payload.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id || undefined,
          userId: entry.firebase_uid || undefined,
          processingSessionId: entry.processing_session_id || undefined,
        });
      }

      if (
        entry.status === 'completed' &&
        entry.replay_response?.persistence?.persisted === true &&
        !entry.replay_response?.persistedQueryResult
      ) {
        pushIssue({
          severity: 'warning',
          code: 'LEDGER_REPLAY_MISSING_PERSISTED_RESULT',
          message: 'Completed persistent execution does not include persistedQueryResult in the replay payload.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id || undefined,
          userId: entry.firebase_uid || undefined,
          processingSessionId: entry.processing_session_id || undefined,
        });
      }

      if (
        entry.public_brand_id &&
        scannedBrandIds.size > 0 &&
        !scannedBrandIds.has(entry.public_brand_id)
      ) {
        pushIssue({
          severity: 'info',
          code: 'LEDGER_OUTSIDE_SCANNED_BRANDS',
          message: 'Ledger document matched the filter set but does not belong to one of the scanned brands.',
          collection: 'query_execution_requests',
          docId: entry.id,
          brandId: entry.public_brand_id,
          userId: entry.firebase_uid || undefined,
          processingSessionId: entry.processing_session_id || undefined,
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
      includeProviderResults,
      includeLedger,
    },
    summary: {
      brandsScanned,
      queryResultsScanned,
      processingSessionsScanned,
      providerResultsScanned,
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
