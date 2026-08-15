import 'server-only';

import { sql, withTransaction, type DatabaseClient } from './sqlite';
import {
  buildQueryResult,
  type QueryProcessingInput,
  type QueryProcessingResult,
  type UserQueryApiResponse,
} from '@/lib/queryResultUtils';
import type { APIResponse, NormalizedCitation } from '@/lib/api-providers/types';
import { isSameOrSubdomain, matchesWord } from '@/lib/competitor-matching';

export interface PersistOneQueryResultServerArgs<TReplayResponse = never> {
  brandId: string;
  userId: string;
  query: QueryProcessingInput;
  processingSessionId: string;
  processingSessionTimestamp: string;
  userQueryResponse: UserQueryApiResponse;
  executionRequestId: string;
  buildExecutionReplayResponse?: (queryResult: QueryProcessingResult) => TReplayResponse;
}

interface BrandIdentity {
  appUserId: string;
  brandUuid: string;
  companyName: string;
  domain: string;
}

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function normalizeCategory(value: unknown): 'Awareness' | 'Interest' | 'Consideration' | 'Purchase' | 'unknown' {
  const category = cleanString(value);
  return ['Awareness', 'Interest', 'Consideration', 'Purchase'].includes(category)
    ? category as 'Awareness' | 'Interest' | 'Consideration' | 'Purchase'
    : 'unknown';
}

function normalizeProviderKey(providerId: string): 'chatgptsearch' | 'google-ai-overview' | 'google-gemini' | 'perplexity' {
  if (providerId === 'googleAI') return 'google-ai-overview';
  if (providerId === 'gemini') return 'google-gemini';
  if (providerId === 'chatgpt') return 'chatgptsearch';
  if (
    providerId === 'chatgptsearch' ||
    providerId === 'google-ai-overview' ||
    providerId === 'google-gemini' ||
    providerId === 'perplexity'
  ) {
    return providerId;
  }
  throw new Error(`Unsupported provider id: ${providerId}`);
}

function getProviderResponseText(result: APIResponse): string | null {
  if (result.providerId === 'chatgptsearch') return result.data?.content || null;
  if (result.providerId === 'perplexity') return result.data?.content || null;
  if (result.providerId === 'google-ai-overview') {
    return result.data?.aiOverview || result.data?.content || null;
  }
  if (result.providerId === 'google-gemini') return result.data?.content || result.data?.text || null;
  return result.data?.content || result.data?.text || null;
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function citationRowsFromProviderResult(result: APIResponse): NormalizedCitation[] {
  if (Array.isArray(result.data?.normalizedCitations)) {
    return result.data.normalizedCitations;
  }
  return [];
}

async function resolveBrand(
  client: DatabaseClient,
  firebaseUid: string,
  brandIdOrLegacyId: string
): Promise<BrandIdentity> {
  const result = await client.query<BrandIdentity>(
    `
      select
        u.id as "appUserId",
        b.id as "brandUuid",
        b.company_name as "companyName",
        b.domain
      from brands b
      join app_users u on u.id = b.user_id
      where u.firebase_uid = $1
        and (b.id::text = $2 or b.legacy_firestore_id = $2)
      limit 1
    `,
    [firebaseUid, brandIdOrLegacyId]
  );

  const brand = result.rows[0];
  if (!brand) {
    throw new Error('Brand not found');
  }

  return brand;
}

async function resolveBrandQueryId(
  client: DatabaseClient,
  brandUuid: string,
  query: QueryProcessingInput
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `
      select id
      from brand_queries
      where brand_id = $1
        and tracked_identity = (
          length($2::text)::text || ':' || $2::text ||
          length($3::text)::text || ':' || $3::text ||
          length($4::text)::text || ':' || $4::text
        )
      limit 1
    `,
    [
      brandUuid,
      query.query,
      cleanString(query.keyword, 'unknown'),
      cleanString(query.category, 'unknown'),
    ]
  );

  return result.rows[0]?.id ?? null;
}

async function insertCitations(args: {
  client: DatabaseClient;
  providerResultId: string;
  queryRunId: string;
  brandUuid: string;
  appUserId: string;
  providerKey: string;
  brandDomain: string;
  companyName: string;
  result: APIResponse;
}): Promise<void> {
  const citations = citationRowsFromProviderResult(args.result);
  const normalizedBrandDomain = normalizeDomain(args.brandDomain);

  for (const [index, citation] of citations.entries()) {
    const domain = normalizeDomain(citation.domain);
    const searchableText = `${citation.title || ''} ${citation.url || ''}`.toLowerCase();

    await args.client.query(
      `
        insert into citations (
          provider_result_id,
          query_run_id,
          brand_id,
          user_id,
          provider_key,
          url,
          domain,
          title,
          citation_text,
          source,
          raw_kind,
          position,
          is_brand_mention,
          is_domain_citation,
          raw_citation
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
      `,
      [
        args.providerResultId,
        args.queryRunId,
        args.brandUuid,
        args.appUserId,
        args.providerKey,
        citation.url,
        domain,
        citation.title || null,
        citation.title || citation.url,
        citation.sourceProvider,
        citation.rawKind,
        index + 1,
        matchesWord(searchableText, args.companyName),
        isSameOrSubdomain(domain, normalizedBrandDomain),
        JSON.stringify(citation),
      ]
    );
  }
}

export async function persistOneQueryResultSql<TReplayResponse = never>(
  args: PersistOneQueryResultServerArgs<TReplayResponse>
): Promise<{
  queryResult: QueryProcessingResult;
  updatedResults: QueryProcessingResult[];
  sessionResults: QueryProcessingResult[];
  executionReplayResponse?: TReplayResponse;
}> {
  const queryResult = buildQueryResult(args);

  return withTransaction(async (client) => {
    const brand = await resolveBrand(client, args.userId, args.brandId);
    const brandQueryId = await resolveBrandQueryId(client, brand.brandUuid, args.query);
    const providerResults = (args.userQueryResponse.results || []) as unknown as APIResponse[];
    const completedAt = new Date();
    const status = providerResults.length > 0
      && providerResults.every((result) => result.status === 'success')
      ? 'completed'
      : 'partial';

    const existingRun = await client.query<{ id: string }>(
      `
        select id
        from query_runs
        where brand_id = $1
          and processing_session_id = $2
          and tracked_identity = (
            length($3::text)::text || ':' || $3::text ||
            length($4::text)::text || ':' || $4::text ||
            length($5::text)::text || ':' || $5::text
          )
        limit 1
      `,
      [
        brand.brandUuid,
        args.processingSessionId,
        args.query.query,
        cleanString(args.query.keyword, 'unknown'),
        cleanString(args.query.category, 'unknown'),
      ]
    );

    let queryRunId = existingRun.rows[0]?.id;
    if (queryRunId) {
      await client.query(
        `
          update query_runs
          set status = $2,
              credit_cost = $3,
              credits_after = $4,
              total_provider_cost = $5,
              raw_result = $6::jsonb,
              completed_at = $7,
              execution_request_id = $8
          where id = $1
        `,
        [
          queryRunId,
          status,
          Number(args.userQueryResponse.userCredits?.deducted ?? 0),
          args.userQueryResponse.userCredits?.after ?? null,
          Number(args.userQueryResponse.totalCost ?? 0),
          JSON.stringify(queryResult),
          completedAt,
          args.executionRequestId,
        ]
      );
    } else {
      const runResult = await client.query<{ id: string }>(
        `
          insert into query_runs (
            user_id,
            brand_id,
            brand_query_id,
            execution_request_id,
            processing_session_id,
            processing_session_timestamp,
            query,
            keyword,
            category,
            source,
            status,
            credit_cost,
            credits_after,
            total_provider_cost,
            raw_result,
            completed_at
          )
          values (
            $1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, 'user-query', $10,
            $11, $12, $13, $14::jsonb, $15
          )
          returning id
        `,
        [
          brand.appUserId,
          brand.brandUuid,
          brandQueryId,
          args.executionRequestId,
          args.processingSessionId,
          args.processingSessionTimestamp,
          args.query.query,
          cleanString(args.query.keyword, 'unknown'),
          normalizeCategory(args.query.category),
          status,
          Number(args.userQueryResponse.userCredits?.deducted ?? 0),
          args.userQueryResponse.userCredits?.after ?? null,
          Number(args.userQueryResponse.totalCost ?? 0),
          JSON.stringify(queryResult),
          completedAt,
        ]
      );
      queryRunId = runResult.rows[0].id;
    }

    await client.query('delete from citations where query_run_id = $1', [queryRunId]);
    await client.query('delete from provider_results where query_run_id = $1', [queryRunId]);

    for (const result of providerResults) {
      const providerKey = normalizeProviderKey(result.providerId);
      const providerResult = await client.query<{ id: string }>(
        `
          insert into provider_results (
            query_run_id,
            provider_key,
            status,
            response_text,
            error_message,
            response_time_ms,
            cost,
            token_count,
            provider_metadata,
            raw_response
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
          returning id
        `,
        [
          queryRunId,
          providerKey,
          result.status,
          getProviderResponseText(result),
          result.error || null,
          Number(result.responseTime ?? 0),
          Number(result.cost ?? 0),
          JSON.stringify(result.data?.usage || result.data?.tokenCount || null),
          JSON.stringify({
            requestId: result.requestId,
            timestamp: result.timestamp,
            cacheHit: result.cacheHit === true,
          }),
          JSON.stringify(result.data || {}),
        ]
      );

      await insertCitations({
        client,
        providerResultId: providerResult.rows[0].id,
        queryRunId,
        brandUuid: brand.brandUuid,
        appUserId: brand.appUserId,
        providerKey,
        brandDomain: brand.domain,
        companyName: brand.companyName,
        result,
      });
    }

    let executionReplayResponse: TReplayResponse | undefined;
    if (args.buildExecutionReplayResponse) {
      executionReplayResponse = args.buildExecutionReplayResponse(queryResult);
      const completion = await client.query(
        `
          update query_execution_requests
          set status = 'completed',
              replay_response = $3::jsonb,
              completed_at = now(),
              lease_expires_at = null,
              last_error = null
          where id = $1
            and user_id = $2
            and status = 'processing'
          returning id
        `,
        [
          args.executionRequestId,
          brand.appUserId,
          JSON.stringify(executionReplayResponse),
        ]
      );
      if (completion.rowCount !== 1) {
        throw new Error('EXECUTION_COMPLETION_FAILED');
      }
    }

    const updatedResults = await getQueryResultsByBrandUuid(brand.brandUuid, client);
    const sessionResults = updatedResults.filter(
      (result) => result.processingSessionId === args.processingSessionId
    );

    return {
      queryResult,
      updatedResults,
      sessionResults,
      ...(executionReplayResponse !== undefined && { executionReplayResponse }),
    };
  });
}

export async function getQueryResultsByBrandUuid(
  brandUuid: string,
  client?: DatabaseClient
): Promise<QueryProcessingResult[]> {
  const query = `
    select raw_result
    from query_runs
    where brand_id = $1
    order by created_at desc
  `;

  const result = client
    ? await client.query<{ raw_result: QueryProcessingResult }>(query, [brandUuid])
    : await sql<{ raw_result: QueryProcessingResult }>(query, [brandUuid]);

  return result.rows
    .map((row) => row.raw_result)
    .filter((row): row is QueryProcessingResult => {
      return !!row && typeof row.query === 'string' && typeof row.processingSessionId === 'string';
    });
}

export async function getQueryResultsByBrandPublicId(
  brandIdOrLegacyId: string,
  firebaseUid: string
): Promise<QueryProcessingResult[]> {
  const result = await sql<{ id: string }>(
    `
      select b.id
      from brands b
      join app_users u on u.id = b.user_id
      where u.firebase_uid = $1
        and (b.id::text = $2 or b.legacy_firestore_id = $2)
      limit 1
    `,
    [firebaseUid, brandIdOrLegacyId]
  );

  const brandUuid = result.rows[0]?.id;
  if (!brandUuid) {
    return [];
  }

  return getQueryResultsByBrandUuid(brandUuid);
}
