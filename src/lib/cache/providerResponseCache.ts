import { createHash } from 'crypto';
import { sql } from '@/lib/db/postgres';
import type { JobResult } from '@/lib/api-providers/types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function buildProviderResponseCacheKey(args: {
  prompt: string;
  providers: string[];
  purpose?: string;
}): string {
  const normalizedPrompt = args.prompt.trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedProviders = [...args.providers].sort().join(',');
  const source = JSON.stringify({
    purpose: args.purpose || 'default',
    prompt: normalizedPrompt,
    providers: normalizedProviders,
  });

  return createHash('sha256').update(source).digest('hex');
}

function serializeJobResult(result: JobResult): any {
  return JSON.parse(JSON.stringify(result));
}

export async function getCachedProviderResponse(
  cacheKey: string
): Promise<JobResult | null> {
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
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
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
      values ($1, 'default', $1, $2, $3::jsonb, now() + ($4::int * interval '1 millisecond'))
      on conflict (cache_key) do update set
        result = excluded.result,
        expires_at = excluded.expires_at,
        updated_at = now()
    `,
    [
      cacheKey,
      result.results.map((providerResult) => providerResult.providerId),
      JSON.stringify(serializeJobResult(result)),
      ttlMs,
    ]
  );
}
