import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { createBrandWithCreditsServer } from '@/firebase/firestore/createBrandWithCreditsServer';
import { getUserBrandsServer } from '@/firebase/firestore/getUserBrandsServer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const includeQueryResults = request.nextUrl.searchParams.get('includeQueryResults') === 'true';
  const { result, error } = await getUserBrandsServer(authResult.uid, includeQueryResults);

  if (error) {
    return NextResponse.json({ error: 'Failed to load brands' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    brands: result || [],
  });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiRequest(request, { requireProfile: true });
  if (!authResult?.profile) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      brandId,
      brandData,
      creditCost = 100,
    } = body || {};

    if (!brandId || !brandData || typeof brandData !== 'object') {
      return NextResponse.json({
        error: 'brandId and brandData are required',
      }, { status: 400 });
    }

    if (brandData.userId !== authResult.uid) {
      return NextResponse.json({
        error: 'Brand data userId does not match the authenticated user',
      }, { status: 403 });
    }

    const result = await createBrandWithCreditsServer({
      brandId,
      userId: authResult.uid,
      brandData,
      creditCost,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        creditsAfter: result.creditsAfter,
      });
    }

    const status =
      result.code === 'INSUFFICIENT_CREDITS' ? 402 :
      result.code === 'BRAND_ALREADY_EXISTS' ? 409 :
      result.code === 'DOC_TOO_LARGE' ? 413 :
      result.code === 'USER_NOT_FOUND' ? 404 :
      500;

    return NextResponse.json(result, { status });
  } catch (error) {
    console.error('❌ /api/brands POST failed:', error);
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 });
  }
}
