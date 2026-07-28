import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { getBrandSql } from '@/lib/db/brands';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ brandId: string }> }
) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult) {
      return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });
    }

    const { brandId } = await context.params;
    const includeQueryResults = request.nextUrl.searchParams.get('includeQueryResults') === 'true';
    const result = await getBrandSql(brandId, authResult.uid, includeQueryResults);

    if (!result) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      brand: result,
    });
  } catch (error) {
    logger.error('Failed to load brand', error);
    return NextResponse.json({ error: 'Failed to load brand' }, { status: 500 });
  }
}
