import { createHash } from 'crypto';
import { firestore, FieldValue } from '../firebase-admin';

const COLLECTION_NAME = 'v8_query_executions';
const PROCESSING_LEASE_MS = 10 * 60 * 1000;

export interface QueryExecutionIdentity {
  userId: string;
  brandId?: string;
  clientRequestId: string;
}

export interface AcquireQueryExecutionArgs extends QueryExecutionIdentity {
  requestFingerprintSource: {
    query: string;
    context?: string;
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

interface StoredQueryExecutionRecord<TResponse = unknown> {
  status: 'processing' | 'completed' | 'failed';
  requestFingerprint: string;
  replayResponse?: TResponse;
  leaseExpiresAtMs?: number;
  lastError?: {
    code: string;
    message: string;
    httpStatus: number;
    refundApplied?: boolean;
  };
}

function buildDocId(identity: QueryExecutionIdentity): string {
  return createHash('sha256')
    .update(`${identity.userId}::${identity.brandId || 'no-brand'}::${identity.clientRequestId}`)
    .digest('hex');
}

function buildRequestFingerprint(source: AcquireQueryExecutionArgs['requestFingerprintSource']): string {
  return createHash('sha256')
    .update(JSON.stringify({
      query: source.query,
      context: source.context || '',
      persistResult: !!source.persistResult,
      brandId: source.brandId || '',
      keyword: source.keyword || '',
      category: source.category || '',
      processingSessionId: source.processingSessionId || '',
      processingSessionTimestamp: source.processingSessionTimestamp || '',
    }))
    .digest('hex');
}

export async function acquireQueryExecution<TResponse>(
  args: AcquireQueryExecutionArgs
): Promise<AcquireQueryExecutionResult<TResponse>> {
  const docId = buildDocId(args);
  const docRef = firestore.collection(COLLECTION_NAME).doc(docId);
  const requestFingerprint = buildRequestFingerprint(args.requestFingerprintSource);
  const nowMs = Date.now();

  const decision = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(docRef);

    if (!snapshot.exists) {
      tx.create(docRef, {
        userId: args.userId,
        brandId: args.brandId || null,
        clientRequestId: args.clientRequestId,
        requestFingerprint,
        status: 'processing',
        leaseExpiresAtMs: nowMs + PROCESSING_LEASE_MS,
        attemptCount: 1,
        queryPreview: args.requestFingerprintSource.query.substring(0, 200),
        processingSessionId: args.requestFingerprintSource.processingSessionId || null,
        processingSessionTimestamp: args.requestFingerprintSource.processingSessionTimestamp || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        startedAt: FieldValue.serverTimestamp(),
      });
      return { kind: 'acquired' as const };
    }

    const existing = snapshot.data() as StoredQueryExecutionRecord<TResponse>;
    if (existing.requestFingerprint !== requestFingerprint) {
      return {
        kind: 'conflict' as const,
        message: 'This clientRequestId has already been used for a different request payload.',
      };
    }

    if (existing.status === 'completed') {
      return {
        kind: 'replay' as const,
        response: existing.replayResponse,
      };
    }

    if (existing.status === 'processing') {
      const leaseExpiresAtMs = existing.leaseExpiresAtMs || 0;
      if (leaseExpiresAtMs > nowMs) {
        return {
          kind: 'in_progress' as const,
          retryAfterSeconds: Math.max(1, Math.ceil((leaseExpiresAtMs - nowMs) / 1000)),
        };
      }
    }

    tx.update(docRef, {
      status: 'processing',
      leaseExpiresAtMs: nowMs + PROCESSING_LEASE_MS,
      updatedAt: FieldValue.serverTimestamp(),
      startedAt: FieldValue.serverTimestamp(),
      attemptCount: FieldValue.increment(1),
      lastError: FieldValue.delete(),
      failedAt: FieldValue.delete(),
      completedAt: FieldValue.delete(),
    });

    return { kind: 'acquired' as const };
  });

  switch (decision.kind) {
    case 'acquired':
      return { status: 'acquired', docId };
    case 'replay':
      if (decision.response !== undefined) {
        return { status: 'replay', docId, response: decision.response };
      }
      return {
        status: 'conflict',
        docId,
        message: 'This request already completed, but no replay response is available.',
      };
    case 'in_progress':
      return {
        status: 'in_progress',
        docId,
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    case 'conflict':
      return {
        status: 'conflict',
        docId,
        message: decision.message,
      };
  }
}

export async function completeQueryExecution<TResponse>(
  args: CompleteQueryExecutionArgs<TResponse>
): Promise<void> {
  const docId = buildDocId(args);
  const docRef = firestore.collection(COLLECTION_NAME).doc(docId);

  await docRef.set({
    status: 'completed',
    replayResponse: args.replayResponse,
    updatedAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
    leaseExpiresAtMs: FieldValue.delete(),
    lastError: FieldValue.delete(),
  }, { merge: true });
}

export async function failQueryExecution(
  args: FailQueryExecutionArgs
): Promise<void> {
  const docId = buildDocId(args);
  const docRef = firestore.collection(COLLECTION_NAME).doc(docId);

  await docRef.set({
    status: 'failed',
    updatedAt: FieldValue.serverTimestamp(),
    failedAt: FieldValue.serverTimestamp(),
    leaseExpiresAtMs: FieldValue.delete(),
    lastError: {
      code: args.code,
      message: args.message,
      httpStatus: args.httpStatus,
      ...(args.refundApplied !== undefined && { refundApplied: args.refundApplied }),
    },
  }, { merge: true });
}
