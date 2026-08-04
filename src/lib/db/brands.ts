import 'server-only';

import { withTransaction, sql } from './postgres';
import type { QueryProcessingResult } from '@/lib/queryResultUtils';
import type { UserBrand } from '@/types/userBrand';
import { getQueryResultsByBrandPublicId } from './queryResults';
import { matchCompetitorsInText } from '@/lib/competitor-matching';
import { logger } from '@/lib/logger';

const VALID_QUERY_CATEGORIES = new Set([
  'Awareness',
  'Interest',
  'Consideration',
  'Purchase',
]);
const MAX_BRAND_KEYWORDS = 20;
const MAX_BRAND_QUERIES = 100;

export type CreateBrandServerResult =
  | { success: true; brandId: string }
  | {
      success: false;
      code: CreateBrandServerErrorCode;
      error: string;
    };

type CreateBrandServerErrorCode =
  | 'USER_NOT_FOUND'
  | 'BRAND_ALREADY_EXISTS'
  | 'TRANSACTION_FAILED';

interface BrandRow {
  id: string;
  user_id: string;
  firebase_uid: string;
  legacy_firestore_id: string | null;
  domain: string;
  website: string | null;
  company_name: string;
  short_description: string | null;
  products_and_services: string[];
  keywords: string[];
  setup_complete: boolean;
  current_step: number;
  ai_analysis: Record<string, unknown> | null;
  raw_metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BrandQueryRow {
  id: string;
  brand_id: string;
  query: string;
  keyword: string;
  category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase' | 'unknown';
  contains_brand: boolean;
  selected: boolean;
  position: number | null;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCategory(value: unknown): 'Awareness' | 'Interest' | 'Consideration' | 'Purchase' | 'unknown' {
  const category = cleanString(value);
  return VALID_QUERY_CATEGORIES.has(category)
    ? category as 'Awareness' | 'Interest' | 'Consideration' | 'Purchase'
    : 'unknown';
}

function publicBrandId(row: Pick<BrandRow, 'id' | 'legacy_firestore_id'>): string {
  return row.legacy_firestore_id || row.id;
}

function normalizeRawMetadata(brandData: Record<string, unknown>): Record<string, unknown> {
  const metadata = { ...brandData };
  delete metadata.createdAt;
  delete metadata.updatedAt;
  delete metadata.queries;
  return metadata;
}

function mapBrandToUserBrand(
  brand: BrandRow,
  queries: BrandQueryRow[],
  queryProcessingResults?: QueryProcessingResult[]
): UserBrand {
  const rawMetadata = brand.raw_metadata || {};
  const id = publicBrandId(brand);

  return {
    ...(rawMetadata as Partial<UserBrand>),
    id,
    userId: brand.firebase_uid,
    domain: brand.domain,
    website: brand.website || undefined,
    companyName: brand.company_name,
    shortDescription: brand.short_description || undefined,
    productsAndServices: brand.products_and_services || [],
    keywords: brand.keywords || [],
    queries: queries.map((query) => ({
      keyword: query.keyword,
      query: query.query,
      category: query.category === 'unknown' ? 'Awareness' : query.category,
      containsBrand: query.contains_brand ? 1 : 0,
      selected: query.selected,
    })),
    createdAt: toIsoString(brand.created_at) || '',
    updatedAt: toIsoString(brand.updated_at),
    timestamp: rawMetadata.timestamp as number | undefined,
    totalQueries: queries.filter((query) => query.selected).length,
    setupComplete: brand.setup_complete,
    currentStep: brand.current_step,
    aiAnalysis: brand.ai_analysis as UserBrand['aiAnalysis'],
    ...(queryProcessingResults && { queryProcessingResults }),
  };
}

async function loadQueryResultsForLegacyBrand(
  brandId: string,
  firebaseUid: string,
  includeQueryResults: boolean
): Promise<QueryProcessingResult[] | undefined> {
  if (!includeQueryResults) {
    return undefined;
  }

  return getQueryResultsByBrandPublicId(brandId, firebaseUid);
}

async function loadBrandQueries(brandIds: string[]): Promise<Map<string, BrandQueryRow[]>> {
  if (brandIds.length === 0) {
    return new Map();
  }

  const result = await sql<BrandQueryRow>(
    `
      select id, brand_id, query, keyword, category, contains_brand, selected, position
      from brand_queries
      where brand_id = any($1::uuid[])
      order by brand_id, position nulls last, created_at
    `,
    [brandIds]
  );

  const byBrandId = new Map<string, BrandQueryRow[]>();
  for (const row of result.rows) {
    const rows = byBrandId.get(row.brand_id) || [];
    rows.push(row);
    byBrandId.set(row.brand_id, rows);
  }

  return byBrandId;
}

export async function getUserBrandsSql(
  firebaseUid: string,
  includeQueryResults = false
): Promise<UserBrand[]> {
  const brandsResult = await sql<BrandRow>(
    `
      select
        b.id,
        b.user_id,
        u.firebase_uid,
        b.legacy_firestore_id,
        b.domain,
        b.website,
        b.company_name,
        b.short_description,
        b.products_and_services,
        b.keywords,
        b.setup_complete,
        b.current_step,
        b.ai_analysis,
        b.raw_metadata,
        b.created_at,
        b.updated_at
      from brands b
      join app_users u on u.id = b.user_id
      where u.firebase_uid = $1
      order by b.created_at desc
    `,
    [firebaseUid]
  );

  const queriesByBrandId = await loadBrandQueries(brandsResult.rows.map((row) => row.id));

  return Promise.all(
    brandsResult.rows.map(async (brand) => {
      const queryResults = await loadQueryResultsForLegacyBrand(
        publicBrandId(brand),
        firebaseUid,
        includeQueryResults
      );
      return mapBrandToUserBrand(
        brand,
        queriesByBrandId.get(brand.id) || [],
        queryResults
      );
    })
  );
}

export async function getBrandSql(
  brandIdOrLegacyId: string,
  firebaseUid: string,
  includeQueryResults = false
): Promise<UserBrand | null> {
  const result = await sql<BrandRow>(
    `
      select
        b.id,
        b.user_id,
        u.firebase_uid,
        b.legacy_firestore_id,
        b.domain,
        b.website,
        b.company_name,
        b.short_description,
        b.products_and_services,
        b.keywords,
        b.setup_complete,
        b.current_step,
        b.ai_analysis,
        b.raw_metadata,
        b.created_at,
        b.updated_at
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
    return null;
  }

  const queriesByBrandId = await loadBrandQueries([brand.id]);
  const queryResults = await loadQueryResultsForLegacyBrand(
    publicBrandId(brand),
    firebaseUid,
    includeQueryResults
  );

  return mapBrandToUserBrand(
    brand,
    queriesByBrandId.get(brand.id) || [],
    queryResults
  );
}

export async function getBrandPublicIdByDomainSql(
  firebaseUid: string,
  domain: string
): Promise<string | null> {
  const result = await sql<{ public_brand_id: string }>(
    `
      select coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id
      from brands b
      join app_users u on u.id = b.user_id
      where u.firebase_uid = $1 and lower(b.domain) = lower($2)
      limit 1
    `,
    [firebaseUid, domain]
  );
  return result.rows[0]?.public_brand_id ?? null;
}

export async function createBrandSql(params: {
  brandId: string;
  firebaseUid: string;
  brandData: Record<string, unknown>;
}): Promise<CreateBrandServerResult> {
  try {
    const result = await withTransaction(async (client) => {
      const userResult = await client.query<{ id: string }>(
        `
          select id
          from app_users
          where firebase_uid = $1
          for update
        `,
        [params.firebaseUid]
      );

      const user = userResult.rows[0];
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      const domain = cleanString(params.brandData.domain);
      const companyName = cleanString(params.brandData.companyName);
      if (!domain || !companyName) {
        throw new Error('TRANSACTION_FAILED');
      }

      const existing = await client.query(
        `
          select 1
          from brands
          where user_id = $1
            and (legacy_firestore_id = $2 or lower(domain) = lower($3))
          limit 1
        `,
        [user.id, params.brandId, domain]
      );

      if (existing.rows[0]) {
        throw new Error('BRAND_ALREADY_EXISTS');
      }

      const brandResult = await client.query<{ id: string }>(
        `
          insert into brands (
            user_id,
            legacy_firestore_id,
            domain,
            website,
            company_name,
            short_description,
            products_and_services,
            keywords,
            setup_complete,
            current_step,
            ai_analysis,
            raw_metadata
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
          returning id
        `,
        [
          user.id,
          params.brandId,
          domain,
          cleanString(params.brandData.website) || null,
          companyName,
          cleanString(params.brandData.shortDescription) || null,
          cleanStringArray(params.brandData.productsAndServices),
          cleanStringArray(params.brandData.keywords),
          params.brandData.setupComplete === true,
          Number(params.brandData.currentStep ?? 3),
          JSON.stringify(params.brandData.aiAnalysis ?? null),
          JSON.stringify(normalizeRawMetadata(params.brandData)),
        ]
      );

      const brandUuid = brandResult.rows[0].id;
      const queries = Array.isArray(params.brandData.queries)
        ? params.brandData.queries
        : [];

      for (const [index, value] of queries.entries()) {
        if (!value || typeof value !== 'object') continue;
        const queryValue = value as Record<string, unknown>;
        const query = cleanString(queryValue.query);
        if (!query) continue;

        await client.query(
          `
            insert into brand_queries (
              brand_id,
              query,
              keyword,
              category,
              contains_brand,
              selected,
              position
            )
            values ($1, $2, $3, $4, $5, $6, $7)
            on conflict (brand_id, tracked_identity) do update set
              contains_brand = excluded.contains_brand,
              selected = excluded.selected,
              position = excluded.position
          `,
          [
            brandUuid,
            query,
            cleanString(queryValue.keyword, 'unknown'),
            normalizeCategory(queryValue.category),
            matchCompetitorsInText(query, [{ name: companyName, domain }]).length > 0,
            queryValue.selected !== false,
            index,
          ]
        );
      }

      return {
        brandId: params.brandId,
      };
    });

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const databaseCode = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
    if (databaseCode === '23505') {
      return {
        success: false,
        code: 'BRAND_ALREADY_EXISTS',
        error: 'BRAND_ALREADY_EXISTS',
      };
    }
    if (
      message === 'USER_NOT_FOUND' ||
      message === 'BRAND_ALREADY_EXISTS'
    ) {
      return {
        success: false,
        code: message as CreateBrandServerErrorCode,
        error: message,
      };
    }

    logger.error('Failed to create brand transaction', error);
    return {
      success: false,
      code: 'TRANSACTION_FAILED',
      error: 'Failed to create brand',
    };
  }
}

export async function addKeywordToBrandSql(
  brandIdOrLegacyId: string,
  firebaseUid: string,
  keyword: string
): Promise<void> {
  const topic = keyword.trim();
  if (!topic) {
    throw new Error('Topic is empty');
  }

  await withTransaction(async (client) => {
    const brandResult = await client.query<{ id: string; keywords: string[] }>(
      `
        select b.id, b.keywords
        from brands b
        join app_users u on u.id = b.user_id
        where u.firebase_uid = $1
          and (b.id::text = $2 or b.legacy_firestore_id = $2)
        for update of b
      `,
      [firebaseUid, brandIdOrLegacyId]
    );

    const brand = brandResult.rows[0];
    if (!brand) {
      throw new Error('Brand not found');
    }

    const existingKeywords = brand.keywords || [];
    const hasKeyword = existingKeywords.some(
      (existing) => existing.toLowerCase() === topic.toLowerCase()
    );

    if (!hasKeyword) {
      if (existingKeywords.length >= MAX_BRAND_KEYWORDS) {
        throw new Error(`A brand can have at most ${MAX_BRAND_KEYWORDS} topics`);
      }
      await client.query(
        `
          update brands
          set keywords = array_append(keywords, $2)
          where id = $1
        `,
        [brand.id, topic]
      );
    }
  });
}

export async function addQueryToBrandSql(args: {
  brandId: string;
  firebaseUid: string;
  rawQuery: string;
  category: string;
  keyword: string;
}): Promise<void> {
  const query = args.rawQuery.trim();
  const topic = args.keyword.trim();
  const category = args.category.trim();

  if (!query) {
    throw new Error('Query is empty');
  }

  if (!topic) {
    throw new Error('Topic is required');
  }

  if (!VALID_QUERY_CATEGORIES.has(category)) {
    throw new Error('Invalid query category');
  }

  await withTransaction(async (client) => {
    const brandResult = await client.query<{
      id: string;
      company_name: string;
      domain: string;
      keywords: string[];
    }>(
      `
        select
          b.id,
          b.company_name,
          b.domain,
          b.keywords
        from brands b
        join app_users u on u.id = b.user_id
        where u.firebase_uid = $1
          and (b.id::text = $2 or b.legacy_firestore_id = $2)
        for update of b
      `,
      [args.firebaseUid, args.brandId]
    );

    const brand = brandResult.rows[0];
    if (!brand) {
      throw new Error('Brand not found');
    }

    const positionResult = await client.query<{ next_position: number }>(
      `
        select coalesce(max(position), -1) + 1 as next_position
        from brand_queries
        where brand_id = $1
      `,
      [brand.id]
    );

    const existingQuery = await client.query(
      `
        select 1 from brand_queries
        where brand_id = $1
          and lower(btrim(query)) = lower(btrim($2))
          and lower(btrim(keyword)) = lower(btrim($3))
          and lower(btrim(category)) = lower(btrim($4))
        limit 1
      `,
      [brand.id, query, topic, category]
    );
    if (existingQuery.rows[0]) {
      throw new Error('Query already exists');
    }

    const queryCountResult = await client.query<{ query_count: number }>(
      'select count(*)::integer as query_count from brand_queries where brand_id = $1',
      [brand.id]
    );
    if (Number(queryCountResult.rows[0]?.query_count ?? 0) >= MAX_BRAND_QUERIES) {
      throw new Error(`A brand can have at most ${MAX_BRAND_QUERIES} queries`);
    }

    const containsBrand = matchCompetitorsInText(
      query,
      [{ name: brand.company_name, domain: brand.domain }]
    ).length > 0;

    await client.query(
      `
        insert into brand_queries (
          brand_id,
          query,
          keyword,
          category,
          contains_brand,
          selected,
          position
        )
        values ($1, $2, $3, $4, $5, true, $6)
        on conflict (brand_id, tracked_identity) do update set
          selected = true,
          contains_brand = excluded.contains_brand,
          position = coalesce(brand_queries.position, excluded.position)
      `,
      [
        brand.id,
        query,
        topic,
        category,
        containsBrand,
        Number(positionResult.rows[0]?.next_position ?? 0),
      ]
    );

    const hasKeyword = (brand.keywords || []).some(
      (existing) => existing.toLowerCase() === topic.toLowerCase()
    );

    if (!hasKeyword) {
      if ((brand.keywords || []).length >= MAX_BRAND_KEYWORDS) {
        throw new Error(`A brand can have at most ${MAX_BRAND_KEYWORDS} topics`);
      }
      await client.query(
        `
          update brands
          set keywords = array_append(keywords, $2)
          where id = $1
        `,
        [brand.id, topic]
      );
    }
  });
}
