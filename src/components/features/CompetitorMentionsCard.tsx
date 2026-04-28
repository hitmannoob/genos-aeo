'use client'
import React from 'react';
import Link from 'next/link';
import { Users, BarChart3, Award, AlertTriangle, Eye, Target, Shield, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import Card from '@/components/shared/Card';
import { useCompetitors } from '@/hooks/useCompetitors';
import { useBrandContext } from '@/context/BrandContext';
import { useLifetimeBrandAnalytics } from '@/hooks/useBrandAnalytics';

interface CompetitorMentionsCardProps {
  className?: string;
}

// Custom Donut Chart Component
interface DonutChartProps {
  data: Array<{ name: string; value: number; color: string; percentage: number; isUserBrand?: boolean }>;
  size?: number;
}

function DonutChart({ data, size = 200 }: DonutChartProps) {
  const center = size / 2;
  const radius = size / 2 - 20;
  const innerRadius = radius * 0.6;
  
  let cumulativePercentage = 0;
  
  const createPath = (percentage: number, startPercentage: number) => {
    const startAngle = (startPercentage / 100) * 2 * Math.PI - Math.PI / 2;
    const endAngle = ((startPercentage + percentage) / 100) * 2 * Math.PI - Math.PI / 2;
    
    const x1 = center + radius * Math.cos(startAngle);
    const y1 = center + radius * Math.sin(startAngle);
    const x2 = center + radius * Math.cos(endAngle);
    const y2 = center + radius * Math.sin(endAngle);
    
    const x3 = center + innerRadius * Math.cos(endAngle);
    const y3 = center + innerRadius * Math.sin(endAngle);
    const x4 = center + innerRadius * Math.cos(startAngle);
    const y4 = center + innerRadius * Math.sin(startAngle);
    
    const largeArc = percentage > 50 ? 1 : 0;
    
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;
  };

  return (
    <div className="relative">
      <svg width={size} height={size} className="transform -rotate-90">
        {data.map((segment, index) => {
          const path = createPath(segment.percentage, cumulativePercentage);
          const currentCumulative = cumulativePercentage;
          cumulativePercentage += segment.percentage;
          
          return (
            <path
              key={index}
              d={path}
              fill={segment.color}
              className="transition-all duration-300 hover:opacity-80"
            />
          );
        })}
      </svg>
      
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-lg font-bold text-foreground">
          {data.reduce((sum, item) => sum + item.value, 0)}
        </div>
        <div className="text-xs text-muted-foreground">Total Mentions</div>
      </div>
    </div>
  );
}

// Legend Component
interface LegendProps {
  data: Array<{ name: string; value: number; color: string; percentage: number; isUserBrand?: boolean }>;
}

function Legend({ data }: LegendProps) {
  return (
    <div className="space-y-3">
      {data.map((item, index) => (
                 <div key={index} className="flex items-center justify-between p-3 bg-[#F8F8F8] rounded-lg border border-gray-100 hover:shadow-sm transition-shadow">
          <div className="flex items-center space-x-3">
            {/* Market position indicator */}
                         <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${
               index === 0 ? 'bg-gradient-to-r from-primary to-[#6d8ead]' : 
               index === 1 ? 'bg-gradient-to-r from-[#4D568E] to-[#657AC4]' : 
               index === 2 ? 'bg-gradient-to-r from-[#764F94] to-[#9F52A3]' :
               'bg-gradient-to-r from-[#8B95E8] to-[#A64FB8]'
             }`}>
              {index + 1}
            </div>
            
            {/* Color indicator */}
            <div 
              className="w-4 h-4 rounded-full flex-shrink-0" 
              style={{ backgroundColor: item.color }}
            ></div>
            
            {/* Brand name with "You" indicator */}
            <div className="flex items-center space-x-2 min-w-0">
              <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                {item.name}
              </span>
              {item.isUserBrand && (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full flex-shrink-0">
                  You
                </span>
              )}
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-sm font-semibold text-foreground">{item.percentage.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">{item.value} mentions</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CompetitorMentionsCard({ className = '' }: CompetitorMentionsCardProps): React.ReactElement {
  const { competitors, loading: competitorsLoading, error: competitorsError } = useCompetitors();
  const { selectedBrand } = useBrandContext();
  const lifetimeAnalyticsQuery = useLifetimeBrandAnalytics(selectedBrand?.id);
  const lifetimeAnalytics = lifetimeAnalyticsQuery.data || null;
  const analyticsLoading = lifetimeAnalyticsQuery.isLoading;
  const analyticsError = lifetimeAnalyticsQuery.error instanceof Error
    ? lifetimeAnalyticsQuery.error.message
    : null;

  // Competitor analytics are computed from the lifetime corpus, so the SOV
  // denominator must use lifetime brand mentions from that same corpus.
  const brandAnalytics = lifetimeAnalytics;
  
  // Calculate competitor metrics
  const totalCompetitorMentions = competitors.reduce((sum, comp) => sum + comp.mentions, 0);
  const totalVisibility = competitors.reduce((sum, comp) => sum + comp.visibility, 0);
  const averageVisibility = competitors.length > 0 ? Math.round(totalVisibility / competitors.length) : 0;
  const topCompetitor = competitors.length > 0 ? competitors.reduce((prev, current) => (prev.mentions > current.mentions) ? prev : current) : null;
  const totalQueries = competitors.length > 0 ? competitors[0].queriesAnalyzed : 0;

  // ✅ PROPER SOV CALCULATION using real brand analytics data
  const realBrandMentions = brandAnalytics?.totalBrandMentions || 0;
  const totalMarketMentions = realBrandMentions + totalCompetitorMentions;

  // Calculate accurate Share of Voice. Use null for the "no data" case so we
  // don't mislead the user with "100%" or "0%". When data exists, derive the
  // competitor share as the complement of the brand share to guarantee the two
  // numbers always sum to exactly 100 (avoids 99/101 rounding artifacts).
  const hasMarketData = totalMarketMentions > 0;
  const brandShareOfVoice: number | null = hasMarketData
    ? Math.round((realBrandMentions / totalMarketMentions) * 100)
    : null;
  const competitorShareOfVoice: number | null = brandShareOfVoice === null
    ? null
    : 100 - brandShareOfVoice;

  // Generate colors for competitors using brand palette
      const competitorColors = [
      '#0D9488', '#4D568E', '#764F94', '#6d8ead', 
    '#5A6BC7', '#8B95E8', '#A64FB8', '#2A3572',
    '#657AC4', '#9F52A3', '#1F2A5C', '#6E5BA7'
  ];

  // Prepare donut chart data with real analytics
  const unsortedDonutData = [
    {
      name: selectedBrand?.companyName || 'Your Brand',
      value: realBrandMentions,
      color: '#0D9488',
      // brandShareOfVoice is null when totalMarketMentions === 0, but in that
      // case realBrandMentions is also 0 so this entry is stripped by the
      // `filter(item => item.value > 0)` below before rendering.
      percentage: brandShareOfVoice ?? 0,
      isUserBrand: true
    },
    ...competitors.slice(0, 8).map((competitor, index) => ({
      name: competitor.name,
      value: competitor.mentions,
      color: competitorColors[index % competitorColors.length],
      percentage: totalMarketMentions > 0 ? (competitor.mentions / totalMarketMentions) * 100 : 0,
      isUserBrand: false
    }))
  ].filter(item => item.value > 0);

  // Sort by highest to lowest market share (mentions)
  const donutData = unsortedDonutData.sort((a, b) => b.value - a.value);

  // Calculate threat levels and market position
  const getCompetitorThreatLevel = (competitor: any) => {
    if (competitor.visibility >= 70) return { level: 'High', color: 'text-red-600', bg: 'bg-red-50', icon: AlertTriangle };
    if (competitor.visibility >= 40) return { level: 'Medium', color: 'text-orange-600', bg: 'bg-orange-50', icon: Shield };
    return { level: 'Low', color: 'text-green-600', bg: 'bg-green-50', icon: Shield };
  };

  const loading = competitorsLoading || analyticsLoading;
  const error = competitorsError || analyticsError;

  if (loading) {
    return (
      <Card className={className}>
        <div className="p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-red-100 rounded-lg">
              <Users className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Competitors' Mentions</h3>
              <p className="text-sm text-muted-foreground">Competitive landscape analysis</p>
            </div>
          </div>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-4 bg-muted rounded w-2/3"></div>
          </div>
        </div>
      </Card>
    );
  }

  if (error || competitors.length === 0) {
    return (
      <Card className={className}>
        <div className="p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-red-100 rounded-lg">
              <Users className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Competitors' Mentions</h3>
              <p className="text-sm text-muted-foreground">Competitive landscape analysis</p>
            </div>
          </div>
          <div className="text-center py-8">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="text-sm font-medium text-foreground mb-2">No Competitor Data Yet</h4>
            <p className="text-xs text-muted-foreground">
              Process queries for {selectedBrand?.companyName} to generate competitor analytics
            </p>
            {!brandAnalytics && (
              <p className="text-xs text-amber-600 mt-2">
                Brand analytics not available - ensure queries have been processed
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // Sort competitors by mentions (descending)
  const sortedCompetitors = [...competitors].sort((a, b) => b.mentions - a.mentions);
  const topThreeCompetitors = sortedCompetitors.slice(0, 3);

  // Calculate user's brand market ranking
  const userBrandRank = donutData.findIndex(item => item.isUserBrand) + 1;
  const totalMarketPlayers = donutData.length;

  // Calculate competitive positioning based on accurate SOV.
  // When we have no market data, skip labelling the position at all rather
  // than implying the user is a "Market Leader" by default.
  const marketPosition = competitorShareOfVoice === null
    ? null
    : competitorShareOfVoice <= 20 ? 'Market Leader'
    : competitorShareOfVoice <= 40 ? 'Strong Position'
    : competitorShareOfVoice <= 60 ? 'Competitive'
    : 'Challenged';

  const positionColor = competitorShareOfVoice === null
    ? 'text-muted-foreground'
    : competitorShareOfVoice <= 20 ? 'text-green-600'
    : competitorShareOfVoice <= 40 ? 'text-blue-600'
    : competitorShareOfVoice <= 60 ? 'text-orange-600'
    : 'text-red-600';

  return (
    <Card className={className}>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <Users className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Competitors' Mentions</h3>
              <p className="text-sm text-muted-foreground">
                {totalQueries} queries analyzed
                {marketPosition && (
                  <> • <span className={positionColor}>{marketPosition}</span></>
                )}
                {userBrandRank > 0 && ` • Ranked #${userBrandRank} of ${totalMarketPlayers}`}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-2xl font-bold text-red-600">{totalCompetitorMentions}</div>
              <div className="text-xs text-muted-foreground">Competitor Mentions</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-primary">{realBrandMentions}</div>
              <div className="text-xs text-muted-foreground">Your Brand Mentions</div>
            </div>
          </div>
        </div>



        {/* Share of Voice Donut Chart Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-foreground flex items-center">
              <BarChart3 className="h-4 w-4 mr-2" />
              Share of Voice Analysis
            </h4>
            <span className="text-sm text-muted-foreground">
              Total Market: {totalMarketMentions} mentions
            </span>
          </div>
          
          {/* Donut Chart and Legend */}
          <div className="flex flex-col lg:flex-row items-center lg:items-start space-y-4 lg:space-y-0 lg:space-x-8">
            {/* Donut Chart */}
            <div className="flex-shrink-0">
              {donutData.length > 0 ? (
                <DonutChart data={donutData} size={200} />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center bg-[#F8F8F8] rounded-full">
                  <span className="text-sm text-muted-foreground">No data</span>
                </div>
              )}
            </div>
            
            {/* Legend */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-medium text-foreground">Market Share Ranking</h5>
                <span className="text-xs text-muted-foreground">Highest to Lowest</span>
              </div>
                            <Legend data={donutData} />
            </div>
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 bg-red-50 rounded-lg border border-red-100">
            <div className="text-lg font-bold text-red-600">{competitors.length}</div>
            <div className="text-xs text-muted-foreground">Active Competitors</div>
          </div>
          <div className="text-center p-3 bg-orange-50 rounded-lg border border-orange-100">
            <div className="text-lg font-bold text-orange-600">{averageVisibility}%</div>
            <div className="text-xs text-muted-foreground">Avg Visibility</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <div className="text-lg font-bold text-purple-600">{topCompetitor?.mentions || 0}</div>
            <div className="text-xs text-muted-foreground">Highest Mentions</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="text-lg font-bold text-blue-600">
              {competitorShareOfVoice === null ? '—' : `${competitorShareOfVoice}%`}
            </div>
            <div className="text-xs text-muted-foreground">
              {competitorShareOfVoice === null ? 'Competitor SOV (no data yet)' : 'Competitor SOV'}
            </div>
          </div>
        </div>

        {/* Top Competitors Ranking with Threat Assessment */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-foreground flex items-center">
              <Award className="h-4 w-4 mr-2" />
              Competitive Threat Analysis
            </h4>
            {topCompetitor && (
              <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-full">
                Top Threat: {topCompetitor.name}
              </span>
            )}
          </div>
          
          <div className="space-y-3">
            {topThreeCompetitors.map((competitor, index) => {
              const threatLevel = getCompetitorThreatLevel(competitor);
              const ThreatIcon = threatLevel.icon;
              const competitorColor = donutData.find(d => d.name === competitor.name)?.color || '#6B7280';
              const change = competitor.mentionsChange;
              const hasTrend = typeof change === 'number';
              const trendIcon = !hasTrend ? null : change > 0 ? ArrowUp : change < 0 ? ArrowDown : Minus;
              // Competitor mentions up = bad for user; down = good
              const trendColor = !hasTrend
                ? 'text-gray-400'
                : change > 0
                  ? 'text-red-500'
                  : change < 0
                    ? 'text-green-500'
                    : 'text-gray-500';
              const trendLabel = !hasTrend
                ? 'New'
                : change > 0
                  ? `+${change}`
                  : change < 0
                    ? `${change}`
                    : '±0';
              
              return (
                <div key={competitor.id} className="flex items-center justify-between p-4 bg-[#F8F8F8] rounded-lg border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex items-center space-x-3">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold text-white ${
                      index === 0 ? 'bg-gradient-to-r from-primary to-[#6d8ead]' : 
                      index === 1 ? 'bg-gradient-to-r from-[#4D568E] to-[#657AC4]' : 
                      'bg-gradient-to-r from-[#764F94] to-[#9F52A3]'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: competitorColor }}
                      ></div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-foreground">{competitor.name}</span>
                          <div className={`flex items-center space-x-1 px-2 py-1 rounded-full text-xs ${threatLevel.bg}`}>
                            <ThreatIcon className={`h-3 w-3 ${threatLevel.color}`} />
                            <span className={threatLevel.color}>{threatLevel.level}</span>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {competitor.visibility}% visibility • Via {competitor.topProvider}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <div className="font-semibold text-foreground">{competitor.mentions}</div>
                      <div className="text-xs text-muted-foreground">mentions</div>
                    </div>
                    {trendIcon && (
                      <div className="flex items-center space-x-1">
                        {React.createElement(trendIcon, { className: `h-4 w-4 ${trendColor}` })}
                        <span className={`text-xs ${trendColor}`}>{trendLabel}</span>
                      </div>
                    )}
                    {!hasTrend && (
                      <span className="text-xs text-gray-400">New</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Show more competitors indicator */}
          {competitors.length > 3 && (
            <div className="text-center mt-4">
              <Link
                href="/dashboard/competitors"
                className="inline-block text-xs text-muted-foreground bg-[#F8F8F8] px-3 py-1 rounded-full hover:bg-gray-200 hover:text-foreground transition-colors"
              >
                + {competitors.length - 3} more competitors tracked
              </Link>
            </div>
          )}
        </div>

        {/* Competitive Intelligence Footer */}
        <div className="mt-6 pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 text-xs text-muted-foreground">
              <div className="flex items-center space-x-2">
                <Eye className="h-3 w-3" />
                <span>Real-time Analysis</span>
              </div>
              <div className="flex items-center space-x-2">
                <Target className="h-3 w-3" />
                <span>Industry Standard SOV</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Data source: {brandAnalytics ? 'Brand Analytics' : 'Estimated'}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
