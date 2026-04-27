import { createHash } from 'crypto';
import { withTransaction } from '@/lib/db/postgres';

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
  const bucketId = buildDocId(args.bucketId);

  return withTransaction(async (client) => {
    const result = await client.query<{
      count: number;
      window_start_at: Date | string;
    }>(
      `
        select count, window_start_at
        from rate_limit_buckets
        where bucket_id = $1
        for update
      `,
      [bucketId]
    );

    const existing = result.rows[0];
    const nowMs = Date.now();
    const windowStartMs = existing
      ? new Date(existing.window_start_at).getTime()
      : 0;
    const currentCount = Number(existing?.count ?? 0);
    const windowExpired = !existing || !windowStartMs || nowMs - windowStartMs >= args.windowMs;

    if (windowExpired) {
      await client.query(
        `
          insert into rate_limit_buckets (
            bucket_id,
            count,
            limit_count,
            window_ms,
            window_start_at,
            expires_at
          )
          values ($1, 1, $2, $3, now(), now() + ($3::int * interval '1 millisecond'))
          on conflict (bucket_id) do update set
            count = 1,
            limit_count = excluded.limit_count,
            window_ms = excluded.window_ms,
            window_start_at = excluded.window_start_at,
            expires_at = excluded.expires_at,
            updated_at = now()
        `,
        [bucketId, args.limit, args.windowMs]
      );

      return {
        allowed: true,
        remaining: Math.max(0, args.limit - 1),
        retryAfterSeconds: 0,
      };
    }

    if (currentCount >= args.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + args.windowMs - nowMs) / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    await client.query(
      `
        update rate_limit_buckets
        set count = count + 1,
            limit_count = $2,
            window_ms = $3,
            expires_at = window_start_at + ($3::int * interval '1 millisecond'),
            updated_at = now()
        where bucket_id = $1
      `,
      [bucketId, args.limit, args.windowMs]
    );

    return {
      allowed: true,
      remaining: Math.max(0, args.limit - currentCount - 1),
      retryAfterSeconds: 0,
    };
  });
}
