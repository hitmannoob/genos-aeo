import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { BRAND_CREATION_CREDIT_COST } from '@/lib/billing/serverCredits';
import {
  createBrandWithCreditsSql,
  getUserBrandsSql,
} from '@/lib/db/brands';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const CreateBrandRequestSchema = z.object({
  brandId: z.string().trim().min(1).max(300),
  brandData: z.record(z.string(), z.any()),
});

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const includeQueryResults = request.nextUrl.searchParams.get('includeQueryResults') === 'true';

  try {
    const brands = await getUserBrandsSql(authResult.uid, includeQueryResults);
    return NextResponse.json({
      success: true,
      brands,
    });
  } catch (error) {
    console.error('❌ /api/brands GET failed:', error);
    return NextResponse.json({ error: 'Failed to load brands' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiRequest(request, { requireProfile: true });
  if (!authResult?.profile) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const parsedInput = CreateBrandRequestSchema.safeParse(body);

    if (!parsedInput.success) {
      return NextResponse.json({
        error: 'brandId and brandData are required',
      }, { status: 400 });
    }

    const { brandId, brandData } = parsedInput.data;

    if (!brandId.startsWith(`${authResult.uid}_`)) {
      return NextResponse.json({
        error: 'Brand id must be scoped to the authenticated user',
      }, { status: 403 });
    }

    const serverBrandData = {
      ...brandData,
      userId: authResult.uid,
      creditsUsed: BRAND_CREATION_CREDIT_COST,
      creditTransaction: {
        amount: BRAND_CREATION_CREDIT_COST,
        type: 'deduction',
        reason: 'Brand setup completion',
        timestamp: new Date().toISOString(),
      },
    };

    const result = await createBrandWithCreditsSql({
      brandId,
      firebaseUid: authResult.uid,
      brandData: serverBrandData,
      creditCost: BRAND_CREATION_CREDIT_COST,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        brandId: result.brandId,
        creditsAfter: result.creditsAfter,
      });
    }

    const status =
      result.code === 'INSUFFICIENT_CREDITS' ? 402 :
      result.code === 'BRAND_ALREADY_EXISTS' ? 409 :
      result.code === 'USER_NOT_FOUND' ? 404 :
      500;

    return NextResponse.json(result, { status });
  } catch (error) {
    console.error('❌ /api/brands POST failed:', error);
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 });
  }
}
