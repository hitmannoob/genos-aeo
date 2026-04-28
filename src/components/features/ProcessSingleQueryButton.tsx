'use client'
import React, { useState } from 'react';
import { Play, RefreshCw, AlertCircle } from 'lucide-react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';
import { buildTrackedQueryIdentity } from '@/lib/queryResultUtils';

const REQUIRED_CREDITS = 10;

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
  className?: string;
}

export default function ProcessSingleQueryButton({
  brandId,
  query,
  onStart,
  onComplete,
  className = '',
}: ProcessSingleQueryButtonProps): React.ReactElement {
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const { brands, refetchBrands } = useBrandContext();
  const { showError } = useToast();
  const [processing, setProcessing] = useState(false);
  const [errored, setErrored] = useState(false);

  const queryId = buildTrackedQueryIdentity(query);
  const targetBrand = brands.find((b) => b.id === brandId);
  const available = userProfile?.credits ?? 0;
  const hasEnoughCredits = available >= REQUIRED_CREDITS;
  const disabled = processing || !user || !hasEnoughCredits || !targetBrand;

  const tooltip = !user
    ? 'Sign in to process'
    : !targetBrand
    ? 'Brand not loaded'
    : !hasEnoughCredits
    ? `Needs ${REQUIRED_CREDITS} credits (you have ${available})`
    : errored
    ? 'Failed — click to retry'
    : 'Process this query';

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || !targetBrand) return;

    setProcessing(true);
    setErrored(false);
    onStart?.(queryId);

    let success = false;
    try {
      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      if (!idToken) throw new Error('Failed to get authentication token');

      const sessionTimestamp = new Date().toISOString();
      const rand = Math.random().toString(36).slice(2, 10);
      const sessionId = `single-${brandId}-${Date.now()}-${rand}`;
      const clientRequestId = `single::${brandId}::${queryId}::${Date.now()}-${rand}`;

      const response = await fetch('/api/user-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          query: query.query,
          context: `This query is related to ${targetBrand.companyName} in the ${query.category} category. Topic: ${query.keyword}.`,
          persistResult: true,
          brandId: targetBrand.id,
          brandName: targetBrand.companyName,
          brandDomain: targetBrand.domain,
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
      await Promise.all([refreshUserProfile(), refetchBrands()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process query';
      showError('Processing failed', message);
      setErrored(true);
    } finally {
      setProcessing(false);
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
        ${processing ? 'opacity-70 cursor-not-allowed' : ''}
        ${className}`}
    >
      {processing ? (
        <RefreshCw className="h-4 w-4 animate-spin" />
      ) : errored ? (
        <AlertCircle className="h-4 w-4" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </button>
  );
}
