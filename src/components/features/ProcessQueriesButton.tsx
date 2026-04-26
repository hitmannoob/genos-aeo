'use client'
import React, { useState, useRef, useEffect } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { RefreshCw, Zap, AlertCircle, CheckCircle, RotateCcw, StopCircle, CreditCard, Play } from 'lucide-react';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
// Shared persistence helpers — same pipeline used by /api/cron/process-scheduled.
// If a bug shows up in per-query or lifetime saves, fix it in the helper and
// both manual and scheduled paths pick it up.
import {
  refreshLifetimeSnapshot,
} from '@/firebase/firestore/persistQueryResult';
import {
  buildTrackedQueryIdentity,
  type QueryProcessingResult,
} from '@/firebase/firestore/queryResultUtils';

interface ProcessQueriesButtonProps {
  brandId?: string;
  onComplete?: (result: any) => void;
  onProgress?: (results: QueryProcessingResult[]) => void; // New callback for real-time updates
  onStart?: (batchQueryIds: string[]) => void; // Fires at batch start with tracked-query identities that are about to be processed
  onQueryStart?: (queryId: string) => void; // New callback for when individual query processing starts
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  autoStart?: boolean; // NEW PROP
  queriesFilter?: string[]; // When set, only process queries whose tracked-query identity matches one of these
  iconOnly?: boolean; // Render as a compact circular icon button (for per-row actions)
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
  const [processedResults, setProcessedResults] = useState<QueryProcessingResult[]>([]);
  
  // Add ref to track cancellation
  const cancelledRef = useRef(false);

  // Auto-trigger processing if autoStart becomes true
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (autoStart && !autoStarted && !processing) {
      setAutoStarted(true);
      handleProcessQueries();
    } else if (!autoStart && autoStarted) {
      setAutoStarted(false);
    }
  }, [autoStart, autoStarted, processing]);

  const getScopedQueries = (targetBrand: any) => {
    const allBrandQueries = targetBrand?.queries || [];
    if (!queriesFilter || queriesFilter.length === 0) {
      return allBrandQueries;
    }

    return allBrandQueries.filter((query: any) =>
      queriesFilter.includes(buildTrackedQueryIdentity(query))
    );
  };

  const handleProcessQueries = async () => {
    if (!user?.uid) {
      setStatus('error');
      setMessage('Please sign in to process queries');
      return;
    }

    // Check user credits (10 credits per query) - Skip if autoStart is true
    const targetBrandId = brandId || selectedBrand?.id;
    const targetBrand = brands.find(b => b.id === targetBrandId);
    
    if (!targetBrand) {
      setStatus('error');
      setMessage('No brand selected');
      return;
    }

    const brandName = targetBrand.companyName;
    const queries = getScopedQueries(targetBrand);

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
    setProcessedResults([]); // Reset processed results
    cancelledRef.current = false;

    // Notify parent that processing has started — pass the batch so the UI
    // can scope its "Processing" state to queries actually in this run.
    if (onStart) {
      onStart(queries.map((query: any) => buildTrackedQueryIdentity(query)));
    }

    try {
      // Get Firebase ID token for authentication with retry logic
      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      
      if (!idToken) {
        throw new Error('Failed to get authentication token. Please sign in again.');
      }

      // Generate unique processing session identifier
      const processingSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const processingSessionTimestamp = new Date().toISOString();
      
      // Process queries one by one and save incrementally. `allResults`
      // is reassigned to the updated accumulator returned by the shared
      // persistence helper, so `let`.
      let allResults: QueryProcessingResult[] = [];
      let successfulCount = 0;
      let failedCount = 0;

      for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
        const query = queries[queryIndex];
        // Check if cancelled
        if (cancelledRef.current) {
          break;
        }

        try {
          // Notify parent that this specific query is starting
          if (onQueryStart) {
            onQueryStart(buildTrackedQueryIdentity(query));
          }

          setMessage(`Processing query ${queryIndex + 1} of ${queries.length} for ${brandName}... (10 credits per query)`);
          
          // Process individual query with authentication and server-owned
          // persistence. The API only returns 200 once the result has been
          // durably written (or it refunds credits and errors).

          let response;
          try {
            response = await fetch(`${window.location.origin}/api/user-query`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`, // Add Firebase ID token
              },
              body: JSON.stringify({
                query: query.query,
                context: `This query is related to ${targetBrand.companyName} in the ${query.category} category. Topic: ${query.keyword}.`,
                // Note: `isAutoStart` is no longer sent. The server ignores
                // client-set bypass flags and charges every authenticated
                // request — only the cron path (server-side secret) skips
                // billing. Auto-started UI batches now cost credits like
                // manual ones.
                persistResult: true,
                brandId: targetBrandId,
                brandName: targetBrand.companyName,
                brandDomain: targetBrand.domain,
                keyword: query.keyword,
                category: query.category,
                processingSessionId,
                processingSessionTimestamp,
                clientRequestId: [
                  processingSessionId,
                  query.category,
                  query.keyword || '',
                  query.query,
                ].join('::'),
              }),
            });
          } catch (fetchError) {
            console.error('❌ Fetch error:', fetchError);
            throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown fetch error'}`);
          }

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API error response:', errorText);

            let errorData: any = null;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              // Body wasn't JSON — fall through to the generic network-error branch.
            }

            if (!errorData) {
              showError(
                'Network Error',
                'Failed to communicate with the server. Please check your connection and try again.',
              );
              throw new Error(`Failed to process query (${response.status}): ${query.query.substring(0, 30)}...`);
            }

            if (errorData.code === 'INSUFFICIENT_CREDITS') {
              showError(
                'Insufficient Credits',
                `You need ${errorData.requiredCredits} credits but only have ${errorData.availableCredits} available.`,
              );
              throw new Error(`Insufficient credits: Need ${errorData.requiredCredits}, have ${errorData.availableCredits}`);
            }

            if (errorData.code === 'AUTHENTICATION_REQUIRED') {
              showError(
                'Authentication Failed',
                'Please sign in again to continue processing queries.',
              );
              throw new Error('Authentication failed. Please sign in again.');
            }

            showError(
              'Query Processing Failed',
              errorData.error || 'An unexpected error occurred while processing your query.',
            );
            throw new Error(errorData.error || `Failed to process query (${response.status})`);
          }

          const queryData = await response.json();

          // Don't refresh the profile inside the loop — the `finally` block
          // does a single refresh once the batch is done. Per-iteration
          // refreshes can race against each other and against the batch's
          // own deductions, briefly flashing stale credits in the sidebar.

          const persistedQueryResult = queryData.persistedQueryResult as QueryProcessingResult | undefined;
          if (!persistedQueryResult) {
            throw new Error('Server did not return the persisted query result');
          }

          allResults = [
            ...allResults.filter((existing) => !(
              existing.processingSessionId === persistedQueryResult.processingSessionId &&
              existing.query === persistedQueryResult.query &&
              existing.keyword === persistedQueryResult.keyword &&
              existing.category === persistedQueryResult.category
            )),
            persistedQueryResult,
          ];
          successfulCount++;

          // Update local state immediately to show progress
          setProcessedResults([...allResults]);

          // Notify parent component about progress
          if (onProgress) {
            onProgress([...allResults]);
          }

          // Competitor analytics are live-computed at view time from
          // brand.queryProcessingResults (see calculateLiveCompetitorAnalytics),
          // so no separate snapshot write is needed here.

          // Small delay between queries
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (queryError) {
          console.error(`Error processing query: ${query.query}`, queryError);
          
          // If it's a credit or auth error, stop processing
          if (queryError instanceof Error && 
              (queryError.message.includes('Insufficient credits') || 
               queryError.message.includes('Authentication failed'))) {
            setStatus('error');
            setMessage(queryError.message);
            return;
          }
          
          failedCount++;
        }
      }

      const attemptedCount = successfulCount + failedCount;

      // Check if cancelled
      if (cancelledRef.current) {
        setStatus('cancelled');
        setMessage(`Processing cancelled. Attempted ${attemptedCount} of ${queries.length} queries.`);
        showWarning(
          '⏸️ Processing Cancelled',
          `Attempted ${attemptedCount} of ${queries.length} queries before cancellation. ${successfulCount} succeeded and ${failedCount} failed.`
        );
      } else if (failedCount > 0) {
        setStatus('error');
        setMessage(`Processed ${successfulCount} of ${queries.length} queries for ${brandName}. ${failedCount} failed.`);
        showWarning(
          'Processing completed with errors',
          `${successfulCount} queries succeeded and ${failedCount} failed for ${brandName}. Credits were only used for successful queries.`
        );
      } else {
        setStatus('success');
        setMessage(`Successfully processed ${successfulCount} queries for ${brandName}! (${successfulCount * 10} credits used)`);
        // Calculate next processing date (7 days from now)
        const nextProcessingDate = new Date();
        nextProcessingDate.setDate(nextProcessingDate.getDate() + 7);
        const nextProcessingFormatted = nextProcessingDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        
        showSuccess(
          '🎉 All Queries Processed!',
          `Successfully processed ${successfulCount} queries for ${brandName}. Used ${successfulCount * 10} credits.`
        );
        
        // Show scheduling information after a brief delay
        setTimeout(() => {
          showInfo(
            '📅 Next Processing Scheduled',
            `Your next automatic processing is scheduled for ${nextProcessingFormatted}. You can also process queries manually anytime.`
          );
        }, 3000);
      }

      // Analytics are now calculated and saved incrementally after each query
      // No need for final analytics calculation since it's done per query

      // Refresh lifetime snapshot after completing all queries so the
      // Overview page's Lifetime tab reflects reality. Runs even when the
      // user cancelled mid-batch, as long as at least one query persisted.
      if (successfulCount > 0) {
        setMessage(`Updating lifetime analytics for ${brandName}...`);
        const { success: lifetimeOk, error: lifetimeError } =
          await refreshLifetimeSnapshot(targetBrandId!, user!.uid);
        if (!lifetimeOk) {
          console.error('❌ Error refreshing lifetime snapshot:', lifetimeError);
          // Don't fail the whole process for a snapshot miss.
        }
      }

      // Call the onComplete callback if provided
      if (onComplete) {
        onComplete({
          success: !cancelledRef.current && failedCount === 0,
          cancelled: cancelledRef.current,
          queryResults: allResults,
          summary: {
            totalQueries: queries.length,
            attemptedQueries: attemptedCount,
            processedQueries: successfulCount,
            totalErrors: failedCount,
            creditsUsed: successfulCount * 10
          }
        });
      }

      // Force a complete refresh of brand data to ensure all components update
      try {
        await refetchBrands();
      } catch (refreshError) {
        console.error('❌ Error during final brand data refresh:', refreshError);
      }

      // Reset status after 5 seconds
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 5000);

    } catch (error) {
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
    } finally {
      setProcessing(false);
      cancelledRef.current = false; // Reset cancellation flag
      
      // Refresh user profile to show updated credits
      try {
        await refreshUserProfile();
      } catch (refreshError) {
        console.error('❌ Error refreshing user profile:', refreshError);
      }
      
      // Do a final refresh to get the latest data
      try {
        await refetchBrands();
      } catch (error) {
        console.error('Error doing final refresh:', error);
      }
    }
  };

  const handleStopProcessing = () => {
    cancelledRef.current = true;
    setMessage('Stopping processing...');
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

  const hasProcessedQueries = getProcessedQueriesCount() > 0;

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
      return 'Processing...';
    }
    
    if (!hasEnoughCredits && requiredCredits > 0) {
      return `Need ${requiredCredits} Credits (Have ${availableCredits})`;
    }
    
    if (hasProcessedQueries) {
      const count = getProcessedQueriesCount();
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
        {processing && !cancelledRef.current && (
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
          ⚠️ Don't Refresh or Leave Page while Queries are Processing
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
