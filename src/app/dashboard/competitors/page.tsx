'use client'
import React from 'react';
import Link from 'next/link';
import { useBrandContext } from '@/context/BrandContext';
import { useCompetitors } from '@/hooks/useCompetitors';
import { useBrandAnalyticsCombined } from '@/hooks/useBrandAnalytics';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Card from '@/components/shared/Card';
import WebLogo from '@/components/shared/WebLogo';
import {
  Users,
  TrendingUp,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Eye,
  MessageSquare
} from 'lucide-react';

export default function CompetitorsPage(): React.ReactElement {
  const { selectedBrand, brands, loading: brandLoading } = useBrandContext();
  const {
    competitors,
    totalQueriesProcessed,
    loading: competitorsLoading,
    error,
    refetch: refetchCompetitors
  } = useCompetitors();

  // Brand analytics for SOV denominator
  const {
    latestAnalytics,
    lifetimeAnalytics,
    loading: brandAnalyticsLoading,
    refetchLatest,
    refetchLifetime
  } = useBrandAnalyticsCombined(selectedBrand?.id);

  const brandAnalytics = latestAnalytics || lifetimeAnalytics;

  // SOV metrics — only meaningful once brand analytics has loaded, otherwise
  // realBrandMentions=0 flashes "100% you / 0% competitors" for a beat.
  const sovReady = !brandAnalyticsLoading && !!brandAnalytics;
  const totalCompetitorMentions = competitors.reduce((sum, comp) => sum + comp.mentions, 0);
  const realBrandMentions = brandAnalytics?.totalBrandMentions || 0;
  const totalMarketMentions = realBrandMentions + totalCompetitorMentions;

  // Use null for the "no data" case so we don't mislead the user with "0%"
  // percentages. When data exists, derive the competitor share as the complement
  // of the brand share so the two numbers always sum to exactly 100 (avoids
  // 99/101 rounding artifacts from two independent Math.round calls).
  const hasMarketData = totalMarketMentions > 0;
  const brandShareOfVoice: number | null = hasMarketData
    ? Math.round((realBrandMentions / totalMarketMentions) * 100)
    : null;
  const competitorShareOfVoice: number | null = brandShareOfVoice === null
    ? null
    : 100 - brandShareOfVoice;

  const sortedMarketData = [
    { name: selectedBrand?.companyName || 'Your Brand', value: realBrandMentions, isUserBrand: true },
    ...competitors.map(comp => ({ name: comp.name, value: comp.mentions, isUserBrand: false }))
  ].filter(item => item.value > 0).sort((a, b) => b.value - a.value);

  const userBrandRank = sortedMarketData.findIndex(item => item.isUserBrand) + 1;

  // Refresh pulls both pipelines so competitor numbers + brand mentions stay in sync.
  const handleRefresh = async () => {
    await Promise.all([refetchCompetitors(), refetchLatest(), refetchLifetime()]);
  };

  const isRefreshing = competitorsLoading || brandAnalyticsLoading;

  // Show loading while brands are being fetched
  if (brandLoading) {
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
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brands Found</h3>
          <p className="text-muted-foreground mb-4">
            Add your first brand to start analyzing competitors.
          </p>
          <Link href="/dashboard/add-brand/step-1" className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors">
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
            Please select a brand from the sidebar to view competitor analysis.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <WebLogo domain={selectedBrand.domain} size={40} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Competitor Analysis</h1>
              <p className="text-muted-foreground">for {selectedBrand.companyName}</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-2 bg-primary/10 text-primary px-4 py-2 rounded-full hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Surface Cloud Storage truncation so users don't act on silently-incomplete numbers. */}
        {lifetimeAnalytics?.dataTruncated && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold">Competitor analytics are running on a partial dataset.</div>
              <div className="mt-1">
                We couldn't load the full query history from Cloud Storage, so the
                numbers below are computed from the most recent ~50 queries only.
                Reload the page to retry, or contact support if this persists.
              </div>
            </div>
          </div>
        )}

        {/* Data Source Info Banner */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-primary rounded-full"></div>
            <div>
              <h3 className="font-semibold text-foreground">Lifetime Competitor Analytics</h3>
              <p className="text-sm text-muted-foreground">
                Numbers are computed live from every processed query for this brand,
                using the same matcher applied to your brand mentions.
              </p>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
              <p className="text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {competitorsLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-6 animate-pulse">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-muted rounded-full"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
                  <div className="w-20 h-8 bg-muted rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : competitors.length > 0 ? (
          <>
            {/* Real Competitor Analytics Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <div className="text-center">
                  <Users className="h-8 w-8 text-[#000C60] mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">{competitors.length}</p>
                  <p className="text-muted-foreground text-sm">Competitors Tracking</p>
                </div>
              </Card>
              
              <Card>
                <div className="text-center">
                  <MessageSquare className="h-8 w-8 text-[#00B087] mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">
                    {competitors.reduce((sum, comp) => sum + comp.mentions, 0)}
                  </p>
                  <p className="text-muted-foreground text-sm">Total Competitor Mentions</p>
                </div>
              </Card>
              
              <Card>
                <div className="text-center">
                  <Eye className="h-8 w-8 text-[#764F94] mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">
                    {competitors.length > 0 ? Math.round(competitors.reduce((sum, comp) => sum + comp.visibility, 0) / competitors.length) : 0}%
                  </p>
                  <p className="text-muted-foreground text-sm">Avg Visibility</p>
                </div>
              </Card>

              <Card>
                <div className="text-center">
                  <TrendingUp className="h-8 w-8 text-[#E74C3C] mx-auto mb-2" />
                  <p className="text-2xl font-bold text-foreground">
                    {totalQueriesProcessed}
                  </p>
                  <p className="text-muted-foreground text-sm">Queries Analyzed</p>
                </div>
              </Card>
            </div>

            {/* Real Competitors List */}
            <Card>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-foreground">Competitor Analytics</h3>
                <div className="text-sm text-muted-foreground">
                  Based on real AI query responses
                </div>
              </div>
              
              <div className="space-y-4">
                {competitors.map((competitor, index) => (
                  <div key={competitor.id} className="border border-border rounded-lg p-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-muted-foreground">#{index + 1}</span>
                          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                            {competitor.name.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold text-foreground">{competitor.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {competitor.mentions} mention{competitor.mentions !== 1 ? 's' : ''} detected
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-6">
                        {/* Mentions */}
                        <div className="text-center">
                          <p className="text-sm font-medium text-foreground">{competitor.mentions}</p>
                          <p className="text-xs text-muted-foreground">Mentions</p>
                        </div>

                        {/* Visibility */}
                        <div className="text-center">
                          <p className="text-sm font-medium text-foreground">{competitor.visibility}%</p>
                          <p className="text-xs text-muted-foreground">Visibility</p>
                        </div>

                        {/* Top Provider */}
                        <div className="text-center">
                          <p className="text-sm font-medium text-foreground capitalize">
                            {competitor.topProvider && competitor.topProvider !== 'none' ? competitor.topProvider : '—'}
                          </p>
                          <p className="text-xs text-muted-foreground">Top Provider</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Share of Voice Summary — gated on brand analytics ready so we
                don't flash "100% you / 0% competitors" while lifetime data loads. */}
            <Card>
              <h3 className="text-lg font-semibold text-foreground mb-4">Share of Voice Summary</h3>
              {!sovReady ? (
                <div className="p-4 bg-gray-50 rounded-lg flex items-center justify-center text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Loading brand mentions…
                </div>
              ) : (
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {brandShareOfVoice === null ? '—' : `${brandShareOfVoice}%`}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {brandShareOfVoice === null
                          ? 'Your Brand (no data yet)'
                          : `Your Brand (#${userBrandRank > 0 ? userBrandRank : 'N/A'})`}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{realBrandMentions} mentions</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">
                        {competitorShareOfVoice === null ? '—' : `${competitorShareOfVoice}%`}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {competitorShareOfVoice === null ? 'All Competitors (no data yet)' : 'All Competitors'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{totalCompetitorMentions} mentions</div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="text-center">
                      <div className="text-sm text-muted-foreground">
                        Total Market: <strong>{totalMarketMentions}</strong> mentions
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Real Analytics Summary */}
            <Card>
              <h3 className="text-lg font-semibold text-foreground mb-4">Analytics Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-foreground mb-3">Most Mentioned Competitors</h4>
                  <div className="space-y-2">
                    {[...competitors]
                      .sort((a, b) => b.mentions - a.mentions)
                      .slice(0, 3)
                      .map((competitor, index) => (
                        <div key={competitor.id} className="flex items-center justify-between p-2 bg-muted/20 rounded">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-muted-foreground">#{index + 1}</span>
                            <span className="text-sm font-medium text-foreground">{competitor.name}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{competitor.mentions} mentions</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-foreground mb-3">Highest Visibility</h4>
                  <div className="space-y-2">
                    {[...competitors]
                      .sort((a, b) => b.visibility - a.visibility)
                      .slice(0, 3)
                      .map((competitor, index) => (
                        <div key={competitor.id} className="flex items-center justify-between p-2 bg-muted/20 rounded">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-muted-foreground">#{index + 1}</span>
                            <span className="text-sm font-medium text-foreground">{competitor.name}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{competitor.visibility}% visibility</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </Card>
          </>
        ) : (
          <Card>
            <div className="text-center py-12">
              <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No Competitor Analytics Yet</h3>
              <p className="text-muted-foreground mb-4">
                Process queries for {selectedBrand.companyName} to generate real competitor analytics.
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                Competitor analytics are generated from actual AI query responses, showing which competitors appear in AI recommendations.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link 
                  href="/dashboard/queries" 
                  className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors"
                >
                  Process Queries
                </Link>
                <Link 
                  href="/dashboard/add-brand/step-2" 
                  className="bg-muted text-foreground px-4 py-2 rounded-lg hover:bg-accent transition-colors"
                >
                  Add Competitors
                </Link>
              </div>
            </div>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
} 