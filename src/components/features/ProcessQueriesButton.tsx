'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { RefreshCw, Zap, AlertCircle, CheckCircle, RotateCcw, StopCircle, Play } from 'lucide-react';
import { buildTrackedQueryIdentity } from '@/lib/queryResultUtils';
import {
  InsufficientCreditsError,
  useReprocessingJob,
  type ReprocessingJob,
  type ReprocessingJobCompletionResult,
} from '@/hooks/useReprocessingJob';

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
  const { user, userProfile } = useAuthContext();
  const { selectedBrand, brands } = useBrandContext();
  const { showError } = useToast();

  const targetBrandId = brandId || selectedBrand?.id;
  const targetBrand = useMemo(
    () => brands.find((brand) => brand.id === targetBrandId),
    [brands, targetBrandId],
  );

  const getScopedQueries = useCallback(
    (brand: any) => {
      const all = brand?.queries || [];
      if (!queriesFilter || queriesFilter.length === 0) return all;
      return all.filter((q: any) =>
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

  // Pre-flight errors (no user, no brand, no queries, insufficient credits)
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
      setLocalError('Please sign in to process queries');
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

    const required = queries.length * 10;
    const available = userProfile?.credits || 0;
    if (available < required) {
      setLocalError(`Insufficient credits. Need ${required}, have ${available}`);
      showError(
        'Insufficient Credits',
        `You need ${required} credits to process ${queries.length} queries, but you only have ${available} credits available.`,
      );
      return;
    }

    setLocalError(null);
    try {
      await startJob({ queriesFilter });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        showError(
          'Insufficient Credits',
          `You need ${err.requiredCredits} credits but only have ${err.availableCredits} available.`,
        );
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to process queries';
        showError('Processing Failed', msg);
      }
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
    return getScopedQueries(targetBrand).filter((q: any) =>
      processedQueryIds.has(buildTrackedQueryIdentity(q)),
    ).length;
  };

  const hasProcessedQueries =
    getProcessedQueriesCount() > 0 || !!targetBrand?.lastProcessedAt;

  const requiredCredits = scopedQueries.length * 10;
  const availableCredits = userProfile?.credits || 0;
  const hasEnoughCredits = availableCredits >= requiredCredits;

  // Display state combines hook status with local pre-flight errors.
  const displayStatus: 'idle' | 'processing' | 'success' | 'error' | 'cancelled' =
    localError ? 'error' : status;
  const displayMessage = localError ?? message;

  // Compact circular icon button — used inline in table rows.
  if (iconOnly) {
    const isDisabled = processing || isSubmitting || !user || !hasEnoughCredits;
    const tooltip = !user
      ? 'Sign in to process'
      : !hasEnoughCredits
      ? `Needs ${requiredCredits} credits (you have ${availableCredits})`
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
            : !hasEnoughCredits && requiredCredits > 0
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
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
    if (!hasEnoughCredits && requiredCredits > 0) {
      return {
        primary: 'bg-red-600 text-white cursor-not-allowed opacity-70',
        secondary: 'bg-white text-red-600 border border-red-600 cursor-not-allowed opacity-70',
        ghost: 'text-red-600 cursor-not-allowed opacity-70',
      };
    }
    if (hasProcessedQueries && displayStatus === 'idle') {
      return {
        primary: 'bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-600',
        secondary: 'bg-white text-orange-600 border border-orange-600 hover:bg-orange-50 focus:ring-orange-600',
        ghost: 'text-orange-600 hover:bg-orange-100 focus:ring-orange-600',
      };
    }
    return {
      primary: 'bg-[#000C60] text-white hover:bg-[#000C60]/90 focus:ring-[#000C60]',
      secondary: 'bg-white text-[#000C60] border border-[#000C60] hover:bg-gray-50 focus:ring-[#000C60]',
      ghost: 'text-[#000C60] hover:bg-gray-100 focus:ring-[#000C60]',
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
    success: 'bg-green-600 hover:bg-green-700 text-white',
    error: 'bg-red-600 hover:bg-red-700 text-white',
    cancelled: 'bg-yellow-600 hover:bg-yellow-700 text-white',
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
        if (!hasEnoughCredits && requiredCredits > 0) {
          return <AlertCircle className={iconSize} />;
        }
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
    if (!hasEnoughCredits && requiredCredits > 0) {
      return `Need ${requiredCredits} Credits (Have ${availableCredits})`;
    }
    if (hasProcessedQueries) {
      return `Reprocess Queries (${requiredCredits} Credits)`;
    }
    return `Process Queries (${requiredCredits} Credits)`;
  };

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center space-x-2">
        <button
          onClick={handleProcessQueries}
          disabled={processing || isSubmitting || !user || !hasEnoughCredits}
          className={`
            ${baseStyles}
            ${variantStyles[variant]}
            ${sizeStyles[size]}
            ${statusStyles[displayStatus]}
            ${className}
          `}
          title={
            !user
              ? 'Please sign in to process queries'
              : !hasEnoughCredits
              ? `Need ${requiredCredits} credits, you have ${availableCredits}`
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
              bg-red-600 text-white hover:bg-red-700 focus:ring-red-600
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
        <p className="text-xs text-green-600 mt-1 font-medium text-center">
          Processing continues on the server if you leave this page.
        </p>
      )}

      {!processing && !isSubmitting && requiredCredits > 0 && (
        <p className="text-xs text-muted-foreground mt-1 text-center">
          {hasEnoughCredits
            ? `Ready: ${availableCredits} credits available`
            : `Need ${requiredCredits - availableCredits} more credits`}
        </p>
      )}
    </div>
  );
}
