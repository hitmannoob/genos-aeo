import { CompetitorAnalyticsData, calculateCumulativeCompetitorAnalytics } from '@/utils/competitor-analytics';
import { Competitor } from '@/lib/competitor-matching';
import type { BrandQueryCorpus } from './brandQueryCorpus';

export function calculateLiveCompetitorAnalyticsFromCorpus(
  brandId: string,
  corpus: BrandQueryCorpus
): {
  current: CompetitorAnalyticsData;
  previous: CompetitorAnalyticsData | null;
} {
  const { brand, allResults } = corpus;

  const competitors: Competitor[] = (brand.competitors || []).map((name) => ({
    name,
    domain: undefined,
    aliases: undefined,
  }));

  const timestamp = new Date().toISOString();

  const current = calculateCumulativeCompetitorAnalytics(
    brand.userId,
    brandId,
    brand.companyName,
    brand.domain,
    'live_lifetime',
    timestamp,
    competitors,
    allResults
  );

  let latestSessionId: string | null = null;
  let latestMs = -Infinity;
  for (const r of allResults) {
    const ts = r.processingSessionTimestamp || r.date || '';
    const ms = ts ? new Date(ts).getTime() : NaN;
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms;
      latestSessionId = r.processingSessionId || null;
    }
  }

  const previousResults = latestSessionId
    ? allResults.filter((r) => r.processingSessionId !== latestSessionId)
    : [];

  const previous = previousResults.length > 0
    ? calculateCumulativeCompetitorAnalytics(
        brand.userId,
        brandId,
        brand.companyName,
        brand.domain,
        'live_previous',
        timestamp,
        competitors,
        previousResults
      )
    : null;

  return { current, previous };
}
