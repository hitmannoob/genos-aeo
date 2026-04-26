import {
  acquireReprocessingJobRunner,
  completeReprocessingJob,
  getReprocessingJob,
  updateReprocessingJobProgress,
} from './reprocessingJobs';
import { refreshLifetimeSnapshotServer } from './brandAnalyticsServer';

const MAX_ERROR_ITEMS = 25;

function appendError(
  errors: Array<{ queryId: string; message: string }>,
  nextError: { queryId: string; message: string }
): Array<{ queryId: string; message: string }> {
  const updated = [...errors, nextError];
  return updated.slice(-MAX_ERROR_ITEMS);
}

function buildQueryContext(
  brandName: string,
  query: { keyword: string; category: string }
): string {
  return `This query is related to ${brandName} in the ${query.category} category. Topic: ${query.keyword}.`;
}

export async function runReprocessingJob(
  jobId: string,
  baseUrl: string
): Promise<void> {
  const acquired = await acquireReprocessingJobRunner(jobId);
  if (!acquired.acquired || !acquired.job) {
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    await completeReprocessingJob({
      jobId,
      status: 'failed',
      successfulCount: acquired.job.successfulCount,
      failedCount: acquired.job.failedCount,
      attemptedCount: acquired.job.attemptedCount,
      creditsUsed: acquired.job.creditsUsed,
      currentIndex: acquired.job.currentIndex,
      completedQueryIds: acquired.job.completedQueryIds,
      failedQueryIds: acquired.job.failedQueryIds,
      errors: appendError(acquired.job.errors, {
        queryId: acquired.job.currentQueryId || 'job',
        message: 'CRON_SECRET is not configured',
      }),
    });
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

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/user-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cronSecret}`,
          'X-Cron-User-Id': job.userId,
          'X-Service-Billing-Mode': 'charge',
        },
        body: JSON.stringify({
          query: currentQuery.query,
          context: buildQueryContext(job.brandName, currentQuery),
          persistResult: true,
          brandId: job.brandId,
          brandName: job.brandName,
          brandDomain: job.brandDomain,
          keyword: currentQuery.keyword,
          category: currentQuery.category,
          processingSessionId: job.processingSessionId,
          processingSessionTimestamp: job.processingSessionTimestamp,
          clientRequestId: [job.id, currentQuery.queryId].join('::'),
        }),
      });
    } catch (error) {
      errors = appendError(errors, {
        queryId: currentQuery.queryId,
        message: error instanceof Error ? error.message : 'Internal fetch failed',
      });
      terminalStatus = 'failed';
      break;
    }

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok && payload?.persistedQueryResult) {
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

      const errorMessage =
        payload?.message ||
        payload?.error ||
        `Request failed with status ${response.status}`;

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
        payload?.code === 'AUTHENTICATION_REQUIRED' ||
        response.status >= 500
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
    if (successfulCount > 0) {
      await refreshLifetimeSnapshotServer(job.brandId, job.userId);
    }
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
    if (successfulCount > 0) {
      await refreshLifetimeSnapshotServer(job.brandId, job.userId);
    }
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
  if (successfulCount > 0) {
    await refreshLifetimeSnapshotServer(job.brandId, job.userId);
  }
}
