import 'server-only';

import { randomUUID } from 'crypto';
import { sql, withTransaction } from '@/lib/db/sqlite';
import { buildTrackedQueryIdentity } from '@/lib/queryResultUtils';

export const REPROCESSING_JOB_LEASE_MS = 10 * 60 * 1000;

export type ReprocessingJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ReprocessingJobQuery {
  queryId: string;
  query: string;
  keyword: string;
  category: string;
}

export interface ReprocessingJobClient {
  id: string;
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  status: ReprocessingJobStatus;
  totalQueries: number;
  successfulCount: number;
  failedCount: number;
  attemptedCount: number;
  creditsRequired: number;
  creditsUsed: number;
  currentIndex: number;
  currentQueryId: string | null;
  processingSessionId: string;
  processingSessionTimestamp: string;
  cancellationRequested: boolean;
  completedQueryIds: string[];
  failedQueryIds: string[];
  queries: ReprocessingJobQuery[];
  errors: Array<{
    queryId: string;
    message: string;
  }>;
  runnerLeaseExpiresAtMs: number | null;
  lastHeartbeatMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
  cancelledAtMs: number | null;
  failedAtMs: number | null;
}

interface JobRow {
  id: string;
  firebase_uid: string;
  public_brand_id: string;
  brand_name: string;
  brand_domain: string;
  status: ReprocessingJobStatus;
  processing_session_id: string;
  processing_session_timestamp: Date | string;
  total_queries: number;
  successful_count: number;
  failed_count: number;
  attempted_count: number;
  credits_required: number;
  credits_used: number;
  current_index: number;
  cancellation_requested: boolean;
  runner_lease_expires_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  failed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ItemRow {
  query: string;
  keyword: string;
  category: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';
  error_message: string | null;
  position: number;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function buildSessionId(): string {
  return `manual_session_${randomUUID()}`;
}

function normalizeJobQuery(query: {
  query: string;
  keyword?: string;
  category?: string;
}): ReprocessingJobQuery {
  return {
    queryId: buildTrackedQueryIdentity(query),
    query: query.query,
    keyword: query.keyword || 'unknown',
    category: query.category || 'unknown',
  };
}

function rowToQuery(row: ItemRow): ReprocessingJobQuery {
  return normalizeJobQuery({
    query: row.query,
    keyword: row.keyword,
    category: row.category,
  });
}

async function serializeJob(row: JobRow): Promise<ReprocessingJobClient> {
  const itemResult = await sql<ItemRow>(
    `
      select query, keyword, category, status, error_message, position
      from reprocessing_job_items
      where job_id = $1
      order by position
    `,
    [row.id]
  );

  const queries = itemResult.rows.map(rowToQuery);
  const completedQueryIds = itemResult.rows
    .filter((item) => item.status === 'completed')
    .map(rowToQuery)
    .map((query) => query.queryId);
  const failedItems = itemResult.rows.filter((item) => item.status === 'failed');
  const failedQueryIds = failedItems.map(rowToQuery).map((query) => query.queryId);
  const errors = failedItems
    .filter((item) => item.error_message)
    .slice(-25)
    .map((item) => ({
      queryId: rowToQuery(item).queryId,
      message: item.error_message || 'Query failed',
    }));
  const currentItem = itemResult.rows.find((item) => item.status === 'processing');

  return {
    id: row.id,
    userId: row.firebase_uid,
    brandId: row.public_brand_id,
    brandName: row.brand_name,
    brandDomain: row.brand_domain,
    status: row.status,
    totalQueries: Number(row.total_queries),
    successfulCount: Number(row.successful_count),
    failedCount: Number(row.failed_count),
    attemptedCount: Number(row.attempted_count),
    creditsRequired: Number(row.credits_required),
    creditsUsed: Number(row.credits_used),
    currentIndex: Number(row.current_index),
    currentQueryId: currentItem ? rowToQuery(currentItem).queryId : null,
    processingSessionId: row.processing_session_id,
    processingSessionTimestamp: new Date(row.processing_session_timestamp).toISOString(),
    cancellationRequested: row.cancellation_requested,
    completedQueryIds,
    failedQueryIds,
    queries,
    errors,
    runnerLeaseExpiresAtMs: toMs(row.runner_lease_expires_at),
    lastHeartbeatMs: toMs(row.last_heartbeat_at),
    createdAtMs: toMs(row.created_at) || Date.now(),
    updatedAtMs: toMs(row.updated_at) || Date.now(),
    startedAtMs: toMs(row.started_at),
    completedAtMs: toMs(row.completed_at),
    cancelledAtMs: toMs(row.cancelled_at),
    failedAtMs: toMs(row.failed_at),
  };
}

async function getJobRow(jobId: string): Promise<JobRow | null> {
  const result = await sql<JobRow>(
    `
      select
        j.id,
        u.firebase_uid,
        coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
        b.company_name as brand_name,
        b.domain as brand_domain,
        j.status,
        j.processing_session_id,
        j.processing_session_timestamp,
        j.total_queries,
        j.successful_count,
        j.failed_count,
        j.attempted_count,
        j.credits_required,
        j.credits_used,
        j.current_index,
        j.cancellation_requested,
        j.runner_lease_expires_at,
        j.last_heartbeat_at,
        j.started_at,
        j.completed_at,
        j.cancelled_at,
        j.failed_at,
        j.created_at,
        j.updated_at
      from reprocessing_jobs j
      join app_users u on u.id = j.user_id
      join brands b on b.id = j.brand_id
      where j.id = $1
      limit 1
    `,
    [jobId]
  );

  return result.rows[0] || null;
}

export async function createReprocessingJob(args: {
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  queries: Array<{ query: string; keyword?: string; category?: string }>;
  creditsRequired: number;
}): Promise<{ job: ReprocessingJobClient; reusedExistingJob: boolean }> {
  const processingSessionTimestamp = new Date();
  const normalizedQueries = args.queries.map(normalizeJobQuery);

  const creation = await withTransaction(async (client) => {
    const brandResult = await client.query<{ user_id: string; brand_id: string }>(
      `
        select u.id as user_id, b.id as brand_id
        from brands b
        join app_users u on u.id = b.user_id
        where u.firebase_uid = $1
          and (b.id::text = $2 or b.legacy_firestore_id = $2)
        limit 1
        for update of b
      `,
      [args.userId, args.brandId]
    );

    const identity = brandResult.rows[0];
    if (!identity) {
      throw new Error('Brand not found');
    }

    // The brand row lock serializes job creation for one brand. This makes
    // the active-job check and insert atomic even when two POSTs arrive at
    // the same time.
    const existingJob = await client.query<{ id: string }>(
      `
        select id
        from reprocessing_jobs
        where brand_id = $1
          and status in ('queued', 'processing')
        order by created_at desc
        limit 1
      `,
      [identity.brand_id]
    );
    if (existingJob.rows[0]) {
      return { id: existingJob.rows[0].id, reusedExistingJob: true };
    }

    const jobResult = await client.query<{ id: string }>(
      `
        insert into reprocessing_jobs (
          user_id,
          brand_id,
          status,
          processing_session_id,
          processing_session_timestamp,
          total_queries,
          credits_required
        )
        values ($1, $2, 'queued', $3, $4, $5, $6)
        returning id
      `,
      [
        identity.user_id,
        identity.brand_id,
        buildSessionId(),
        processingSessionTimestamp,
        normalizedQueries.length,
        args.creditsRequired,
      ]
    );

    for (const [index, query] of normalizedQueries.entries()) {
      await client.query(
        `
          insert into reprocessing_job_items (
            job_id,
            brand_id,
            user_id,
            query,
            keyword,
            category,
            position
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          jobResult.rows[0].id,
          identity.brand_id,
          identity.user_id,
          query.query,
          query.keyword,
          query.category,
          index,
        ]
      );
    }

    return { id: jobResult.rows[0].id, reusedExistingJob: false };
  });

  const job = await getReprocessingJob(creation.id);
  if (!job) {
    throw new Error('Failed to create reprocessing job');
  }
  return { job, reusedExistingJob: creation.reusedExistingJob };
}

export async function getReprocessingJob(
  jobId: string
): Promise<ReprocessingJobClient | null> {
  const row = await getJobRow(jobId);
  return row ? serializeJob(row) : null;
}

export async function getReprocessingJobForUser(
  jobId: string,
  userId: string
): Promise<ReprocessingJobClient | null> {
  const job = await getReprocessingJob(jobId);
  if (!job || job.userId !== userId) {
    return null;
  }

  return job;
}

export async function findActiveReprocessingJobForBrand(
  userId: string,
  brandId: string
): Promise<ReprocessingJobClient | null> {
  const result = await sql<JobRow>(
    `
      select
        j.id,
        u.firebase_uid,
        coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
        b.company_name as brand_name,
        b.domain as brand_domain,
        j.status,
        j.processing_session_id,
        j.processing_session_timestamp,
        j.total_queries,
        j.successful_count,
        j.failed_count,
        j.attempted_count,
        j.credits_required,
        j.credits_used,
        j.current_index,
        j.cancellation_requested,
        j.runner_lease_expires_at,
        j.last_heartbeat_at,
        j.started_at,
        j.completed_at,
        j.cancelled_at,
        j.failed_at,
        j.created_at,
        j.updated_at
      from reprocessing_jobs j
      join app_users u on u.id = j.user_id
      join brands b on b.id = j.brand_id
      where u.firebase_uid = $1
        and (b.id::text = $2 or b.legacy_firestore_id = $2)
        and j.status in ('queued', 'processing')
      order by j.updated_at desc
      limit 1
    `,
    [userId, brandId]
  );

  return result.rows[0] ? serializeJob(result.rows[0]) : null;
}

export async function acquireReprocessingJobRunner(jobId: string): Promise<{
  acquired: boolean;
  job?: ReprocessingJobClient;
}> {
  const result = await withTransaction(async (client) => {
    const result = await client.query<JobRow>(
      `
        select
          j.id,
          u.firebase_uid,
          coalesce(b.legacy_firestore_id, b.id::text) as public_brand_id,
          b.company_name as brand_name,
          b.domain as brand_domain,
          j.status,
          j.processing_session_id,
          j.processing_session_timestamp,
          j.total_queries,
          j.successful_count,
          j.failed_count,
          j.attempted_count,
          j.credits_required,
          j.credits_used,
          j.current_index,
          j.cancellation_requested,
          j.runner_lease_expires_at,
          j.last_heartbeat_at,
          j.started_at,
          j.completed_at,
          j.cancelled_at,
          j.failed_at,
          j.created_at,
          j.updated_at
        from reprocessing_jobs j
        join app_users u on u.id = j.user_id
        join brands b on b.id = j.brand_id
        where j.id = $1
        for update of j
      `,
      [jobId]
    );

    const job = result.rows[0];
    if (!job) return null;

    const leaseExpiresAtMs = toMs(job.runner_lease_expires_at);
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      (leaseExpiresAtMs !== null && leaseExpiresAtMs > Date.now())
    ) {
      return { acquired: false, row: job };
    }

    await client.query(
      `
        update reprocessing_jobs
        set status = 'processing',
            started_at = coalesce(started_at, now()),
            last_heartbeat_at = now(),
            runner_lease_expires_at = $2
        where id = $1
      `,
      [jobId, new Date(Date.now() + REPROCESSING_JOB_LEASE_MS)]
    );

    return {
      acquired: true,
      row: {
        ...job,
        status: 'processing' as ReprocessingJobStatus,
        started_at: job.started_at || new Date(),
        last_heartbeat_at: new Date(),
        runner_lease_expires_at: new Date(Date.now() + REPROCESSING_JOB_LEASE_MS),
      },
    };
  });

  if (!result) {
    return { acquired: false };
  }

  const job = await serializeJob(result.row);
  return {
    acquired: result.acquired,
    job,
  };
}

export async function updateReprocessingJobProgress(args: {
  jobId: string;
  successfulCount: number;
  failedCount: number;
  attemptedCount: number;
  creditsUsed: number;
  currentIndex: number;
  currentQueryId: string | null;
  completedQueryIds: string[];
  failedQueryIds: string[];
  errors: Array<{ queryId: string; message: string }>;
  status?: ReprocessingJobStatus;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `
        update reprocessing_jobs
        set successful_count = $2,
            failed_count = $3,
            attempted_count = $4,
            credits_used = $5,
            current_index = $6,
            status = coalesce($7::text, status),
            last_heartbeat_at = now(),
            runner_lease_expires_at = $8
        where id = $1
      `,
      [
        args.jobId,
        args.successfulCount,
        args.failedCount,
        args.attemptedCount,
        args.creditsUsed,
        args.currentIndex,
        args.status || null,
        new Date(Date.now() + REPROCESSING_JOB_LEASE_MS),
      ]
    );

    const itemResult = await client.query<ItemRow & { id: string }>(
      'select id, query, keyword, category, status, error_message, position from reprocessing_job_items where job_id = $1',
      [args.jobId]
    );

    for (const item of itemResult.rows) {
      const queryId = rowToQuery(item).queryId;
      const error = args.errors.find((entry) => entry.queryId === queryId);
      const nextStatus =
        args.completedQueryIds.includes(queryId) ? 'completed' :
        args.failedQueryIds.includes(queryId) ? 'failed' :
        args.currentQueryId === queryId ? 'processing' :
        item.status === 'processing' ? 'queued' :
        item.status;

      await client.query(
        `
          update reprocessing_job_items
          set status = $2,
              error_message = $3
          where id = $1
        `,
        [item.id, nextStatus, error?.message || null]
      );
    }
  });
}

export async function requestReprocessingJobCancellation(
  jobId: string,
  userId: string
): Promise<ReprocessingJobClient | null> {
  const job = await getReprocessingJobForUser(jobId, userId);
  if (!job) {
    return null;
  }

  await sql(
    `
      update reprocessing_jobs
      set cancellation_requested = true
      where id = $1
    `,
    [jobId]
  );

  return {
    ...job,
    cancellationRequested: true,
    updatedAtMs: Date.now(),
  };
}

export async function completeReprocessingJob(args: {
  jobId: string;
  status: 'completed' | 'failed' | 'cancelled';
  successfulCount: number;
  failedCount: number;
  attemptedCount: number;
  creditsUsed: number;
  currentIndex: number;
  completedQueryIds: string[];
  failedQueryIds: string[];
  errors: Array<{ queryId: string; message: string }>;
}): Promise<void> {
  await updateReprocessingJobProgress({
    ...args,
    currentQueryId: null,
  });

  await sql(
    `
      update reprocessing_jobs
      set status = $2,
          runner_lease_expires_at = null,
          last_heartbeat_at = now(),
          completed_at = case when $2 = 'completed' then now() else completed_at end,
          failed_at = case when $2 = 'failed' then now() else failed_at end,
          cancelled_at = case when $2 = 'cancelled' then now() else cancelled_at end
      where id = $1
    `,
    [args.jobId, args.status]
  );
}

export function shouldResumeReprocessingJob(job: ReprocessingJobClient): boolean {
  if (job.status !== 'queued' && job.status !== 'processing') {
    return false;
  }

  if (job.cancellationRequested) {
    return true;
  }

  if (!job.runnerLeaseExpiresAtMs) {
    return true;
  }

  return job.runnerLeaseExpiresAtMs <= Date.now();
}
