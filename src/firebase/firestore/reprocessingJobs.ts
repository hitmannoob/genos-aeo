import { randomUUID } from 'crypto';
import { firestore, FieldValue } from '../firebase-admin';
import { buildTrackedQueryIdentity } from './queryResultUtils';

const COLLECTION_NAME = 'v8_reprocessing_jobs';
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

export interface ReprocessingJobDocument {
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

function collection() {
  return firestore.collection(COLLECTION_NAME);
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

function buildSessionId(): string {
  return `manual_session_${randomUUID()}`;
}

export function serializeReprocessingJob(
  id: string,
  job: ReprocessingJobDocument
): ReprocessingJobClient {
  return {
    id,
    userId: job.userId,
    brandId: job.brandId,
    brandName: job.brandName,
    brandDomain: job.brandDomain,
    status: job.status,
    totalQueries: job.totalQueries,
    successfulCount: job.successfulCount,
    failedCount: job.failedCount,
    attemptedCount: job.attemptedCount,
    creditsRequired: job.creditsRequired,
    creditsUsed: job.creditsUsed,
    currentIndex: job.currentIndex,
    currentQueryId: job.currentQueryId,
    processingSessionId: job.processingSessionId,
    processingSessionTimestamp: job.processingSessionTimestamp,
    cancellationRequested: job.cancellationRequested,
    completedQueryIds: Array.isArray(job.completedQueryIds) ? job.completedQueryIds : [],
    failedQueryIds: Array.isArray(job.failedQueryIds) ? job.failedQueryIds : [],
    queries: Array.isArray(job.queries) ? job.queries : [],
    errors: Array.isArray(job.errors) ? job.errors : [],
    runnerLeaseExpiresAtMs: job.runnerLeaseExpiresAtMs ?? null,
    lastHeartbeatMs: job.lastHeartbeatMs ?? null,
    createdAtMs: job.createdAtMs,
    updatedAtMs: job.updatedAtMs,
    startedAtMs: job.startedAtMs ?? null,
    completedAtMs: job.completedAtMs ?? null,
    cancelledAtMs: job.cancelledAtMs ?? null,
    failedAtMs: job.failedAtMs ?? null,
  };
}

export async function createReprocessingJob(args: {
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  queries: Array<{ query: string; keyword?: string; category?: string }>;
  creditsRequired: number;
}): Promise<ReprocessingJobClient> {
  const now = Date.now();
  const docRef = collection().doc();
  const queries = args.queries.map(normalizeJobQuery);

  const job: ReprocessingJobDocument = {
    userId: args.userId,
    brandId: args.brandId,
    brandName: args.brandName,
    brandDomain: args.brandDomain,
    status: 'queued',
    totalQueries: queries.length,
    successfulCount: 0,
    failedCount: 0,
    attemptedCount: 0,
    creditsRequired: args.creditsRequired,
    creditsUsed: 0,
    currentIndex: 0,
    currentQueryId: null,
    processingSessionId: buildSessionId(),
    processingSessionTimestamp: new Date(now).toISOString(),
    cancellationRequested: false,
    completedQueryIds: [],
    failedQueryIds: [],
    queries,
    errors: [],
    runnerLeaseExpiresAtMs: null,
    lastHeartbeatMs: null,
    createdAtMs: now,
    updatedAtMs: now,
    startedAtMs: null,
    completedAtMs: null,
    cancelledAtMs: null,
    failedAtMs: null,
  };

  await docRef.set({
    ...job,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return serializeReprocessingJob(docRef.id, job);
}

export async function getReprocessingJob(
  jobId: string
): Promise<ReprocessingJobClient | null> {
  const snapshot = await collection().doc(jobId).get();
  if (!snapshot.exists) {
    return null;
  }

  return serializeReprocessingJob(snapshot.id, snapshot.data() as ReprocessingJobDocument);
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
  const snapshot = await collection()
    .where('userId', '==', userId)
    .limit(50)
    .get();

  const jobs = snapshot.docs
    .map((docSnap) => serializeReprocessingJob(docSnap.id, docSnap.data() as ReprocessingJobDocument))
    .filter((job) =>
      job.brandId === brandId &&
      (job.status === 'queued' || job.status === 'processing')
    )
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);

  return jobs[0] || null;
}

export async function acquireReprocessingJobRunner(jobId: string): Promise<{
  acquired: boolean;
  job?: ReprocessingJobClient;
}> {
  const now = Date.now();
  const docRef = collection().doc(jobId);

  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(docRef);
    if (!snapshot.exists) {
      return { acquired: false };
    }

    const job = snapshot.data() as ReprocessingJobDocument;
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'cancelled'
    ) {
      return {
        acquired: false,
        job: serializeReprocessingJob(snapshot.id, job),
      };
    }

    if (
      typeof job.runnerLeaseExpiresAtMs === 'number' &&
      job.runnerLeaseExpiresAtMs > now
    ) {
      return {
        acquired: false,
        job: serializeReprocessingJob(snapshot.id, job),
      };
    }

    const updatedJob: ReprocessingJobDocument = {
      ...job,
      status: 'processing',
      updatedAtMs: now,
      startedAtMs: job.startedAtMs ?? now,
      lastHeartbeatMs: now,
      runnerLeaseExpiresAtMs: now + REPROCESSING_JOB_LEASE_MS,
    };

    tx.set(docRef, {
      status: updatedJob.status,
      updatedAtMs: updatedJob.updatedAtMs,
      startedAtMs: updatedJob.startedAtMs,
      lastHeartbeatMs: updatedJob.lastHeartbeatMs,
      runnerLeaseExpiresAtMs: updatedJob.runnerLeaseExpiresAtMs,
      updatedAt: FieldValue.serverTimestamp(),
      startedAt: job.startedAtMs ? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      acquired: true,
      job: serializeReprocessingJob(snapshot.id, updatedJob),
    };
  });
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
  const now = Date.now();
  await collection().doc(args.jobId).set({
    successfulCount: args.successfulCount,
    failedCount: args.failedCount,
    attemptedCount: args.attemptedCount,
    creditsUsed: args.creditsUsed,
    currentIndex: args.currentIndex,
    currentQueryId: args.currentQueryId,
    completedQueryIds: args.completedQueryIds,
    failedQueryIds: args.failedQueryIds,
    errors: args.errors,
    ...(args.status && { status: args.status }),
    updatedAtMs: now,
    lastHeartbeatMs: now,
    runnerLeaseExpiresAtMs: now + REPROCESSING_JOB_LEASE_MS,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function requestReprocessingJobCancellation(
  jobId: string,
  userId: string
): Promise<ReprocessingJobClient | null> {
  const job = await getReprocessingJobForUser(jobId, userId);
  if (!job) {
    return null;
  }

  const now = Date.now();
  await collection().doc(jobId).set({
    cancellationRequested: true,
    updatedAtMs: now,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    ...job,
    cancellationRequested: true,
    updatedAtMs: now,
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
  const now = Date.now();

  await collection().doc(args.jobId).set({
    status: args.status,
    successfulCount: args.successfulCount,
    failedCount: args.failedCount,
    attemptedCount: args.attemptedCount,
    creditsUsed: args.creditsUsed,
    currentIndex: args.currentIndex,
    currentQueryId: null,
    completedQueryIds: args.completedQueryIds,
    failedQueryIds: args.failedQueryIds,
    errors: args.errors,
    runnerLeaseExpiresAtMs: null,
    lastHeartbeatMs: now,
    updatedAtMs: now,
    updatedAt: FieldValue.serverTimestamp(),
    ...(args.status === 'completed' && {
      completedAtMs: now,
      completedAt: FieldValue.serverTimestamp(),
    }),
    ...(args.status === 'failed' && {
      failedAtMs: now,
      failedAt: FieldValue.serverTimestamp(),
    }),
    ...(args.status === 'cancelled' && {
      cancelledAtMs: now,
      cancelledAt: FieldValue.serverTimestamp(),
    }),
  }, { merge: true });
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
