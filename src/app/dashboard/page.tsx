'use client'
import React, { useEffect, useMemo } from "react";
import { useAuthContext } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { BarChart3, RefreshCw, AlertCircle } from 'lucide-react';
import Link from 'next/link';

import DashboardLayout from '@/components/layout/DashboardLayout';
import QueriesOverview from '@/components/features/QueriesOverview';
import RecommendationSection from '@/components/features/RecommendationSection';
import { useBrandContext } from '@/context/BrandContext';
import BrandAnalyticsDisplay from '@/components/features/BrandAnalyticsDisplay';
import { useBrandAnalyticsCombined } from '@/hooks/useBrandAnalytics';
import LifetimeAnalyticsCharts from '@/components/features/LifetimeAnalyticsCharts';
import CompetitorMentionsCard from '@/components/features/CompetitorMentionsCard';


function Page(): React.ReactElement {
  const { user, loading: authLoading } = useAuthContext();
  const router = useRouter();
  const { selectedBrand, selectedBrandId, brands, loading: brandsLoading } = useBrandContext();
  const {
    latestAnalytics,
    lifetimeAnalytics,
    recommendations,
    loading: analyticsLoading,
    error: analyticsError,
    hasLatestData,
    hasLifetimeData,
    refetchLatest,
  } = useBrandAnalyticsCombined(selectedBrand?.id);

  // Citation summary for overview cards is derived from the SAME lifetime
  // analytics computation that powers brand mentions / provider stats below.
  // This guarantees the citation cards, provider performance, and SOV chart
  // all agree on one corpus + one matcher + one snapshot in time.
  const citationAnalytics = useMemo(() => {
    const allCitations = lifetimeAnalytics?.allCitations;
    if (!allCitations || !selectedBrand) return null;

    const analyticsCitations = allCitations.filter(c => c.domain);
    const totalCitations = analyticsCitations.length;
    const domainCitations = analyticsCitations.filter(c => c.isDomainCitation).length;
    const brandMentions = analyticsCitations.filter(c => c.isBrandMention).length;
    const uniqueDomains = new Set(analyticsCitations.map(c => c.domain)).size;

    const providerStats = {
      chatgpt: analyticsCitations.filter(c => c.provider === 'chatgpt').length,
      perplexity: analyticsCitations.filter(c => c.provider === 'perplexity').length,
      googleAI: analyticsCitations.filter(c => c.provider === 'googleAI').length
    };

    const topDomains = Object.entries(
      analyticsCitations.reduce((acc, citation) => {
        if (citation.domain) {
          acc[citation.domain] = (acc[citation.domain] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>)
    )
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    return {
      totalCitations,
      domainCitations,
      brandMentions,
      uniqueDomains,
      providerStats,
      topDomains,
      domainCitationRate: totalCitations > 0 ? (domainCitations / totalCitations * 100) : 0,
      brandMentionRate: totalCitations > 0 ? (brandMentions / totalCitations * 100) : 0
    };
  }, [lifetimeAnalytics?.allCitations, selectedBrand]);

  useEffect(() => {
    // Only redirect if not loading and user is null
    if (!authLoading && user == null) {
      router.replace('/signin');
    }
  }, [user, authLoading, router]);

  // Show loading while auth state is being determined
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Loading dashboard...</div>
      </div>
    );
  }

  // Redirect is handled by useEffect, but return loading while redirecting
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Redirecting...</div>
      </div>
    );
  }

  // Show loading while brands are being fetched
  if (brandsLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center space-x-2 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span>Loading brands...</span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Show empty state if no brands
  if (brands.length === 0) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brands Found</h3>
          <p className="text-muted-foreground mb-4">
            Add your first brand to start viewing analytics data.
          </p>
          <Link href="/dashboard/add-brand/step-1" className="bg-primary text-primary-foreground px-4 py-2 rounded-full hover:bg-primary/90 transition-colors">
            Add Brand
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  // Show message if no brand is selected
  if (!selectedBrand) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brand Selected</h3>
          <p className="text-muted-foreground">
            Please select a brand from the sidebar to view analytics.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* --- Analytics Section (Full Tabbed Interface) --- */}
        {analyticsError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <h3 className="text-base font-semibold text-foreground">Unable to load analytics</h3>
            <p className="mt-1 text-sm text-muted-foreground">{analyticsError}</p>
            <button
              type="button"
              onClick={() => void refetchLatest()}
              className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
          </div>
        ) : (hasLatestData || hasLifetimeData) ? (
          <BrandAnalyticsDisplay 
            latestAnalytics={latestAnalytics} 
            lifetimeAnalytics={lifetimeAnalytics}
            citationAnalytics={citationAnalytics}
          />
        ) : analyticsLoading ? (
          <div className="bg-card rounded-xl border border-border shadow-sm p-6">
            <div className="flex items-center space-x-2 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Loading analytics...</span>
            </div>
          </div>
        ) : (
          <div className="bg-muted/40 border border-border rounded-lg p-6 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No Analytics Data Available</h3>
            <p className="text-muted-foreground mb-4">
              No analytics data has been generated for this brand yet.
            </p>
            <p className="text-sm text-muted-foreground">
              Process some queries first to generate analytics data.
            </p>
          </div>
        )}

        {/* --- Recommendations (derived from live analytics; only renders if present) --- */}
        {recommendations.length > 0 && (
          <RecommendationSection
            title="Live Recommendations"
            recommendations={recommendations}
            defaultExpanded={true}
          />
        )}

        {/* --- Queries Overview Section --- */}
        <QueriesOverview 
          variant="compact"
          layout="cards"
          maxQueries={5}
          showProcessButton={true}
          showSearch={false}
          showEyeIcons={true}
          showCategoryFilter={true}
          onViewAll={() => {
            router.push('/dashboard/queries');
          }}
        />

        {/* --- Competitor Mentions Section --- */}
        <CompetitorMentionsCard />


        {lifetimeAnalytics && selectedBrandId && (
          <LifetimeAnalyticsCharts lifetimeAnalytics={lifetimeAnalytics} />
        )}
        
      </div>
    </DashboardLayout>
  );
}

export default Page;
