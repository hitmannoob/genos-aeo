'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import {
  reprocessingJobQueryKey,
  type ReprocessingJob,
} from '@/hooks/useReprocessingJob';

// Module-level dedupe set so terminal-state side effects (toasts, profile
// refresh) fire exactly once per job id, no matter how many cache events
// arrive or how many times the observer remounts (e.g., dev strict mode).
const NOTIFIED_TERMINAL_JOB_IDS = new Set<string>();

const TERMINAL_DISPLAY_MS = 5000;

function isTerminal(status: ReprocessingJob['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

// Mounted once at the layout level. Watches the React Query cache for any
// reprocessing-job entry transitioning to a terminal state and fires the
// completion toast + user-profile/brands refresh exactly once. Replaces the
// per-button finishJob() that previously fired N times for N mounted buttons.
export function JobSideEffectsObserver(): null {
  const queryClient = useQueryClient();
  const { showSuccess, showError, showWarning } = useToast();
  const { refreshUserProfile } = useAuthContext();
  const { refetchBrands, brands } = useBrandContext();

  const depsRef = useRef({
    showSuccess,
    showError,
    showWarning,
    refreshUserProfile,
    refetchBrands,
    brands,
  });
  useEffect(() => {
    depsRef.current = {
      showSuccess,
      showError,
      showWarning,
      refreshUserProfile,
      refetchBrands,
      brands,
    };
  });

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const unsubscribe = cache.subscribe((event) => {
      if (event.type !== 'updated') return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key[0] !== 'reprocessing-job') return;

      const job = event.query.state.data as ReprocessingJob | null | undefined;
      if (!job || !isTerminal(job.status)) return;
      if (NOTIFIED_TERMINAL_JOB_IDS.has(job.id)) return;
      NOTIFIED_TERMINAL_JOB_IDS.add(job.id);

      const deps = depsRef.current;
      const brandName =
        deps.brands.find((b) => b.id === job.brandId)?.companyName || job.brandName;

      if (job.status === 'completed') {
        if (job.failedCount > 0) {
          deps.showWarning(
            'Processing completed with errors',
            `${job.successfulCount} queries succeeded and ${job.failedCount} failed for ${brandName}. Credits were only used for successful queries.`,
          );
        } else {
          deps.showSuccess(
            'All Queries Processed',
            `Successfully processed ${job.successfulCount} queries for ${brandName}. Used ${job.creditsUsed} credits.`,
          );
        }
      } else if (job.status === 'cancelled') {
        deps.showWarning(
          'Processing Cancelled',
          `Attempted ${job.attemptedCount} of ${job.totalQueries} queries before cancellation. ${job.successfulCount} succeeded and ${job.failedCount} failed.`,
        );
      } else if (job.status === 'failed') {
        const latestError =
          job.errors[job.errors.length - 1]?.message || 'Reprocessing job failed.';
        deps.showError('Processing Failed', latestError);
      }

      void Promise.all([deps.refreshUserProfile(), deps.refetchBrands()]).catch(
        (err) => {
          console.error('❌ Error refreshing post-job state:', err);
        },
      );

      // Clear terminal state from the cache after a brief display window so
      // the next interaction starts from idle. Matches the original behavior
      // of resetting status after 5s.
      setTimeout(() => {
        queryClient.setQueryData<ReprocessingJob | null>(
          reprocessingJobQueryKey(job.brandId),
          (current) => (current?.id === job.id ? null : current ?? null),
        );
      }, TERMINAL_DISPLAY_MS);
    });
    return unsubscribe;
  }, [queryClient]);

  return null;
}
