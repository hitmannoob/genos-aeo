import type { UserBrand } from '@/types/userBrand';
import type {
  BrandAnalyticsData,
  LifetimeBrandAnalytics,
} from '@/lib/analytics/brandAnalytics';
import type { RecommendationData } from '@/lib/recommendation-types';

interface BuildLiveRecommendationsOptions {
  brand?: Pick<UserBrand, 'companyName' | 'domain' | 'queries'> | null;
  latestAnalytics?: BrandAnalyticsData | null;
  lifetimeAnalytics?: LifetimeBrandAnalytics | null;
}

interface RecommendationCandidate extends RecommendationData {
  score: number;
}

function formatProviderName(provider: string): string {
  switch (provider) {
    case 'chatgpt':
      return 'ChatGPT';
    case 'google':
      return 'Google AI';
    case 'perplexity':
      return 'Perplexity';
    default:
      return provider;
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addCandidate(
  candidates: RecommendationCandidate[],
  candidate: RecommendationCandidate
) {
  if (!candidates.some((existing) => existing.id === candidate.id)) {
    candidates.push(candidate);
  }
}

export function buildLiveRecommendations({
  brand,
  latestAnalytics,
  lifetimeAnalytics,
}: BuildLiveRecommendationsOptions): RecommendationData[] {
  if (!brand || !lifetimeAnalytics) {
    return [];
  }

  const candidates: RecommendationCandidate[] = [];
  const brandName = brand.companyName;
  const brandDomain = brand.domain;
  const trackedQueryCount = brand.queries?.length || 0;
  const processedQueryCount = trackedQueryCount > 0
    ? Math.min(lifetimeAnalytics.totalQueriesProcessed, trackedQueryCount)
    : lifetimeAnalytics.totalQueriesProcessed;
  const remainingQueries = Math.max(trackedQueryCount - processedQueryCount, 0);
  const visibilityScore = lifetimeAnalytics.brandVisibilityScore;
  const totalCitations = lifetimeAnalytics.totalCitations;
  const totalDomainCitations = lifetimeAnalytics.totalDomainCitations;
  const domainCitationRate = totalCitations > 0
    ? totalDomainCitations / totalCitations
    : 0;

  const providerRates = Object.entries(lifetimeAnalytics.providerStats)
    .filter(([, stats]) => stats.queriesProcessed > 0)
    .map(([provider, stats]) => ({
      provider,
      mentionRate: stats.brandMentions / stats.queriesProcessed,
      citationRate: stats.citations > 0 ? stats.domainCitations / stats.citations : 0,
      stats,
    }))
    .sort((left, right) => left.mentionRate - right.mentionRate);

  const weakestProvider = providerRates[0];
  const strongestProvider = providerRates[providerRates.length - 1];

  if (trackedQueryCount > 0 && remainingQueries > 0) {
    addCandidate(candidates, {
      id: 'coverage-gap',
      title: `Finish coverage for ${remainingQueries} remaining tracked quer${remainingQueries === 1 ? 'y' : 'ies'}`,
      description: `${processedQueryCount} of ${trackedQueryCount} tracked queries have live results. The rest are still missing from the analytics corpus.`,
      priority: remainingQueries >= Math.max(2, Math.ceil(trackedQueryCount * 0.25)) ? 'high' : 'medium',
      category: 'Coverage',
      imageUrl: '',
      readTime: '2 min read',
      rating: 0,
      details: [
        `Run the remaining tracked queries for ${brandName} so the dashboard is based on the full query set you are monitoring, not a partial slice.`,
        'Until those queries are processed, provider performance, share-of-voice, and trend summaries are all missing part of your own tracking plan.',
        'Start with the highest-intent queries first so the next analytics refresh improves decision quality fastest.',
      ],
      evidence: [
        `Processed coverage: ${processedQueryCount}/${trackedQueryCount} tracked queries`,
      ],
      score: 110 + remainingQueries,
    });
  }

  if (
    (totalCitations > 0 && domainCitationRate < 0.2) ||
    (lifetimeAnalytics.totalBrandMentions > 0 && totalDomainCitations === 0)
  ) {
    addCandidate(candidates, {
      id: 'citation-gap',
      title: 'Increase first-party citations in AI answers',
      description: `Only ${totalDomainCitations} of ${totalCitations} citations point to ${brandDomain}. Brand mentions are outpacing citations to your own site.`,
      priority: domainCitationRate < 0.1 ? 'high' : 'medium',
      category: 'Authority',
      imageUrl: '',
      readTime: '4 min read',
      rating: 0,
      details: [
        `Publish more directly citable pages on ${brandDomain}: comparison pages, implementation docs, pricing explainers, benchmarks, and FAQs.`,
        'Make those pages factual and specific so providers can cite them as evidence instead of summarizing generic marketing copy.',
        'Review the topics where the brand is already mentioned and tighten the source pages behind those topics so mentions convert into citations.',
      ],
      evidence: [
        `Domain citation rate: ${(domainCitationRate * 100).toFixed(1)}%`,
        `Total domain citations: ${totalDomainCitations}`,
        `Total citations: ${totalCitations}`,
      ],
      score: domainCitationRate === 0 ? 105 : 92 - Math.round(domainCitationRate * 100),
    });
  }

  if (visibilityScore < 60 && weakestProvider) {
    addCandidate(candidates, {
      id: `visibility-gap-${weakestProvider.provider}`,
      title: `Raise visibility on ${formatProviderName(weakestProvider.provider)}`,
      description: `Your brand is visible in ${visibilityScore.toFixed(1)}% of provider responses overall, and ${formatProviderName(weakestProvider.provider)} is the weakest channel.`,
      priority: visibilityScore < 35 ? 'high' : 'medium',
      category: 'Visibility',
      imageUrl: '',
      readTime: '3 min read',
      rating: 0,
      details: [
        `Audit the tracked queries where ${formatProviderName(weakestProvider.provider)} is underperforming and tighten the pages those answers should cite.`,
        'Make the brand-to-topic association explicit in titles, H1s, and support copy for the intent clusters already in your query list.',
        'Prefer pages that answer one clear problem well over broader pages that try to cover every adjacent intent at once.',
      ],
      evidence: [
        `Overall visibility score: ${visibilityScore.toFixed(1)}%`,
        `${formatProviderName(weakestProvider.provider)} mention rate: ${(weakestProvider.mentionRate * 100).toFixed(1)}%`,
      ],
      score: 100 - Math.round(visibilityScore),
    });
  }

  const trendPoints = lifetimeAnalytics.trendData || [];
  if (trendPoints.length >= 4) {
    const midpoint = Math.ceil(trendPoints.length / 2);
    const previousAverage = average(trendPoints.slice(0, midpoint).map((point) => point.brandMentions));
    const recentAverage = average(trendPoints.slice(midpoint).map((point) => point.brandMentions));

    if (previousAverage > 0 && recentAverage < previousAverage * 0.85) {
      const declinePct = ((previousAverage - recentAverage) / previousAverage) * 100;
      addCandidate(candidates, {
        id: 'trend-decline',
        title: 'Reverse the recent visibility slowdown',
        description: `Average brand mentions dropped from ${previousAverage.toFixed(1)} to ${recentAverage.toFixed(1)} per time bucket in the latest trend window.`,
        priority: declinePct >= 30 ? 'high' : 'medium',
        category: 'Momentum',
        imageUrl: '',
        readTime: '3 min read',
        rating: 0,
        details: [
          'Re-run the topics that slipped in the latest window and inspect how provider responses changed before widening your keyword set.',
          'Update the pages behind the declining intents first, especially the pages that used to earn both mentions and citations.',
          'Once the trend stabilizes, extend adjacent topic coverage instead of restarting from broad category terms.',
        ],
        evidence: [
          `Previous average mentions: ${previousAverage.toFixed(1)}`,
          `Recent average mentions: ${recentAverage.toFixed(1)}`,
          `Drop: ${declinePct.toFixed(1)}%`,
        ],
        score: 88 + Math.round(declinePct),
      });
    }
  }

  if (
    strongestProvider &&
    weakestProvider &&
    strongestProvider.provider !== weakestProvider.provider &&
    strongestProvider.mentionRate - weakestProvider.mentionRate >= 0.35
  ) {
    addCandidate(candidates, {
      id: 'provider-gap',
      title: `Close the gap between ${formatProviderName(strongestProvider.provider)} and ${formatProviderName(weakestProvider.provider)}`,
      description: `${formatProviderName(strongestProvider.provider)} is materially stronger than ${formatProviderName(weakestProvider.provider)} on brand mentions per processed query.`,
      priority: 'medium',
      category: 'Provider Strategy',
      imageUrl: '',
      readTime: '3 min read',
      rating: 0,
      details: [
        `Take the pages and content patterns that already work on ${formatProviderName(strongestProvider.provider)} and reuse that structure for the intents where ${formatProviderName(weakestProvider.provider)} is missing the brand.`,
        'Keep the same topic boundaries, evidence style, and comparison framing so the weaker provider sees the same strong signals.',
        'Do not average the providers together mentally; fix the weakest provider directly because it is pulling the overall dashboard down.',
      ],
      evidence: [
        `${formatProviderName(strongestProvider.provider)} mention rate: ${(strongestProvider.mentionRate * 100).toFixed(1)}%`,
        `${formatProviderName(weakestProvider.provider)} mention rate: ${(weakestProvider.mentionRate * 100).toFixed(1)}%`,
      ],
      score: 72 + Math.round((strongestProvider.mentionRate - weakestProvider.mentionRate) * 100),
    });
  }

  if (candidates.length < 3 && strongestProvider) {
    addCandidate(candidates, {
      id: 'double-down-top-provider',
      title: `Scale what already works on ${formatProviderName(strongestProvider.provider)}`,
      description: `${formatProviderName(strongestProvider.provider)} is your strongest provider right now. Expand the adjacent intents and source pages that already win there.`,
      priority: 'low',
      category: 'Expansion',
      imageUrl: '',
      readTime: '2 min read',
      rating: 0,
      details: [
        `Use ${formatProviderName(strongestProvider.provider)} as the leading indicator for where ${brandName} already has product-market-message fit in AI answers.`,
        'Expand nearby comparisons, alternatives, implementation questions, and pricing queries around those winning topics.',
        'Keep the evidence format consistent so new pages inherit the same citation pattern instead of starting from scratch.',
      ],
      evidence: [
        `Top provider: ${formatProviderName(strongestProvider.provider)}`,
        `${formatProviderName(strongestProvider.provider)} mention rate: ${(strongestProvider.mentionRate * 100).toFixed(1)}%`,
      ],
      score: 40,
    });
  }

  if (candidates.length < 3 && trackedQueryCount < 8) {
    addCandidate(candidates, {
      id: 'expand-query-footprint',
      title: 'Broaden query coverage across more intents',
      description: `You are only tracking ${trackedQueryCount} quer${trackedQueryCount === 1 ? 'y' : 'ies'} for ${brandName}. The current footprint is still narrow.`,
      priority: 'low',
      category: 'Coverage',
      imageUrl: '',
      readTime: '2 min read',
      rating: 0,
      details: [
        'Add more alternatives, pricing, implementation, and comparison prompts so the dashboard samples a broader part of the buying journey.',
        'A narrow query set can make both wins and losses look larger than they really are because there are too few measurement points.',
        'Keep the added queries close to real buyer language rather than generic category terms.',
      ],
      evidence: [
        `Tracked queries today: ${trackedQueryCount}`,
      ],
      score: 35,
    });
  }

  if (candidates.length < 3) {
    const currentSessionQueries = latestAnalytics?.totalQueriesProcessed || 0;
    addCandidate(candidates, {
      id: 'maintain-session-rhythm',
      title: 'Keep a steady refresh rhythm on live query runs',
      description: `You have ${lifetimeAnalytics.totalProcessingSessions} processing session${lifetimeAnalytics.totalProcessingSessions === 1 ? '' : 's'} and ${currentSessionQueries} quer${currentSessionQueries === 1 ? 'y' : 'ies'} in the latest run.`,
      priority: 'low',
      category: 'Monitoring',
      imageUrl: '',
      readTime: '2 min read',
      rating: 0,
      details: [
        'Re-run the same tracked set on a consistent cadence so trend shifts are comparable across sessions.',
        'That keeps provider performance, citations, and competitive movement grounded in repeatable measurement instead of ad hoc spot checks.',
      ],
      evidence: [
        `Lifetime processing sessions: ${lifetimeAnalytics.totalProcessingSessions}`,
        `Latest session queries: ${currentSessionQueries}`,
      ],
      score: 25,
    });
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ score, ...recommendation }) => recommendation);
}
