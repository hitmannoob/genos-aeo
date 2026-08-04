'use client';

import React, { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import type {
  BrandAnalyticsData,
  LifetimeBrandAnalytics,
} from '@/lib/analytics/brandAnalytics';
import type { DashboardCitationSummary } from '@/lib/dashboardPdf';
import type { RecommendationData } from '@/lib/recommendation-types';
import type { UserBrand } from '@/types/userBrand';

interface DashboardPdfButtonProps {
  brand: UserBrand;
  latestAnalytics?: BrandAnalyticsData | null;
  lifetimeAnalytics?: LifetimeBrandAnalytics | null;
  citationSummary?: DashboardCitationSummary | null;
  recommendations?: RecommendationData[];
  disabled?: boolean;
}

export default function DashboardPdfButton({
  brand,
  latestAnalytics,
  lifetimeAnalytics,
  citationSummary,
  recommendations,
  disabled = false,
}: DashboardPdfButtonProps): React.ReactElement {
  const [generating, setGenerating] = useState(false);
  const { showSuccess, showError } = useToast();

  const handleDownload = async () => {
    setGenerating(true);
    try {
      const { downloadDashboardPdf } = await import('@/lib/dashboardPdf');
      await downloadDashboardPdf({
        brand,
        latestAnalytics,
        lifetimeAnalytics,
        citationSummary,
        recommendations,
      });
      showSuccess('Dashboard PDF ready', `Downloaded the current ${brand.companyName} snapshot.`);
    } catch (error) {
      showError(
        'PDF download failed',
        error instanceof Error ? error.message : 'Could not create the dashboard PDF.'
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={disabled || generating}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-background px-4 py-2 text-sm font-semibold text-primary shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      title="Download this dashboard snapshot as a PDF"
    >
      {generating ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      <span>{generating ? 'Preparing PDF...' : 'Download PDF'}</span>
    </button>
  );
}
