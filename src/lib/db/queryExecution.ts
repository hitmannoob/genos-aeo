import 'server-only';

import { createHash } from 'crypto';
import { withTransaction } from './sqlite';

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

export interface QueryExecutionIdentity {
  userId: string;
  brandId?: string;
  clientRequestId: string;
}

export interface AcquireQueryExecutionArgs extends QueryExecutionIdentity {
  requestFingerprintSource: {
    query: string;
    persistResult?: boolean;
    brandId?: string;
    keyword?: string;
    category?: string;
    processingSessionId?: string;
    processingSessionTimestamp?: string;
  };
}

export type AcquireQueryExecutionResult<TResponse> =
  | { status: 'acquired'; docId: string }
  | { status: 'replay'; docId: string; response: TResponse }
  | { status: 'in_progress'; docId: string; retryAfterSeconds: number }
  | {
      status: 'previous_failure';
      docId: string;
      failure: {
        code: string;
        message: string;
        httpStatus: number;
        refundApplied?: boolean;
      };
    }
  | { status: 'conflict'; docId: string; message: string };

export interface CompleteQueryExecutionArgs<TResponse> extends QueryExecutionIdentity {
  replayResponse: TResponse;
}

export interface FailQueryExecutionArgs extends QueryExecutionIdentity {
  code: string;
  message: string;
  httpStatus: number;
  refundApplied?: boolean;
}

function buildRequestFingerprint(source: AcquireQueryExecutionArgs['requestFingerprintSource']): string {
  return createHash('sha256')
    .update(JSON.stringify({
      query: source.query,
      persistResult: !!source.persistResult,
      brandId: source.brandId || '',
      keyword: source.keyword || '',
      category: source.category || '',
      processingSessionId: source.processingSessionId || '',
      processingSessionTimestamp: source.processingSessionTimestamp || '',
    }))
    .digest('hex');
}

async function resolveIdentity(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  identity: QueryExecutionIdentity
): Promise<{ appUserId: string; brandUuid: string | null }> {
  const userResult = await client.query<{ id: string }>(
    'select id from app_users where firebase_uid = $1 limit 1',
    [identity.userId]
  );

  const appUser = userResult.rows[0];
  if (!appUser) {
    throw new Error('USER_NOT_FOUND');
  }

  if (!identity.brandId) {
    return { appUserId: appUser.id, brandUuid: null };
  }

  const brandResult = await client.query<{ id: string }>(
    `
      select id
      from brands
      where user_id = $1
        and (id::text = $2 or legacy_firestore_id = $2)
      limit 1
    `,
    [appUser.id, identity.brandId]
  );

  if (!brandResult.rows[0]) {
    throw new Error('Brand not found');
  }

  return {
    appUserId: appUser.id,
    brandUuid: brandResult.rows[0].id,
  };
}

export async function acquireQueryExecution<TResponse>(
  args: AcquireQueryExecutionArgs
): Promise<AcquireQueryExecutionResult<TResponse>> {
  const requestFingerprint = buildRequestFingerprint(args.requestFingerprintSource);
  const leaseExpiresAt = new Date(Date.now() + PROCESSING_LEASE_MS);

  return withTransaction(async (client) => {
    const { appUserId, brandUuid } = await resolveIdentity(client, args);

    // BEGIN IMMEDIATE in the SQLite transaction adapter serializes the
    // first-time check/insert path, including when no idempotency row exists.

    const existingResult = await client.query<{
      id: string;
      request_fingerprint: string;
      status: 'processing' | 'completed' | 'failed';
      replay_response: TResponse | null;
      lease_expires_at: Date | string | null;
      last_error: {
        code?: unknown;
        message?: unknown;
        httpStatus?: unknown;
        refundApplied?: unknown;
      } | null;
    }>(
      `
        select id, request_fingerprint, status, replay_response, lease_expires_at, last_error
        from query_execution_requests
        where user_id = $1
          and coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          and client_request_id = $3
        for update
      `,
      [appUserId, brandUuid, args.clientRequestId]
    );

    const existing = existingResult.rows[0];
    if (!existing) {
      const created = await client.query<{ id: string }>(
        `
          insert into query_execution_requests (
            user_id,
            brand_id,
            client_request_id,
            request_fingerprint,
            status,
            processing_session_id,
            processing_session_timestamp,
            query_preview,
            lease_expires_at
          )
          values ($1, $2, $3, $4, 'processing', $5, $6::timestamptz, $7, $8)
          returning id
        `,
        [
          appUserId,
          brandUuid,
          args.clientRequestId,
          requestFingerprint,
          args.requestFingerprintSource.processingSessionId || null,
          args.requestFingerprintSource.processingSessionTimestamp || null,
          args.requestFingerprintSource.query.substring(0, 200),
          leaseExpiresAt,
        ]
      );

      return { status: 'acquired', docId: created.rows[0].id };
    }

    if (existing.request_fingerprint !== requestFingerprint) {
      return {
        status: 'conflict',
        docId: existing.id,
        message: 'This clientRequestId has already been used for a different request payload.',
      };
    }

    if (existing.status === 'completed') {
      if (existing.replay_response !== null) {
        return { status: 'replay', docId: existing.id, response: existing.replay_response };
      }
      return {
        status: 'conflict',
        docId: existing.id,
        message: 'This request already completed, but no replay response is available.',
      };
    }

    // A failed execution is terminal for its idempotency key. Reacquiring it
    // after a compensating refund would let the same debit key replay without
    // deducting credits again, effectively making the retry free.
    if (existing.status === 'failed') {
      const lastError = existing.last_error;
      return {
        status: 'previous_failure',
        docId: existing.id,
        failure: {
          code: typeof lastError?.code === 'string'
            ? lastError.code
            : 'REQUEST_PREVIOUSLY_FAILED',
          message: typeof lastError?.message === 'string'
            ? lastError.message
            : 'This request previously failed. Start a new attempt with a new clientRequestId.',
          httpStatus: typeof lastError?.httpStatus === 'number'
            ? lastError.httpStatus
            : 409,
          ...(typeof lastError?.refundApplied === 'boolean' && {
            refundApplied: lastError.refundApplied,
          }),
        },
      };
    }

    if (existing.status === 'processing' && existing.lease_expires_at) {
      const expiresAt = new Date(existing.lease_expires_at).getTime();
      if (expiresAt > Date.now()) {
        return {
          status: 'in_progress',
          docId: existing.id,
          retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
        };
      }
    }

    await client.query(
      `
        update query_execution_requests
        set status = 'processing',
            lease_expires_at = $2,
            attempt_count = attempt_count + 1,
            last_error = null,
            failed_at = null,
            completed_at = null,
            started_at = now()
        where id = $1
      `,
      [existing.id, leaseExpiresAt]
    );

    return { status: 'acquired', docId: existing.id };
  });
}

export async function completeQueryExecution<TResponse>(
  args: CompleteQueryExecutionArgs<TResponse>
): Promise<void> {
  await withTransaction(async (client) => {
    const { appUserId, brandUuid } = await resolveIdentity(client, args);
    const completed = await client.query(
      `
        update query_execution_requests
        set status = 'completed',
            replay_response = $4::jsonb,
            completed_at = now(),
            lease_expires_at = null,
            last_error = null
        where user_id = $1
          and coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          and client_request_id = $3
          and status = 'processing'
        returning id
      `,
      [appUserId, brandUuid, args.clientRequestId, JSON.stringify(args.replayResponse)]
    );
    if (completed.rowCount !== 1) {
      throw new Error('EXECUTION_COMPLETION_FAILED');
    }
  });
}

export async function failQueryExecution(
  args: FailQueryExecutionArgs
): Promise<void> {
  await withTransaction(async (client) => {
    const { appUserId, brandUuid } = await resolveIdentity(client, args);
    const failed = await client.query(
      `
        update query_execution_requests
        set status = 'failed',
            failed_at = now(),
            lease_expires_at = null,
            last_error = $4::jsonb
        where user_id = $1
          and coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          and client_request_id = $3
          and status = 'processing'
        returning id
      `,
      [
        appUserId,
        brandUuid,
        args.clientRequestId,
        JSON.stringify({
          code: args.code,
          message: args.message,
          httpStatus: args.httpStatus,
          ...(args.refundApplied !== undefined && { refundApplied: args.refundApplied }),
        }),
      ]
    );
    if (failed.rowCount !== 1) {
      throw new Error('EXECUTION_FAILURE_UPDATE_FAILED');
    }
  });
}
