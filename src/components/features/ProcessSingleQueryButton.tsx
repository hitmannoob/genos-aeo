'use client'
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { usePendingSingleQueries } from '@/context/PendingSingleQueriesContext';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import { buildTrackedQueryIdentity } from '@/lib/queryResultUtils';
import { brandQueriesQueryKey } from '@/hooks/useBrandQueries';
import { USER_QUERY_CREDIT_COST } from '@/lib/billing/creditCosts';

interface SingleQueryDescriptor {
  query: string;
  keyword: string;
  category: string;
}

interface ProcessSingleQueryButtonProps {
  brandId: string;
  query: SingleQueryDescriptor;
  onStart?: (queryId: string) => void;
  onComplete?: (queryId: string, success: boolean) => void;
  // True while the row is being processed by *any* flow (bulk job or another
  // single-query run). Lets the parent disable the button for queries that
  // didn't initiate processing from this button instance.
  isProcessing?: boolean;
  className?: string;
}

export default function ProcessSingleQueryButton({
  brandId,
  query,
  onStart,
  onComplete,
  isProcessing = false,
  className = '',
}: ProcessSingleQueryButtonProps): React.ReactElement {
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const { brands, refetchBrands } = useBrandContext();
  const { showError, showWarning } = useToast();
  const { addPending, removePending, getPending } = usePendingSingleQueries();
  const queryClient = useQueryClient();
  const [errored, setErrored] = useState(false);

  const queryId = buildTrackedQueryIdentity(query);
  const targetBrand = brands.find((b) => b.id === brandId);
  const available = userProfile?.credits ?? 0;
  const hasEnoughCredits = available >= USER_QUERY_CREDIT_COST;
  // The shared pending set lives in context, so even if this exact button
  // unmounts mid-fetch (user navigated away and a sibling instance now
  // renders the row), the "is in flight" signal survives.
  const pendingForBrand = getPending(brandId);
  const inFlight = pendingForBrand.has(queryId);
  const busy = inFlight || isProcessing;
  const disabled = busy || !user || !hasEnoughCredits || !targetBrand;

  const tooltip = !user
    ? 'Sign in to process'
    : !targetBrand
    ? 'Brand not loaded'
    : !hasEnoughCredits
    ? `Needs ${USER_QUERY_CREDIT_COST} credits (you have ${available})`
    : busy
    ? 'Processing…'
    : errored
    ? 'Failed — click to retry'
    : 'Process this query';

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || !targetBrand) return;

    addPending(brandId, queryId);
    setErrored(false);
    onStart?.(queryId);

    let success = false;
    try {
      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      if (!idToken) throw new Error('Failed to get authentication token');

      const sessionTimestamp = new Date().toISOString();
      const requestId = crypto.randomUUID();
      const sessionId = `single-${requestId}`;
      const clientRequestId = `single:${requestId}`;

      const response = await fetch('/api/user-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          query: query.query,
          persistResult: true,
          brandId: targetBrand.id,
          keyword: query.keyword,
          category: query.category,
          processingSessionId: sessionId,
          processingSessionTimestamp: sessionTimestamp,
          clientRequestId,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const message =
          payload?.error || `Failed to process query (${response.status})`;
        throw new Error(message);
      }

      success = true;
      // Invalidate the shared brand-queries cache BEFORE clearing the pending
      // flag — that way wherever the table is rendered (including a remount
      // on another mounting of QueriesOverview), it pulls the freshly
      // persisted result and never sees a "Unprocessed" gap between flag
      // clearing and result landing.
      await queryClient.invalidateQueries({
        queryKey: brandQueriesQueryKey(user?.uid, brandId),
      });
      const syncResults = await Promise.allSettled([
        refreshUserProfile(),
        refetchBrands(),
      ]);
      if (syncResults.some((result) => result.status === 'rejected')) {
        showWarning(
          'Query processed',
          'The result was saved, but some dashboard data could not refresh. Reload the page to sync it.'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process query';
      showError('Processing failed', message);
      setErrored(true);
    } finally {
      removePending(brandId, queryId);
      onComplete?.(queryId, success);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      title={tooltip}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors
        ${
          errored
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
            : !hasEnoughCredits
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : 'bg-primary/10 text-primary hover:bg-primary/20'
        }
        ${busy ? 'opacity-70 cursor-not-allowed' : ''}
        ${className}`}
    >
      {busy ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : errored ? (
        <AlertCircle className="h-4 w-4" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </button>
  );
}
