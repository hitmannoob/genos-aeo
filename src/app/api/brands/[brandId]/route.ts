import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { getBrandServer } from '@/firebase/firestore/getUserBrandsServer';

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
  const includeQueryResults = request.nextUrl.searchParams.get('includeQueryResults') === 'true';
  const { result, error } = await getBrandServer(brandId, authResult.uid, includeQueryResults);

  if (error || !result) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    brand: result,
  });
}
