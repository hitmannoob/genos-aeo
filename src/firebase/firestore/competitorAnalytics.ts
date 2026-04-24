import { CompetitorAnalyticsData, calculateCumulativeCompetitorAnalytics } from '@/utils/competitor-analytics';
import { Competitor } from '@/lib/competitor-matching';
import { loadBrandWithQueryResults } from './brandWithResults';

/**
 * Live-compute competitor analytics for a brand from its queryProcessingResults.
 *
 * Counterpart to calculateLifetimeBrandAnalytics: both read the same corpus
 * (brand.queryProcessingResults, with Cloud Storage fallback) and use the same
 * matcher (matchCompetitorsInText via analyzeCompetitorMentionsInQuery), so
 * brand vs. competitor numbers on the dashboard are always comparable.
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
    let brand: any;
    let dataTruncated = false;
    if (preloaded) {
      brand = preloaded.brand;
      dataTruncated = preloaded.dataTruncated;
    } else {
      try {
        const loaded = await loadBrandWithQueryResults(brandId);
        brand = loaded.brand;
        dataTruncated = loaded.dataTruncated;
      } catch (e: any) {
        return { error: e?.message || 'Brand not found' };
      }
    }

    // Ownership guard: brand.userId must match the authenticated caller.
    if (brand.userId !== userId) {
      throw new Error('Unauthorized: brand does not belong to user');
    }

    const competitors: Competitor[] = ((brand as any).competitors || []).map((name: string) => ({
      name,
      domain: undefined,
      aliases: undefined,
    }));

    const allResults = brand.queryProcessingResults || [];
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
