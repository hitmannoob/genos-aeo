import { createHash } from 'crypto';
import { sql } from '@/lib/db/sqlite';
import type { JobResult } from '@/lib/api-providers/types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let nextCleanupAt = 0;

export function buildProviderResponseCacheKey(args: {
  prompt: string;
  providers: string[];
  purpose?: string;
  variant?: Record<string, unknown>;
}): string {
  // Prompt casing and internal whitespace are semantically relevant (company
  // names and JSON string values are common here), so only trim boundaries.
  const normalizedPrompt = args.prompt.trim();
  const normalizedProviders = [...args.providers].sort().join(',');
  const source = JSON.stringify({
    purpose: args.purpose || 'default',
    prompt: normalizedPrompt,
    providers: normalizedProviders,
    variant: args.variant || {},
  });

  return createHash('sha256').update(source).digest('hex');
}

function serializeJobResult(result: JobResult): unknown {
  return JSON.parse(JSON.stringify(result));
}

async function cleanExpiredCacheRows(): Promise<void> {
  const now = Date.now();
  if (now < nextCleanupAt) return;
  nextCleanupAt = now + CLEANUP_INTERVAL_MS;
  await sql(`
    delete from provider_response_cache
    where cache_key in (
      select cache_key
      from provider_response_cache
      where expires_at < now()
      order by expires_at
      limit 500
    )
  `);
}

export async function getCachedProviderResponse(
  cacheKey: string
): Promise<JobResult | null> {
  await cleanExpiredCacheRows();
  const result = await sql<{ result: JobResult }>(
    `
      select result
      from provider_response_cache
      where cache_key = $1
        and expires_at > now()
      limit 1
    `,
    [cacheKey]
  );

  if (!result.rows[0]) {
    return null;
  }

  return result.rows[0].result;
}

export async function setCachedProviderResponse(
  cacheKey: string,
  result: JobResult,
  ttlMs: number = DEFAULT_TTL_MS,
  purpose = 'default'
): Promise<void> {
  const boundedTtlMs = Number.isFinite(ttlMs)
    ? Math.min(24 * 60 * 60 * 1_000, Math.max(1_000, Math.floor(ttlMs)))
    : DEFAULT_TTL_MS;
  await sql(
    `
      insert into provider_response_cache (
        cache_key,
        purpose,
        prompt_hash,
        providers,
        result,
        expires_at
      )
      values ($1, $2, $1, $3, $4::jsonb, $5)
      on conflict (cache_key) do update set
        purpose = excluded.purpose,
        providers = excluded.providers,
        result = excluded.result,
        expires_at = excluded.expires_at,
        updated_at = now()
    `,
    [
      cacheKey,
      purpose,
      result.results.map((providerResult) => providerResult.providerId),
      JSON.stringify(serializeJobResult(result)),
      new Date(Date.now() + boundedTtlMs),
    ]
  );
}
