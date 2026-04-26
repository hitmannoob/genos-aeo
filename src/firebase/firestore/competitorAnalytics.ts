import { CompetitorAnalyticsData, calculateCumulativeCompetitorAnalytics } from '@/utils/competitor-analytics';
import { Competitor } from '@/lib/competitor-matching';
import { loadBrandQueryCorpus } from './brandQueryCorpus';

/**
 * Live-compute competitor analytics for a brand from the same full query corpus
 * used by lifetime brand analytics.
 *
 * Counterpart to calculateLifetimeBrandAnalytics: both read the same corpus
 * (current brand results plus legacy historical rows, with Cloud Storage
 * fallback) and use the same matcher (matchCompetitorsInText via
 * analyzeCompetitorMentionsInQuery), so brand vs. competitor numbers on the
 * dashboard are always comparable.
 *
 * Returns:
 *   - current:  analytics over ALL query results
 *   - previous: analytics over all results EXCEPT those from the latest
 *               processingSessionId (used to derive per-competitor trend delta).
 */
export async function calculateLiveCompetitorAnalytics(
  brandId: string,
  userId: string,
  preloaded?: { brand: any; dataTruncated: boolean }
): Promise<{
  result?: {
    current: CompetitorAnalyticsData;
    previous: CompetitorAnalyticsData | null;
    dataTruncated: boolean;
  };
  error?: any;
}> {
  try {
    const { result: corpus, error: corpusError } = await loadBrandQueryCorpus(
      brandId,
      userId,
      preloaded
    );

    if (corpusError || !corpus) {
      return { error: corpusError || new Error('Failed to load brand query corpus') };
    }

    const { brand, dataTruncated, allResults } = corpus;

    const competitors: Competitor[] = ((brand as any).competitors || []).map((name: string) => ({
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

    // Find the latest processingSessionId so we can produce a "previous" slice.
    // Parse as Date — lexicographic compare is only safe for ISO timestamps.
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
      ? allResults.filter((r: any) => r.processingSessionId !== latestSessionId)
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

    return { result: { current, previous, dataTruncated } };
  } catch (e) {
    console.error('❌ calculateLiveCompetitorAnalytics failed', e);
    return { error: e };
  }
}
