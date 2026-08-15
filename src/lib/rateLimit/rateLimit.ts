import { createHash } from 'crypto';
import { withTransaction } from '@/lib/db/sqlite';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let nextCleanupAt = 0;

export interface RateLimitArgs {
  bucketId: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function buildDocId(bucketId: string): string {
  return createHash('sha256').update(bucketId).digest('hex');
}

export async function consumeRateLimit(
  args: RateLimitArgs
): Promise<RateLimitResult> {
  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    throw new Error('Rate-limit count must be a positive integer');
  }
  if (!Number.isInteger(args.windowMs) || args.windowMs <= 0) {
    throw new Error('Rate-limit window must be a positive integer');
  }

  const bucketId = buildDocId(args.bucketId);

  return withTransaction(async (client) => {
    const now = Date.now();
    if (now >= nextCleanupAt) {
      nextCleanupAt = now + CLEANUP_INTERVAL_MS;
      await client.query(`
        delete from rate_limit_buckets
        where bucket_id in (
          select bucket_id
          from rate_limit_buckets
          where expires_at < $1
          order by expires_at
          limit 500
        )
      `, [new Date(now - 24 * 60 * 60 * 1_000)]);
    }

    const windowStartAt = new Date(now);
    const expiresAt = new Date(now + args.windowMs);

    const result = await client.query<{
      count: number;
      expires_at: Date | string;
    }>(
      `
        insert into rate_limit_buckets (
          bucket_id,
          count,
          limit_count,
          window_ms,
          window_start_at,
          expires_at
        )
        values ($1, 1, $2, $3, $4, $5)
        on conflict (bucket_id) do update set
          count = case
            when rate_limit_buckets.expires_at <= $4 then 1
            else rate_limit_buckets.count + 1
          end,
          limit_count = excluded.limit_count,
          window_ms = excluded.window_ms,
          window_start_at = case
            when rate_limit_buckets.expires_at <= $4 then $4
            else rate_limit_buckets.window_start_at
          end,
          expires_at = case
            when rate_limit_buckets.expires_at <= $4 then $5
            else rate_limit_buckets.expires_at
          end,
          updated_at = now()
        where rate_limit_buckets.expires_at <= $4
           or rate_limit_buckets.count < excluded.limit_count
        returning count, expires_at
      `,
      [bucketId, args.limit, args.windowMs, windowStartAt, expiresAt]
    );

    const consumed = result.rows[0];
    if (consumed) {
      const count = Number(consumed.count);
      return {
        allowed: true,
        remaining: Math.max(0, args.limit - count),
        retryAfterSeconds: 0,
      };
    }

    const blocked = await client.query<{ expires_at: Date | string }>(
      'select expires_at from rate_limit_buckets where bucket_id = $1',
      [bucketId]
    );
    const expiresAtMs = new Date(blocked.rows[0]?.expires_at ?? Date.now()).getTime();

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000)),
    };
  });
}
