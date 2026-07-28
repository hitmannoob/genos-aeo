import 'server-only';

import { createHash } from 'node:crypto';

import {
  acquireReprocessingJobRunner,
  completeReprocessingJob,
  getReprocessingJob,
  updateReprocessingJobProgress,
} from './reprocessingJobs';
import { executePersistedUserQueryServer } from '@/lib/userQueryExecutionServer';
import { logger } from '@/lib/logger';

const MAX_ERROR_ITEMS = 25;

function buildJobRequestId(jobId: string, queryId: string): string {
  const queryHash = createHash('sha256').update(queryId).digest('hex');
  return `reprocess:${jobId}:${queryHash}`;
}

function appendError(
  errors: Array<{ queryId: string; message: string }>,
  nextError: { queryId: string; message: string }
): Array<{ queryId: string; message: string }> {
  const updated = [...errors, nextError];
  return updated.slice(-MAX_ERROR_ITEMS);
}

function publicJobErrorMessage(code?: string): string {
  switch (code) {
    case 'INSUFFICIENT_CREDITS':
      return 'Insufficient credits to continue processing.';
    case 'NO_PROVIDERS_CONFIGURED':
      return 'No AI providers are configured.';
    case 'REQUEST_IN_PROGRESS':
      return 'This query is already being processed.';
    case 'ALL_PROVIDERS_FAILED':
      return 'All AI providers failed. Reserved credits were refunded.';
    case 'ALL_PROVIDERS_FAILED_REFUND_FAILED':
      return 'AI providers failed and the automatic credit refund needs attention.';
    case 'PERSISTENCE_FAILED_REFUNDED':
      return 'The result could not be saved. Reserved credits were refunded.';
    case 'PERSISTENCE_FAILED_REFUND_FAILED':
      return 'The result could not be saved and the automatic credit refund needs attention.';
    case 'PERSISTENCE_FAILED':
      return 'The result could not be saved.';
    default:
      return 'Query processing failed. Please try again.';
  }
}

export async function runReprocessingJob(
  jobId: string,
  openRouterApiKey?: string,
): Promise<void> {
  const acquired = await acquireReprocessingJobRunner(jobId);
  if (!acquired.acquired || !acquired.job) {
    return;
  }

  let job = acquired.job;
  let successfulCount = job.successfulCount;
  let failedCount = job.failedCount;
  let attemptedCount = job.attemptedCount;
  let creditsUsed = job.creditsUsed;
  let currentIndex = job.currentIndex;
  let completedQueryIds = [...job.completedQueryIds];
  let failedQueryIds = [...job.failedQueryIds];
  let errors = [...job.errors];

  let terminalStatus: 'failed' | 'cancelled' | null = null;

  while (currentIndex < job.queries.length) {
    const latestJob = await getReprocessingJob(jobId);
    if (!latestJob) {
      return;
    }

    job = latestJob;
    if (job.cancellationRequested) {
      terminalStatus = 'cancelled';
      break;
    }

    currentIndex = job.currentIndex;
    if (currentIndex >= job.queries.length) {
      break;
    }

    const currentQuery = job.queries[currentIndex];

    await updateReprocessingJobProgress({
      jobId,
      successfulCount,
      failedCount,
      attemptedCount,
      creditsUsed,
      currentIndex,
      currentQueryId: currentQuery.queryId,
      completedQueryIds,
      failedQueryIds,
      errors,
      status: 'processing',
    });

    let payload:
      | Awaited<ReturnType<typeof executePersistedUserQueryServer>>
      | null = null;
    try {
      payload = await executePersistedUserQueryServer({
        userId: job.userId,
        openRouterApiKey,
        query: currentQuery.query,
        brandId: job.brandId,
        keyword: currentQuery.keyword,
        category: currentQuery.category,
        processingSessionId: job.processingSessionId,
        processingSessionTimestamp: job.processingSessionTimestamp,
        clientRequestId: buildJobRequestId(job.id, currentQuery.queryId),
      });
    } catch (error) {
      logger.error('Unexpected reprocessing query failure', error);
      const errorMessage = 'Query processing failed due to an internal error.';
      failedCount += 1;
      attemptedCount += 1;
      currentIndex += 1;
      failedQueryIds = Array.from(new Set([...failedQueryIds, currentQuery.queryId]));
      errors = appendError(errors, {
        queryId: currentQuery.queryId,
        message: errorMessage,
      });
      await updateReprocessingJobProgress({
        jobId,
        successfulCount,
        failedCount,
        attemptedCount,
        creditsUsed,
        currentIndex,
        currentQueryId: null,
        completedQueryIds,
        failedQueryIds,
        errors,
        status: 'processing',
      });
      terminalStatus = 'failed';
      break;
    }

    if (payload?.success && payload?.persistedQueryResult) {
      successfulCount += 1;
      attemptedCount += 1;
      creditsUsed += Number(payload?.userCredits?.deducted ?? 0);
      currentIndex += 1;
      completedQueryIds = Array.from(new Set([...completedQueryIds, currentQuery.queryId]));

      await updateReprocessingJobProgress({
        jobId,
        successfulCount,
        failedCount,
        attemptedCount,
        creditsUsed,
        currentIndex,
        currentQueryId: null,
        completedQueryIds,
        failedQueryIds,
        errors,
        status: 'processing',
      });
    } else {
      failedCount += 1;
      attemptedCount += 1;
      currentIndex += 1;
      failedQueryIds = Array.from(new Set([...failedQueryIds, currentQuery.queryId]));

      const errorMessage = publicJobErrorMessage(payload?.code);

      errors = appendError(errors, {
        queryId: currentQuery.queryId,
        message: errorMessage,
      });

      await updateReprocessingJobProgress({
        jobId,
        successfulCount,
        failedCount,
        attemptedCount,
        creditsUsed,
        currentIndex,
        currentQueryId: null,
        completedQueryIds,
        failedQueryIds,
        errors,
        status: 'processing',
      });

      if (
        payload?.code === 'INSUFFICIENT_CREDITS' ||
        payload?.code === 'LOCAL_PROFILE_REQUIRED' ||
        payload?.code === 'CREDIT_DEDUCTION_FAILED' ||
        payload?.code === 'PERSISTENCE_FAILED' ||
        payload?.code === 'PERSISTENCE_FAILED_REFUND_FAILED' ||
        payload?.code === 'PERSISTENCE_FAILED_REFUNDED' ||
        payload?.code === 'UNHANDLED_USER_QUERY_ERROR'
      ) {
        terminalStatus = 'failed';
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (terminalStatus === 'cancelled') {
    await completeReprocessingJob({
      jobId,
      status: 'cancelled',
      successfulCount,
      failedCount,
      attemptedCount,
      creditsUsed,
      currentIndex,
      completedQueryIds,
      failedQueryIds,
      errors,
    });
    return;
  }

  if (terminalStatus === 'failed') {
    await completeReprocessingJob({
      jobId,
      status: 'failed',
      successfulCount,
      failedCount,
      attemptedCount,
      creditsUsed,
      currentIndex,
      completedQueryIds,
      failedQueryIds,
      errors,
    });
    return;
  }

  await completeReprocessingJob({
    jobId,
    status: 'completed',
    successfulCount,
    failedCount,
    attemptedCount,
    creditsUsed,
    currentIndex,
    completedQueryIds,
    failedQueryIds,
    errors,
  });
}
