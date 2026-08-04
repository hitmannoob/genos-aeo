import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { authenticateApiRequest } from '@/lib/serverAuth';
import {
  createBrandSql,
  getBrandPublicIdByDomainSql,
  getUserBrandsSql,
} from '@/lib/db/brands';
import { CreateBrandRequestSchema } from '@/lib/brandSchemas';
import { DomainValidationError, normalizePublicDomain } from '@/lib/domainValidation';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });
  }

  const includeQueryResults = request.nextUrl.searchParams.get('includeQueryResults') === 'true';

  try {
    const brands = await getUserBrandsSql(authResult.uid, includeQueryResults);
    return NextResponse.json({
      success: true,
      brands,
    });
  } catch (error) {
    logger.error('Failed to load brands', error);
    return NextResponse.json({ error: 'Failed to load brands' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateApiRequest(request, { requireProfile: true });
    if (!authResult?.profile) {
      return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const parsedInput = CreateBrandRequestSchema.safeParse(body);

    if (!parsedInput.success) {
      return NextResponse.json({
        error: 'Invalid brand data',
      }, { status: 400 });
    }

    const { brandData } = parsedInput.data;
    const domain = normalizePublicDomain(brandData.domain);
    const brandId = `brand_${createHash('sha256')
      .update(`${authResult.uid}\0${domain}`)
      .digest('hex')
      .slice(0, 40)}`;

    const queryDistribution = brandData.queries.reduce((distribution, query) => {
      const key = query.category.toLowerCase() as keyof typeof distribution;
      distribution[key] += 1;
      return distribution;
    }, {
      awareness: 0,
      interest: 0,
      consideration: 0,
      purchase: 0,
    });

    const serverBrandData = {
      domain,
      website: brandData.website,
      companyName: brandData.companyName,
      shortDescription: brandData.shortDescription,
      productsAndServices: brandData.productsAndServices,
      keywords: brandData.keywords,
      competitors: brandData.competitors,
      queries: brandData.queries,
      aiAnalysis: brandData.aiAnalysis ?? null,
      userId: authResult.uid,
      setupComplete: true,
      currentStep: 3,
      totalQueries: brandData.queries.length,
      queryDistribution,
    };

    const result = await createBrandSql({
      brandId,
      firebaseUid: authResult.uid,
      brandData: serverBrandData,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        brandId: result.brandId,
      });
    }

    const status =
      result.code === 'BRAND_ALREADY_EXISTS' ? 409 :
      result.code === 'USER_NOT_FOUND' ? 404 :
      500;

    if (result.code === 'BRAND_ALREADY_EXISTS') {
      const existingBrandId = await getBrandPublicIdByDomainSql(authResult.uid, domain);
      return NextResponse.json({ ...result, brandId: existingBrandId }, { status });
    }
    return NextResponse.json(result, { status });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    logger.error('Failed to create brand', error);
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 });
  }
}
