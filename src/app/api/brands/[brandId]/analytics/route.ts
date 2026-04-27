import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { calculateBrandAnalyticsBundleServer } from '@/lib/analytics/brandAnalyticsServer';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ brandId: string }> }
) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { brandId } = await context.params;
  const includeCompetitors = request.nextUrl.searchParams.get('includeCompetitors') === 'true';
  const { result, error } = await calculateBrandAnalyticsBundleServer(
    brandId,
    authResult.uid,
    { includeCompetitors }
  );

  if (error || !result) {
    return NextResponse.json({ error: 'Failed to load brand analytics' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    latestAnalytics: result.latestAnalytics,
    lifetimeAnalytics: result.lifetimeAnalytics,
    competitorAnalytics: result.competitorAnalytics,
    recommendations: result.recommendations,
  });
}
