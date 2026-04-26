'use client'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { RefreshCw, Zap, AlertCircle, CheckCircle, RotateCcw, StopCircle, Play } from 'lucide-react';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import {
  buildTrackedQueryIdentity,
} from '@/firebase/firestore/queryResultUtils';

interface ProcessQueriesButtonProps {
  brandId?: string;
  onComplete?: (result: any) => void;
  onProgress?: (job: ReprocessingJobResponse) => void;
  onStart?: (batchQueryIds: string[]) => void; // Fires at batch start with tracked-query identities that are about to be processed
  onQueryStart?: (queryId: string) => void; // New callback for when individual query processing starts
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  autoStart?: boolean; // NEW PROP
  queriesFilter?: string[]; // When set, only process queries whose tracked-query identity matches one of these
  iconOnly?: boolean; // Render as a compact circular icon button (for per-row actions)
}

interface ReprocessingJobResponse {
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

const JOB_POLL_INTERVAL_MS = 2000;

export default function ProcessQueriesButton({
  brandId,
  onComplete,
  onProgress,
  onStart,
  onQueryStart,
  className = '',
  variant = 'primary',
  size = 'md',
  autoStart = false, // NEW PROP
  queriesFilter,
  iconOnly = false,
}: ProcessQueriesButtonProps): React.ReactElement {
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const { selectedBrand, brands, refetchBrands } = useBrandContext();
  const { showSuccess, showError, showWarning, showInfo } = useToast();
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error' | 'cancelled'>('idle');
  const [message, setMessage] = useState('');
  const [activeJob, setActiveJob] = useState<ReprocessingJobResponse | null>(null);
  const [hasHydratedJob, setHasHydratedJob] = useState(false);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startNotifiedJobIdRef = useRef<string | null>(null);
  const completionNotifiedJobIdRef = useRef<string | null>(null);
  const currentQueryIdRef = useRef<string | null>(null);

  // Auto-trigger processing if autoStart becomes true
  const [autoStarted, setAutoStarted] = useState(false);

  const clearPollingTimeout = useCallback(() => {
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  }, []);

  const targetBrandId = brandId || selectedBrand?.id;
  const targetBrand = useMemo(
    () => brands.find((brand) => brand.id === targetBrandId),
    [brands, targetBrandId]
  );

  const getScopedQueries = useCallback((brand: any) => {
    const allBrandQueries = brand?.queries || [];
    if (!queriesFilter || queriesFilter.length === 0) {
      return allBrandQueries;
    }

    return allBrandQueries.filter((query: any) =>
      queriesFilter.includes(buildTrackedQueryIdentity(query))
    );
  }, [queriesFilter]);

  const scopedQueries = useMemo(
    () => getScopedQueries(targetBrand),
    [getScopedQueries, targetBrand]
  );

  const getIdToken = useCallback(async (): Promise<string> => {
    const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
    if (!idToken) {
      throw new Error('Failed to get authentication token. Please sign in again.');
    }
    return idToken;
  }, []);

  const getJobStatusMessage = useCallback((job: ReprocessingJobResponse, brandName: string): string => {
    if (job.status === 'queued') {
      return `Queued ${job.totalQueries} queries for ${brandName}...`;
    }

    if (job.status === 'processing') {
      return `Processing ${job.attemptedCount + (job.currentQueryId ? 1 : 0)} of ${job.totalQueries} queries for ${brandName}...`;
    }

    if (job.status === 'cancelled') {
      return `Processing cancelled after ${job.attemptedCount} of ${job.totalQueries} queries for ${brandName}.`;
    }

    if (job.status === 'failed') {
      return `Processed ${job.successfulCount} of ${job.totalQueries} queries for ${brandName}. ${job.failedCount} failed.`;
    }

    return `Successfully processed ${job.successfulCount} queries for ${brandName}.`;
  }, []);

  const finishJob = useCallback(async (job: ReprocessingJobResponse, brandName: string) => {
    if (completionNotifiedJobIdRef.current === job.id) {
      return;
    }

    completionNotifiedJobIdRef.current = job.id;
    setProcessing(false);

    if (job.status === 'completed') {
      setStatus(job.failedCount > 0 ? 'error' : 'success');
      if (job.failedCount > 0) {
        showWarning(
          'Processing completed with errors',
          `${job.successfulCount} queries succeeded and ${job.failedCount} failed for ${brandName}. Credits were only used for successful queries.`,
        );
      } else {
        setStatus('success');
        showSuccess(
          'All Queries Processed',
          `Successfully processed ${job.successfulCount} queries for ${brandName}. Used ${job.creditsUsed} credits.`,
        );

        const nextProcessingDate = new Date();
        nextProcessingDate.setDate(nextProcessingDate.getDate() + 7);
        const nextProcessingFormatted = nextProcessingDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        setTimeout(() => {
          showInfo(
            'Next Processing Scheduled',
            `Your next automatic processing is scheduled for ${nextProcessingFormatted}.`,
          );
        }, 3000);
      }
    } else if (job.status === 'cancelled') {
      setStatus('cancelled');
      showWarning(
        'Processing Cancelled',
        `Attempted ${job.attemptedCount} of ${job.totalQueries} queries before cancellation. ${job.successfulCount} succeeded and ${job.failedCount} failed.`,
      );
    } else if (job.status === 'failed') {
      setStatus('error');
      const latestError = job.errors[job.errors.length - 1]?.message || 'Reprocessing job failed.';
      showError('Processing Failed', latestError);
    }

    try {
      await Promise.all([refreshUserProfile(), refetchBrands()]);
    } catch (refreshError) {
      console.error('❌ Error refreshing post-job state:', refreshError);
    }

    onComplete?.({
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

    setTimeout(() => {
      setActiveJob((current) => (current?.id === job.id ? null : current));
      setStatus('idle');
      setMessage('');
      startNotifiedJobIdRef.current = null;
      completionNotifiedJobIdRef.current = null;
      currentQueryIdRef.current = null;
    }, 5000);
  }, [
    onComplete,
    refetchBrands,
    refreshUserProfile,
    showError,
    showInfo,
    showSuccess,
    showWarning,
  ]);

  const applyJobState = useCallback(async (job: ReprocessingJobResponse, options: { notifyCompletion?: boolean } = {}) => {
    const brandName = targetBrand?.companyName || job.brandName;
    const isActive = job.status === 'queued' || job.status === 'processing';

    setActiveJob(job);
    setProcessing(isActive);
    setStatus(
      job.status === 'cancelled'
        ? 'cancelled'
        : job.status === 'failed'
        ? 'error'
        : job.status === 'completed'
        ? 'success'
        : 'processing'
    );
    setMessage(getJobStatusMessage(job, brandName));

    if (startNotifiedJobIdRef.current !== job.id) {
      startNotifiedJobIdRef.current = job.id;
      onStart?.(job.queries.map((query) => query.queryId));
    }

    if (job.currentQueryId && currentQueryIdRef.current !== job.currentQueryId) {
      currentQueryIdRef.current = job.currentQueryId;
      onQueryStart?.(job.currentQueryId);
    }

    onProgress?.(job);

    if (!isActive && options.notifyCompletion !== false) {
      await finishJob(job, brandName);
    }
  }, [
    finishJob,
    getJobStatusMessage,
    onProgress,
    onQueryStart,
    onStart,
    targetBrand?.companyName,
  ]);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const idToken = await getIdToken();
      const response = await fetch(`/api/reprocessing-jobs/${jobId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to poll job (${response.status})`);
      }

      const payload = await response.json();
      const job = payload?.job as ReprocessingJobResponse | undefined;
      if (!job) {
        throw new Error('Server did not return a reprocessing job');
      }

      await applyJobState(job);

      if (job.status === 'queued' || job.status === 'processing') {
        clearPollingTimeout();
        pollingTimeoutRef.current = setTimeout(() => {
          void pollJob(job.id);
        }, JOB_POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error('❌ Failed to poll reprocessing job:', error);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Failed to poll reprocessing job');
      setProcessing(false);
    }
  }, [applyJobState, clearPollingTimeout, getIdToken]);

  const hydrateExistingJob = useCallback(async () => {
    if (!user?.uid || !targetBrandId) {
      setHasHydratedJob(true);
      return;
    }

    try {
      const idToken = await getIdToken();
      const response = await fetch(`/api/reprocessing-jobs?brandId=${encodeURIComponent(targetBrandId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load reprocessing job (${response.status})`);
      }

      const payload = await response.json();
      const job = payload?.job as ReprocessingJobResponse | null;
      if (job) {
        await applyJobState(job);

        if (job.status === 'queued' || job.status === 'processing') {
          clearPollingTimeout();
          pollingTimeoutRef.current = setTimeout(() => {
            void pollJob(job.id);
          }, JOB_POLL_INTERVAL_MS);
        }
      } else {
        setActiveJob(null);
        setProcessing(false);
        setStatus('idle');
        setMessage('');
        startNotifiedJobIdRef.current = null;
        completionNotifiedJobIdRef.current = null;
        currentQueryIdRef.current = null;
      }
    } catch (error) {
      console.error('❌ Failed to hydrate reprocessing job:', error);
    } finally {
      setHasHydratedJob(true);
    }
  }, [applyJobState, clearPollingTimeout, getIdToken, pollJob, targetBrandId, user?.uid]);

  useEffect(() => {
    if (autoStart && hasHydratedJob && !autoStarted && !processing) {
      setAutoStarted(true);
      void handleProcessQueries();
    } else if (!autoStart && autoStarted) {
      setAutoStarted(false);
    }
  }, [autoStart, autoStarted, hasHydratedJob, processing]);

  useEffect(() => {
    clearPollingTimeout();
    setHasHydratedJob(false);
    void hydrateExistingJob();

    return () => {
      clearPollingTimeout();
    };
  }, [clearPollingTimeout, hydrateExistingJob]);

  const handleProcessQueries = async () => {
    if (!user?.uid) {
      setStatus('error');
      setMessage('Please sign in to process queries');
      return;
    }

    if (!targetBrand) {
      setStatus('error');
      setMessage('No brand selected');
      return;
    }

    const brandName = targetBrand.companyName;
    const queries = scopedQueries;

    if (queries.length === 0) {
      setStatus('error');
      setMessage('No queries to process');
      return;
    }

    // Always check credits — the server charges every authenticated request,
    // including auto-started batches, so the UI must validate the balance
    // before starting (otherwise the user would only learn of the shortfall
    // mid-batch when individual queries 402 out).
    const requiredCredits = queries.length * 10;
    const availableCredits = userProfile?.credits || 0;

    if (availableCredits < requiredCredits) {
      setStatus('error');
      setMessage(`Insufficient credits. Need ${requiredCredits}, have ${availableCredits}`);

      showError(
        'Insufficient Credits',
        `You need ${requiredCredits} credits to process ${queries.length} queries, but you only have ${availableCredits} credits available.`,
      );

      return;
    }

    setProcessing(true);
    setStatus('processing');
    setMessage(`Processing ${queries.length} queries for ${brandName}... (${requiredCredits} credits)`);

    try {
      const idToken = await getIdToken();
      const response = await fetch('/api/reprocessing-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          brandId: targetBrandId,
          ...(queriesFilter && queriesFilter.length > 0 && { queriesFilter }),
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.code === 'INSUFFICIENT_CREDITS') {
          showError(
            'Insufficient Credits',
            `You need ${payload.requiredCredits} credits but only have ${payload.availableCredits} available.`,
          );
        } else {
          showError(
            'Processing Failed',
            payload?.error || 'Failed to create reprocessing job.',
          );
        }

        throw new Error(payload?.error || `Failed to create reprocessing job (${response.status})`);
      }

      const job = payload?.job as ReprocessingJobResponse | undefined;
      if (!job) {
        throw new Error('Server did not return a reprocessing job');
      }

      await applyJobState(job, { notifyCompletion: false });
      clearPollingTimeout();
      pollingTimeoutRef.current = setTimeout(() => {
        void pollJob(job.id);
      }, JOB_POLL_INTERVAL_MS);
    } catch (error) {
      setProcessing(false);
      setStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Failed to process queries';
      setMessage(errorMessage);
      console.error('Process queries error:', error);
      
      // Show error notification
      showError(
        '❌ Processing Failed',
        'An unexpected error occurred while processing queries. Please check your connection and try again.',
      );
      
      // Reset status after 5 seconds
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 5000);
    }
  };

  const handleStopProcessing = async () => {
    if (!activeJob) return;

    try {
      setMessage('Stopping processing...');
      const idToken = await getIdToken();
      const response = await fetch(`/api/reprocessing-jobs/${activeJob.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: 'cancel',
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel reprocessing job (${response.status})`);
      }

      const payload = await response.json();
      const job = payload?.job as ReprocessingJobResponse | undefined;
      if (job) {
        await applyJobState(job, { notifyCompletion: false });
      }
    } catch (error) {
      console.error('❌ Failed to cancel reprocessing job:', error);
      showError(
        'Cancel Failed',
        error instanceof Error ? error.message : 'Failed to cancel reprocessing job.',
      );
    }
  };

  // Check if queries have been processed
  const getProcessedQueriesCount = () => {
    const targetBrandId = brandId || selectedBrand?.id;
    const targetBrand = brands.find(b => b.id === targetBrandId);
    if (!targetBrand) return 0;

    const processedQueryIds = new Set(
      (targetBrand.queryProcessingResults || []).map((result) => buildTrackedQueryIdentity(result))
    );

    return getScopedQueries(targetBrand).filter((query: any) =>
      processedQueryIds.has(buildTrackedQueryIdentity(query))
    ).length;
  };

  const hasProcessedQueries = getProcessedQueriesCount() > 0 || !!targetBrand?.lastProcessedAt;

  // Calculate required credits
  const getRequiredCredits = () => {
    const targetBrandId = brandId || selectedBrand?.id;
    const targetBrand = brands.find(b => b.id === targetBrandId);
    const scoped = getScopedQueries(targetBrand);
    return scoped.length * 10;
  };

  const requiredCredits = getRequiredCredits();
  const availableCredits = userProfile?.credits || 0;
  const hasEnoughCredits = availableCredits >= requiredCredits;

  // Button styling based on variant and size
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';
  
  const getVariantStyles = () => {
    if (!hasEnoughCredits && requiredCredits > 0) {
      // Insufficient credits styling
      return {
        primary: 'bg-red-600 text-white cursor-not-allowed opacity-70',
        secondary: 'bg-white text-red-600 border border-red-600 cursor-not-allowed opacity-70',
        ghost: 'text-red-600 cursor-not-allowed opacity-70'
      };
    }
    
    if (hasProcessedQueries && status === 'idle') {
      // Different styling for reprocess button
      return {
        primary: 'bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-600',
        secondary: 'bg-white text-orange-600 border border-orange-600 hover:bg-orange-50 focus:ring-orange-600',
        ghost: 'text-orange-600 hover:bg-orange-100 focus:ring-orange-600'
      };
    }
    
    return {
      primary: 'bg-[#000C60] text-white hover:bg-[#000C60]/90 focus:ring-[#000C60]',
      secondary: 'bg-white text-[#000C60] border border-[#000C60] hover:bg-gray-50 focus:ring-[#000C60]',
      ghost: 'text-[#000C60] hover:bg-gray-100 focus:ring-[#000C60]'
    };
  };

  const variantStyles = getVariantStyles();

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm space-x-1.5',
    md: 'px-4 py-2 text-base space-x-2',
    lg: 'px-6 py-3 text-lg space-x-2.5'
  };

  const statusStyles = {
    idle: '',
    processing: 'opacity-80 cursor-not-allowed',
    success: 'bg-green-600 hover:bg-green-700 text-white',
    error: 'bg-red-600 hover:bg-red-700 text-white',
    cancelled: 'bg-yellow-600 hover:bg-yellow-700 text-white'
  };

  // Icon based on status and processed state
  const getIcon = () => {
    switch (status) {
      case 'processing':
        return <RefreshCw className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} animate-spin`} />;
      case 'success':
        return <CheckCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
      case 'error':
        return <AlertCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
      case 'cancelled':
        return <StopCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
      default:
        if (!hasEnoughCredits && requiredCredits > 0) {
          return <AlertCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
        }
        if (hasProcessedQueries) {
          return <RotateCcw className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
        }
        return <Zap className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
    }
  };

  // Button text based on status and processed state
  const getButtonText = () => {
    if (message && status !== 'idle') {
      return message;
    }
    
    if (processing) {
      if (activeJob) {
        return `Processing ${activeJob.attemptedCount}/${activeJob.totalQueries}...`;
      }
      return 'Processing...';
    }
    
    if (!hasEnoughCredits && requiredCredits > 0) {
      return `Need ${requiredCredits} Credits (Have ${availableCredits})`;
    }
    
    if (hasProcessedQueries) {
      return `Reprocess Queries (${requiredCredits} Credits)`;
    }
    
    return `Process Queries (${requiredCredits} Credits)`;
  };

  // Compact circular icon button — used inline in table rows for single-query processing.
  if (iconOnly) {
    const isDisabled = processing || !user || !hasEnoughCredits;
    const tooltip = !user
      ? 'Sign in to process'
      : !hasEnoughCredits
      ? `Needs ${requiredCredits} credits (you have ${availableCredits})`
      : status === 'error'
      ? message || 'Failed — click to retry'
      : 'Process this query';
    return (
      <button
        onClick={handleProcessQueries}
        disabled={isDisabled}
        title={tooltip}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors
          ${status === 'error'
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
            : !hasEnoughCredits && requiredCredits > 0
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : 'bg-primary/10 text-primary hover:bg-primary/20'}
          ${processing ? 'opacity-70 cursor-not-allowed' : ''}
          ${className}`}
      >
        {processing ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : status === 'error' ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center space-x-2">
        <button
          onClick={handleProcessQueries}
          disabled={processing || !user || !hasEnoughCredits}
          className={`
            ${baseStyles}
            ${variantStyles[variant]}
            ${sizeStyles[size]}
            ${statusStyles[status]}
            ${className}
          `}
          title={
            !user ? 'Please sign in to process queries' : 
            !hasEnoughCredits ? `Need ${requiredCredits} credits, you have ${availableCredits}` :
            ''
          }
        >
          {getIcon()}
          <span>{getButtonText()}</span>
        </button>
        
        {/* Stop button - only visible during processing */}
        {processing && !activeJob?.cancellationRequested && (
          <button
            onClick={handleStopProcessing}
            className={`
              ${baseStyles}
              bg-red-600 text-white hover:bg-red-700 focus:ring-red-600
              ${sizeStyles[size]}
              animate-fade-in
            `}
            title="Stop processing queries"
          >
            <StopCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />
            <span>Stop</span>
          </button>
        )}
      </div>
      
      {processing && (
        <p className="text-xs text-green-600 mt-1 font-medium text-center">
          Processing continues on the server if you leave this page.
        </p>
      )}
      
      {/* Credit information */}
      {!processing && requiredCredits > 0 && (
        <p className="text-xs text-muted-foreground mt-1 text-center">
          {hasEnoughCredits ? 
            `Ready: ${availableCredits} credits available` : 
            `Need ${requiredCredits - availableCredits} more credits`
          }
        </p>
      )}
    </div>
  );
}
