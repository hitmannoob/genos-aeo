import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import {
  addKeywordToBrandServer,
  addQueryToBrandServer,
} from '@/firebase/firestore/brandQueryMutationsServer';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ brandId: string }> }
) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { brandId } = await context.params;

  try {
    const body = await request.json();
    const { action } = body || {};

    if (action === 'addKeyword') {
      await addKeywordToBrandServer(brandId, authResult.uid, body.keyword || '');
      return NextResponse.json({ success: true });
    }

    if (action === 'addQuery') {
      await addQueryToBrandServer({
        brandId,
        userId: authResult.uid,
        rawQuery: body.query || '',
        category: body.category || '',
        keyword: body.keyword || '',
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({
      error: 'Unsupported action',
    }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message === 'Unauthorized' ? 403 :
      message === 'Brand not found' ? 404 :
      400;

    console.error(`❌ /api/brands/${brandId}/queries failed:`, error);
    return NextResponse.json({
      error: message,
    }, { status });
  }
}
