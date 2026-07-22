'use client'
import React from 'react';
import Link from 'next/link';
import { Users, BarChart3, Award, AlertTriangle, Eye, Target, Shield, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import Card from '@/components/shared/Card';
import InfoTooltip from '@/components/shared/InfoTooltip';
import { useCompetitors, type CompetitorData } from '@/hooks/useCompetitors';
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
  const strokeWidth = radius * 0.4;
  const chartRadius = radius - strokeWidth / 2;
  const circumference = 2 * Math.PI * chartRadius;
  let cumulativePercentage = 0;

  return (
    <div className="relative" role="img" aria-label="Share of response mentions by brand">
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        {data.map((segment, index) => {
          const dashLength = Math.max(0, Math.min(100, segment.percentage)) / 100 * circumference;
          const dashOffset = -(cumulativePercentage / 100) * circumference;
          cumulativePercentage += segment.percentage;

          return (
            <circle
              key={`${segment.name}-${index}`}
              cx={center}
              cy={center}
              r={chartRadius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
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
        <div className="text-xs text-muted-foreground">Response mentions</div>
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
        <div key={`${item.name}-${index}`} className="flex items-center justify-between p-3 bg-muted/40 rounded-lg border border-border hover:shadow-sm transition-shadow">
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
            <div className="text-xs text-muted-foreground">{item.value} response mentions</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CompetitorMentionsCard({ className = '' }: CompetitorMentionsCardProps): React.ReactElement {
  const {
    competitors,
    totalQueriesProcessed,
    loading: competitorsLoading,
    error: competitorsError,
    refetch: refetchCompetitors,
  } = useCompetitors();
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
  const mentionedCompetitors = competitors.filter((competitor) => competitor.mentions > 0);
  const totalVisibility = mentionedCompetitors.reduce((sum, comp) => sum + comp.visibility, 0);
  const averageVisibility = mentionedCompetitors.length > 0
    ? Math.round(totalVisibility / mentionedCompetitors.length)
    : 0;
  const topCompetitor = mentionedCompetitors.length > 0
    ? mentionedCompetitors.reduce((prev, current) => (prev.mentions > current.mentions) ? prev : current)
    : null;
  const totalQueries = totalQueriesProcessed;

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

  // Competitor palette — deliberately excludes the brand teal (#0D9488)
  // so a competitor never blends into "Your Brand" on the donut.
  const competitorColors = [
    '#4D568E', '#764F94', '#6d8ead', '#5A6BC7',
    '#8B95E8', '#A64FB8', '#2A3572', '#657AC4',
    '#9F52A3', '#1F2A5C', '#6E5BA7', '#E07856',
  ];

  const sortedCompetitors = [...mentionedCompetitors].sort((a, b) => b.mentions - a.mentions);
  const featuredCompetitors = sortedCompetitors.slice(0, 7);
  const otherCompetitorMentions = sortedCompetitors
    .slice(7)
    .reduce((sum, competitor) => sum + competitor.mentions, 0);

  // Keep the whole denominator represented. Long competitor lists are grouped
  // into one "Other competitors" segment after the seven largest players.
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
    ...featuredCompetitors.map((competitor, index) => ({
      name: competitor.name,
      value: competitor.mentions,
      color: competitorColors[index % competitorColors.length],
      percentage: totalMarketMentions > 0 ? (competitor.mentions / totalMarketMentions) * 100 : 0,
      isUserBrand: false
    })),
    ...(otherCompetitorMentions > 0 ? [{
      name: 'Other competitors',
      value: otherCompetitorMentions,
      color: competitorColors[7],
      percentage: totalMarketMentions > 0
        ? (otherCompetitorMentions / totalMarketMentions) * 100
        : 0,
      isUserBrand: false,
    }] : []),
  ].filter(item => item.value > 0);

  // Sort by highest to lowest market share (mentions)
  const donutData = unsortedDonutData.sort((a, b) => b.value - a.value);

  // Calculate threat levels and market position
  const getCompetitorThreatLevel = (competitor: CompetitorData) => {
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
              <h3 className="text-lg font-semibold text-foreground">Competitor Response Mentions</h3>
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

  if (error) {
    return (
      <Card className={className}>
        <div className="p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h3 className="text-base font-semibold text-foreground">Unable to load competitor analytics</h3>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => void Promise.all([refetchCompetitors(), lifetimeAnalyticsQuery.refetch()])}
            className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </Card>
    );
  }

  if (competitors.length === 0 || totalQueries === 0) {
    return (
      <Card className={className}>
        <div className="p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-2 bg-red-100 rounded-lg">
              <Users className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Competitor Response Mentions</h3>
              <p className="text-sm text-muted-foreground">Competitive landscape analysis</p>
            </div>
          </div>
          <div className="text-center py-8">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="text-sm font-medium text-foreground mb-2">No Competitor Data Yet</h4>
            <p className="text-xs text-muted-foreground">
              {competitors.length === 0
                ? `Add competitors to ${selectedBrand?.companyName || 'this brand'} before comparing response visibility.`
                : `Process queries for ${selectedBrand?.companyName || 'this brand'} to generate competitor analytics.`}
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

  const topThreeCompetitors = sortedCompetitors.slice(0, 3);

  // Rank the brand against individual competitors, not the grouped donut
  // segment. Include the tracked brand even when it currently has zero hits.
  const userBrandRank = 1 + sortedCompetitors.filter(
    (competitor) => competitor.mentions > realBrandMentions
  ).length;
  const totalMarketPlayers = sortedCompetitors.filter(
    (competitor) => competitor.mentions > 0
  ).length + 1;

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
              <h3 className="text-lg font-semibold text-foreground">Competitor Response Mentions</h3>
              <p className="text-sm text-muted-foreground">
                {totalQueries} query {totalQueries === 1 ? 'run' : 'runs'} analyzed
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
              <div className="text-xs text-muted-foreground inline-flex items-center justify-end">
                Competitor Response Mentions
                <InfoTooltip side="top">
                  Provider responses that mention a tracked competitor. Each competitor is counted at most once per provider response.
                </InfoTooltip>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-primary">{realBrandMentions}</div>
              <div className="text-xs text-muted-foreground inline-flex items-center justify-end">
                Your Brand Response Mentions
                <InfoTooltip side="top">
                  Provider responses that mention your brand, drawn from the same lifetime corpus and matching rules used for competitors.
                </InfoTooltip>
              </div>
            </div>
          </div>
        </div>



        {/* Share of Voice Donut Chart Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-foreground flex items-center">
              <BarChart3 className="h-4 w-4 mr-2" />
              Response Share of Voice
              <InfoTooltip>
                Each player's share of entity-response matches. An entity is counted at most once in each provider response, and the donut sums to 100%.
              </InfoTooltip>
            </h4>
            <span className="text-sm text-muted-foreground inline-flex items-center">
              Total: {totalMarketMentions} response mentions
              <InfoTooltip side="top">
                Sum of brand and competitor response-presence matches across the lifetime corpus. This is the denominator for every share on this card.
              </InfoTooltip>
            </span>
          </div>
          
          {/* Donut Chart and Legend */}
          <div className="flex flex-col lg:flex-row items-center lg:items-start space-y-4 lg:space-y-0 lg:space-x-8">
            {/* Donut Chart */}
            <div className="flex-shrink-0">
              {donutData.length > 0 ? (
                <DonutChart data={donutData} size={200} />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center bg-muted/40 rounded-full">
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
            <div className="text-lg font-bold text-red-600">{mentionedCompetitors.length}</div>
            <div className="text-xs text-muted-foreground inline-flex items-center justify-center">
              Active Competitors
              <InfoTooltip>
                Number of competitors you've added that received at least one mention in the AI responses for this brand's queries.
              </InfoTooltip>
            </div>
          </div>
          <div className="text-center p-3 bg-orange-50 rounded-lg border border-orange-100">
            <div className="text-lg font-bold text-orange-600">{averageVisibility}%</div>
            <div className="text-xs text-muted-foreground inline-flex items-center justify-center">
              Avg Visibility
              <InfoTooltip>
                Average of each competitor's visibility score (the share of analyzed queries where that competitor was mentioned at least once), averaged across all active competitors.
              </InfoTooltip>
            </div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg border border-purple-100">
            <div className="text-lg font-bold text-purple-600">{topCompetitor?.mentions || 0}</div>
            <div className="text-xs text-muted-foreground inline-flex items-center justify-center">
              Highest Response Mentions
              <InfoTooltip>
                Number of provider responses that mention the most-visible competitor.
              </InfoTooltip>
            </div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="text-lg font-bold text-blue-600">
              {competitorShareOfVoice === null ? '—' : `${competitorShareOfVoice}%`}
            </div>
            <div className="text-xs text-muted-foreground inline-flex items-center justify-center">
              {competitorShareOfVoice === null ? 'Competitor share (no data yet)' : 'Competitor response share'}
              <InfoTooltip>
                The combined response share held by every competitor (= 100% minus your brand's share). Higher means competitors appear in more provider responses than your brand.
              </InfoTooltip>
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
                ? 'text-muted-foreground'
                : change > 0
                  ? 'text-red-500'
                  : change < 0
                    ? 'text-green-500'
                    : 'text-muted-foreground';
              const trendLabel = !hasTrend
                ? 'New'
                : change > 0
                  ? `+${change}`
                  : change < 0
                    ? `${change}`
                    : '±0';
              
              return (
                <div key={competitor.id} className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border border-border hover:shadow-md transition-shadow">
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
                      <div className="text-xs text-muted-foreground">response mentions</div>
                    </div>
                    {trendIcon && (
                      <div className="flex items-center space-x-1">
                        {React.createElement(trendIcon, { className: `h-4 w-4 ${trendColor}` })}
                        <span className={`text-xs ${trendColor}`}>{trendLabel}</span>
                      </div>
                    )}
                    {!hasTrend && (
                      <span className="text-xs text-muted-foreground">New</span>
                    )}
                  </div>
                </div>
              );
            })}
            {topThreeCompetitors.length === 0 && (
              <div className="rounded-lg border border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                No tracked competitor appeared in the processed responses yet.
              </div>
            )}
          </div>

          {/* Show more competitors indicator */}
          {mentionedCompetitors.length > 3 && (
            <div className="text-center mt-4">
              <Link
                href="/dashboard/competitors"
                className="inline-block text-xs text-muted-foreground bg-muted/40 px-3 py-1 rounded-full hover:bg-border hover:text-foreground transition-colors"
              >
                + {mentionedCompetitors.length - 3} more mentioned competitors
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
