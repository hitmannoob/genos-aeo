'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

export interface ReprocessingJob {
  id: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  totalQueries: number;
  successfulCount: number;
  failedCount: number;
  attemptedCount: number;
  creditsRequired: number;
  creditsUsed: number;
  currentIndex: number;
  currentQueryId: string | null;
  cancellationRequested: boolean;
  completedQueryIds: string[];
  failedQueryIds: string[];
  queries: Array<{
    queryId: string;
    query: string;
    keyword: string;
    category: string;
  }>;
  errors: Array<{ queryId: string; message: string }>;
  processingSessionId: string;
  processingSessionTimestamp: string;
  startedAtMs: number | null;
  completedAtMs: number | null;
  failedAtMs: number | null;
  cancelledAtMs: number | null;
}

export type ReprocessingJobStatus =
  | 'idle'
  | 'processing'
  | 'success'
  | 'error'
  | 'cancelled';

export interface ReprocessingJobCompletionResult {
  success: boolean;
  cancelled: boolean;
  job: ReprocessingJob;
  summary: {
    totalQueries: number;
    attemptedQueries: number;
    processedQueries: number;
    totalErrors: number;
    creditsUsed: number;
  };
}

export interface UseReprocessingJobCallbacks {
  onStart?: (batchQueryIds: string[]) => void;
  onQueryStart?: (queryId: string) => void;
  onProgress?: (job: ReprocessingJob) => void;
  onComplete?: (result: ReprocessingJobCompletionResult) => void;
}

export interface StartJobOptions {
  queriesFilter?: string[];
}

export interface UseReprocessingJobReturn {
  job: ReprocessingJob | null;
  status: ReprocessingJobStatus;
  message: string;
  processing: boolean;
  isSubmitting: boolean;
  startJob: (options?: StartJobOptions) => Promise<ReprocessingJob>;
  cancelJob: () => Promise<ReprocessingJob | null>;
}

const JOB_POLL_INTERVAL_MS = 2000;

export function reprocessingJobQueryKey(brandId: string | undefined) {
  return ['reprocessing-job', brandId] as const;
}

async function getIdToken(): Promise<string> {
  const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
  if (!idToken) {
    throw new Error('Failed to get authentication token. Please sign in again.');
  }
  return idToken;
}

async function fetchActiveJobForBrand(brandId: string): Promise<ReprocessingJob | null> {
  const idToken = await getIdToken();
  const response = await fetch(
    `/api/reprocessing-jobs?brandId=${encodeURIComponent(brandId)}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Failed to load reprocessing job (${response.status})`);
  }
  const payload = await response.json();
  return (payload?.job as ReprocessingJob | null) ?? null;
}

async function fetchJobById(jobId: string): Promise<ReprocessingJob> {
  const idToken = await getIdToken();
  const response = await fetch(`/api/reprocessing-jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to poll job (${response.status})`);
  }
  const payload = await response.json();
  const job = payload?.job as ReprocessingJob | undefined;
  if (!job) {
    throw new Error('Server did not return a reprocessing job');
  }
  return job;
}

function isActive(job: ReprocessingJob | null | undefined): boolean {
  return !!job && (job.status === 'queued' || job.status === 'processing');
}

function isTerminal(job: ReprocessingJob | null | undefined): boolean {
  return (
    !!job &&
    (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')
  );
}

function deriveStatus(job: ReprocessingJob | null): ReprocessingJobStatus {
  if (!job) return 'idle';
  if (job.status === 'cancelled') return 'cancelled';
  if (job.status === 'failed') return 'error';
  if (job.status === 'completed') return 'success';
  return 'processing';
}

function deriveMessage(job: ReprocessingJob | null): string {
  if (!job) return '';
  const brandName = job.brandName;
  if (job.status === 'queued') {
    return `Queued ${job.totalQueries} queries for ${brandName}...`;
  }
  if (job.status === 'processing') {
    const inFlight = job.attemptedCount + (job.currentQueryId ? 1 : 0);
    return `Processing ${inFlight} of ${job.totalQueries} queries for ${brandName}...`;
  }
  if (job.status === 'cancelled') {
    return `Processing cancelled after ${job.attemptedCount} of ${job.totalQueries} queries for ${brandName}.`;
  }
  if (job.status === 'failed') {
    return `Processed ${job.successfulCount} of ${job.totalQueries} queries for ${brandName}. ${job.failedCount} failed.`;
  }
  return `Successfully processed ${job.successfulCount} queries for ${brandName}.`;
}

// Error subclass that carries credit-shortfall context for UI to display.
export class InsufficientCreditsError extends Error {
  code = 'INSUFFICIENT_CREDITS' as const;
  requiredCredits: number;
  availableCredits: number;
  constructor(message: string, requiredCredits: number, availableCredits: number) {
    super(message);
    this.name = 'InsufficientCreditsError';
    this.requiredCredits = requiredCredits;
    this.availableCredits = availableCredits;
  }
}

export function useReprocessingJob(
  brandId: string | undefined,
  callbacks?: UseReprocessingJobCallbacks,
): UseReprocessingJobReturn {
  const queryClient = useQueryClient();

  // Single shared poll per brand. React Query dedupes subscribers by queryKey,
  // so 50 mounted ProcessQueriesButton instances for the same brand result in
  // exactly one network stream. refetchInterval stops polling on terminal state.
  const query = useQuery({
    queryKey: reprocessingJobQueryKey(brandId),
    queryFn: async (): Promise<ReprocessingJob | null> => {
      if (!brandId) return null;
      // If we already know about an active job, fetch it directly by id —
      // the per-job endpoint is the canonical "give me the latest state of
      // this specific job" lookup. Otherwise fall back to the brand-scoped
      // lookup that asks "is anything active for this brand right now?"
      const cached = queryClient.getQueryData(reprocessingJobQueryKey(brandId)) as
        | ReprocessingJob
        | null
        | undefined;
      if (cached && isActive(cached)) {
        return await fetchJobById(cached.id);
      }
      return await fetchActiveJobForBrand(brandId);
    },
    enabled: !!brandId,
    refetchInterval: (q) => {
      const job = q.state.data as ReprocessingJob | null | undefined;
      return isActive(job) ? JOB_POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const job = query.data ?? null;

  const startMutation = useMutation({
    mutationFn: async (options: StartJobOptions | undefined): Promise<ReprocessingJob> => {
      if (!brandId) {
        throw new Error('Cannot start reprocessing job — no brandId');
      }
      const idToken = await getIdToken();
      const response = await fetch('/api/reprocessing-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          brandId,
          ...(options?.queriesFilter && options.queriesFilter.length > 0
            ? { queriesFilter: options.queriesFilter }
            : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.code === 'INSUFFICIENT_CREDITS') {
          throw new InsufficientCreditsError(
            payload?.error || 'Insufficient credits',
            payload?.requiredCredits ?? 0,
            payload?.availableCredits ?? 0,
          );
        }
        throw new Error(
          payload?.error || `Failed to create reprocessing job (${response.status})`,
        );
      }
      const newJob = payload?.job as ReprocessingJob | undefined;
      if (!newJob) {
        throw new Error('Server did not return a reprocessing job');
      }
      return newJob;
    },
    onSuccess: (newJob) => {
      queryClient.setQueryData(reprocessingJobQueryKey(brandId), newJob);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (): Promise<ReprocessingJob | null> => {
      if (!brandId) return null;
      const current = queryClient.getQueryData(reprocessingJobQueryKey(brandId)) as
        | ReprocessingJob
        | null
        | undefined;
      if (!current) return null;
      const idToken = await getIdToken();
      const response = await fetch(`/api/reprocessing-jobs/${current.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (!response.ok) {
        throw new Error(`Failed to cancel reprocessing job (${response.status})`);
      }
      const payload = await response.json();
      return (payload?.job as ReprocessingJob | undefined) ?? null;
    },
    onSuccess: (cancelledJob) => {
      if (cancelledJob) {
        queryClient.setQueryData(reprocessingJobQueryKey(brandId), cancelledJob);
      }
    },
  });

  const status = useMemo(() => deriveStatus(job), [job]);
  const message = useMemo(() => deriveMessage(job), [job]);

  // Per-instance transition callbacks. Multiple components subscribed to the
  // same brand each fire their own callbacks; each instance tracks the last
  // notified job/query so it doesn't double-fire across React's render cycles.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const startNotifiedJobIdRef = useRef<string | null>(null);
  const completionNotifiedJobIdRef = useRef<string | null>(null);
  const lastQueryIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!job) {
      lastQueryIdRef.current = null;
      return;
    }
    const cb = callbacksRef.current;

    if (startNotifiedJobIdRef.current !== job.id) {
      startNotifiedJobIdRef.current = job.id;
      completionNotifiedJobIdRef.current = null;
      lastQueryIdRef.current = null;
      cb?.onStart?.(job.queries.map((q) => q.queryId));
    }

    if (job.currentQueryId && lastQueryIdRef.current !== job.currentQueryId) {
      lastQueryIdRef.current = job.currentQueryId;
      cb?.onQueryStart?.(job.currentQueryId);
    }

    cb?.onProgress?.(job);

    if (isTerminal(job) && completionNotifiedJobIdRef.current !== job.id) {
      completionNotifiedJobIdRef.current = job.id;
      cb?.onComplete?.({
        success: job.status === 'completed' && job.failedCount === 0,
        cancelled: job.status === 'cancelled',
        job,
        summary: {
          totalQueries: job.totalQueries,
          attemptedQueries: job.attemptedCount,
          processedQueries: job.successfulCount,
          totalErrors: job.failedCount,
          creditsUsed: job.creditsUsed,
        },
      });
    }
  }, [job]);

  const startJob = useCallback(
    (options?: StartJobOptions) => startMutation.mutateAsync(options),
    [startMutation],
  );
  const cancelJob = useCallback(() => cancelMutation.mutateAsync(), [cancelMutation]);

  return {
    job,
    status,
    message,
    processing: status === 'processing' || startMutation.isPending,
    isSubmitting: startMutation.isPending,
    startJob,
    cancelJob,
  };
}
