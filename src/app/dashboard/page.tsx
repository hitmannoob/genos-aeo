'use client'
import React, { useEffect, useMemo } from "react";
import { useAuthContext } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { BarChart3, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import DashboardLayout from '@/components/layout/DashboardLayout';
import BrandTrackingModal from '@/components/shared/BrandTrackingModal';
import QueriesOverview from '@/components/features/QueriesOverview';
import RecommendationSection from '@/components/features/RecommendationSection';
import { useBrandContext } from '@/context/BrandContext';
import { useUserBrands } from '@/hooks/useUserBrands';
import BrandAnalyticsDisplay from '@/components/features/BrandAnalyticsDisplay';
import { useBrandAnalyticsCombined } from '@/hooks/useBrandAnalytics';
import LifetimeAnalyticsCharts from '@/components/features/LifetimeAnalyticsCharts';
import CompetitorMentionsCard from '@/components/features/CompetitorMentionsCard';
import { useRecommendations } from '@/hooks/useRecommendations';


function Page(): React.ReactElement {
  const { user, loading: authLoading } = useAuthContext();
  const router = useRouter();
  const { selectedBrand, selectedBrandId, brands, loading: brandsLoading, setSelectedBrandId, clearBrandContext } = useBrandContext();
  const { refetch: refetchBrands } = useUserBrands();
  const {
    latestAnalytics,
    lifetimeAnalytics,
    loading: analyticsLoading,
    hasLatestData,
    hasLifetimeData
  } = useBrandAnalyticsCombined(selectedBrand?.id);

  const { recommendations } = useRecommendations({ brandId: selectedBrand?.id });

  // Modal state
  const [showTrackingModal, setShowTrackingModal] = React.useState(false);
  const [newBrandName, setNewBrandName] = React.useState('');
  const [newBrandId, setNewBrandId] = React.useState('');

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
      router.push("/");
    }
  }, [user, authLoading, router]);

  // Check for brand tracking modal when dashboard loads
  useEffect(() => {
    if (user && !authLoading) {
      // Check if we should show the brand tracking modal
      const showModal = sessionStorage.getItem('showBrandTrackingModal');
      const brandName = sessionStorage.getItem('newBrandName');
      
      if (showModal === 'true') {
        console.log('🎯 Showing brand tracking modal for:', brandName);
        setNewBrandName(brandName || '');
        const brandId = sessionStorage.getItem('newBrandId');
        setNewBrandId(brandId || '');
        setShowTrackingModal(true);
        
        // Clear the modal flag (but keep other data for when user clicks "Start Tracking")
        sessionStorage.removeItem('showBrandTrackingModal');
      }
    }
  }, [user, authLoading]);

  // Handle "Great, Start Tracking!" button click
  const handleStartTracking = async () => {
    console.log('🚀 Starting brand tracking...');
    
    // Close modal first
    setShowTrackingModal(false);
    
    // Clear current brand context to ensure fresh state
    clearBrandContext();
    
    // Clear current selection and refresh brands
    setSelectedBrandId('');
    
    // Refresh brands list and auto-select new brand
    console.log('🔄 Refreshing brands list...');
    await refetchBrands();
    
    if (newBrandId) {
      console.log('✅ Auto-selecting newly created brand:', newBrandId);
      setTimeout(() => {
        setSelectedBrandId(newBrandId);
      }, 100); // Small delay to ensure brands are loaded
    }
    
    // Clean up remaining session storage
    sessionStorage.removeItem('newBrandId');
    sessionStorage.removeItem('newBrandName');
    sessionStorage.removeItem('firestoreDocId');
    sessionStorage.removeItem('brandsbasicData');
    sessionStorage.removeItem('generatedQueries');
    
    console.log('✅ Brand tracking started successfully!');
    
    // Redirect to queries page
    console.log('🎯 Redirecting to queries page...');
    router.push('/dashboard/queries');
  };

  // Handle modal close
  const handleCloseModal = () => {
    setShowTrackingModal(false);
    
    // Clean up session storage
    sessionStorage.removeItem('newBrandId');
    sessionStorage.removeItem('newBrandName');
    sessionStorage.removeItem('firestoreDocId');
    sessionStorage.removeItem('brandsbasicData');
    sessionStorage.removeItem('generatedQueries');
  };

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
        {/* Cloud Storage retrieval failed and analytics fell back to the
            Firestore-truncated copy. Surface it so users don't act on wrong numbers. */}
        {lifetimeAnalytics?.dataTruncated && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold">Analytics are running on a partial dataset.</div>
              <div className="mt-1">
                We couldn't load the full query history from Cloud Storage, so the
                numbers below are computed from the most recent ~50 queries only.
                Reload the page to retry, or contact support if this persists.
              </div>
            </div>
          </div>
        )}

        {/* --- Analytics Section (Full Tabbed Interface) --- */}
        {(hasLatestData || hasLifetimeData) ? (
          <BrandAnalyticsDisplay 
            latestAnalytics={latestAnalytics} 
            lifetimeAnalytics={lifetimeAnalytics}
            citationAnalytics={citationAnalytics}
          />
        ) : analyticsLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center space-x-2 text-gray-600">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Loading analytics...</span>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Analytics Data Available</h3>
            <p className="text-gray-600 mb-4">
              No analytics data has been generated for this brand yet.
            </p>
            <p className="text-sm text-gray-500">
              Process some queries first to generate analytics data.
            </p>
          </div>
        )}

        {/* --- Recommendations (real data from user_recommendations; only renders if present) --- */}
        {recommendations.length > 0 && (
          <RecommendationSection
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
            window.location.href = '/dashboard/queries';
          }}
        />

        {/* --- Competitor Mentions Section --- */}
        <CompetitorMentionsCard />


        {lifetimeAnalytics && selectedBrandId && (
          <LifetimeAnalyticsCharts lifetimeAnalytics={lifetimeAnalytics} brandId={selectedBrandId} />
        )}
        
      </div>
      {/* Brand Tracking Modal remains as is */}
      <BrandTrackingModal
        isOpen={showTrackingModal}
        onStartTracking={handleStartTracking}
        onClose={handleCloseModal}
        brandName={newBrandName}
      />
    </DashboardLayout>
  );
}

export default Page; 