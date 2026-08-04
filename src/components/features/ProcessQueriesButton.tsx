'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { RefreshCw, Zap, AlertCircle, CheckCircle, RotateCcw, StopCircle, Play } from 'lucide-react';
import { buildTrackedQueryIdentity } from '@/lib/queryResultUtils';
import {
  useReprocessingJob,
  type ReprocessingJob,
  type ReprocessingJobCompletionResult,
} from '@/hooks/useReprocessingJob';
import type { UserBrand } from '@/types/userBrand';

interface ProcessQueriesButtonProps {
  brandId?: string;
  onComplete?: (result: ReprocessingJobCompletionResult) => void;
  onProgress?: (job: ReprocessingJob) => void;
  onStart?: (batchQueryIds: string[]) => void;
  onQueryStart?: (queryId: string) => void;
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  queriesFilter?: string[];
  iconOnly?: boolean;
}

export default function ProcessQueriesButton({
  brandId,
  onComplete,
  onProgress,
  onStart,
  onQueryStart,
  className = '',
  variant = 'primary',
  size = 'md',
  queriesFilter,
  iconOnly = false,
}: ProcessQueriesButtonProps): React.ReactElement {
  const { user } = useAuthContext();
  const { selectedBrand, brands } = useBrandContext();
  const { showError } = useToast();

  const targetBrandId = brandId || selectedBrand?.id;
  const targetBrand = useMemo(
    () => brands.find((brand) => brand.id === targetBrandId),
    [brands, targetBrandId],
  );

  const getScopedQueries = useCallback(
    (brand: UserBrand | undefined) => {
      const all = brand?.queries || [];
      if (!queriesFilter || queriesFilter.length === 0) return all;
      return all.filter((q) =>
        queriesFilter.includes(buildTrackedQueryIdentity(q)),
      );
    },
    [queriesFilter],
  );

  const scopedQueries = useMemo(
    () => getScopedQueries(targetBrand),
    [getScopedQueries, targetBrand],
  );

  const { job, status, message, processing, isSubmitting, startJob, cancelJob } =
    useReprocessingJob(targetBrandId, {
      onStart,
      onQueryStart,
      onProgress,
      onComplete,
    });

  // Pre-flight errors (no user, no brand, or no queries)
  // surface inline before we POST. Server-side errors are handled by the
  // hook's mutation and the global JobSideEffectsObserver.
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (!localError) return;
    const t = setTimeout(() => setLocalError(null), 5000);
    return () => clearTimeout(t);
  }, [localError]);

  const handleProcessQueries = async () => {
    if (!user?.uid) {
      setLocalError('Add an OpenRouter key to process queries');
      return;
    }
    if (!targetBrand) {
      setLocalError('No brand selected');
      return;
    }

    const queries = scopedQueries;
    if (queries.length === 0) {
      setLocalError('No queries to process');
      return;
    }

    setLocalError(null);
    try {
      await startJob({ queriesFilter });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to process queries';
      showError('Processing Failed', msg);
    }
  };

  const handleStopProcessing = async () => {
    try {
      await cancelJob();
    } catch (err) {
      showError(
        'Cancel Failed',
        err instanceof Error ? err.message : 'Failed to cancel reprocessing job.',
      );
    }
  };

  const getProcessedQueriesCount = () => {
    if (!targetBrand) return 0;
    const processedQueryIds = new Set(
      (targetBrand.queryProcessingResults || []).map((result) =>
        buildTrackedQueryIdentity(result),
      ),
    );
    return getScopedQueries(targetBrand).filter((q) =>
      processedQueryIds.has(buildTrackedQueryIdentity(q)),
    ).length;
  };

  const hasProcessedQueries =
    getProcessedQueriesCount() > 0 || !!targetBrand?.lastProcessedAt;

  // Display state combines hook status with local pre-flight errors.
  const displayStatus: 'idle' | 'processing' | 'success' | 'error' | 'cancelled' =
    localError ? 'error' : status;
  const displayMessage = localError ?? message;

  // Compact circular icon button — used inline in table rows.
  if (iconOnly) {
    const isDisabled = processing || isSubmitting || !user;
    const tooltip = !user
      ? 'Add an OpenRouter key to process'
      : displayStatus === 'error'
      ? displayMessage || 'Failed — click to retry'
      : 'Process this query';
    return (
      <button
        onClick={handleProcessQueries}
        disabled={isDisabled}
        title={tooltip}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors
          ${displayStatus === 'error'
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
            : 'bg-primary/10 text-primary hover:bg-primary/20'}
          ${processing || isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}
          ${className}`}
      >
        {processing || isSubmitting ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : displayStatus === 'error' ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>
    );
  }

  // Full button variant
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';

  const getVariantStyles = () => {
    return {
      primary: 'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary',
      secondary: 'bg-background text-primary border border-primary hover:bg-primary/5 focus:ring-primary',
      ghost: 'text-primary hover:bg-primary/10 focus:ring-primary',
    };
  };

  const variantStyles = getVariantStyles();

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm space-x-1.5',
    md: 'px-4 py-2 text-base space-x-2',
    lg: 'px-6 py-3 text-lg space-x-2.5',
  };

  const statusStyles = {
    idle: '',
    processing: 'opacity-80 cursor-not-allowed',
    success: 'bg-success hover:bg-success/90 text-white',
    error: 'bg-destructive hover:bg-destructive/90 text-destructive-foreground',
    cancelled: 'bg-warning hover:bg-warning/90 text-foreground',
  };

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';

  const getIcon = () => {
    switch (displayStatus) {
      case 'processing':
        return <RefreshCw className={`${iconSize} animate-spin`} />;
      case 'success':
        return <CheckCircle className={iconSize} />;
      case 'error':
        return <AlertCircle className={iconSize} />;
      case 'cancelled':
        return <StopCircle className={iconSize} />;
      default:
        if (hasProcessedQueries) {
          return <RotateCcw className={iconSize} />;
        }
        return <Zap className={iconSize} />;
    }
  };

  const getButtonText = () => {
    if (displayMessage && displayStatus !== 'idle') {
      return displayMessage;
    }
    if (processing || isSubmitting) {
      if (job) {
        return `Processing ${job.attemptedCount}/${job.totalQueries}...`;
      }
      return 'Processing...';
    }
    if (hasProcessedQueries) {
      return 'Reprocess Queries';
    }
    return 'Process Queries';
  };

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center space-x-2">
        <button
          onClick={handleProcessQueries}
          disabled={processing || isSubmitting || !user}
          className={`
            ${baseStyles}
            ${variantStyles[variant]}
            ${sizeStyles[size]}
            ${statusStyles[displayStatus]}
            ${className}
          `}
          title={
            !user
              ? 'Add an OpenRouter key to process queries'
              : ''
          }
        >
          {getIcon()}
          <span>{getButtonText()}</span>
        </button>

        {processing && !job?.cancellationRequested && (
          <button
            onClick={handleStopProcessing}
            className={`
              ${baseStyles}
              bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:ring-destructive
              ${sizeStyles[size]}
              animate-fade-in
            `}
            title="Stop processing queries"
          >
            <StopCircle className={iconSize} />
            <span>Stop</span>
          </button>
        )}
      </div>

      {processing && (
        <p className="text-xs text-success mt-1 font-medium text-center">
          Processing continues on the server if you leave this page.
        </p>
      )}

    </div>
  );
}
