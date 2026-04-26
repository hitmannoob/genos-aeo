import { after, NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { getBrandServer } from '@/firebase/firestore/getUserBrandsServer';
import {
  createReprocessingJob,
  findActiveReprocessingJobForBrand,
  shouldResumeReprocessingJob,
} from '@/firebase/firestore/reprocessingJobs';
import { buildTrackedQueryIdentity } from '@/firebase/firestore/queryResultUtils';
import { runReprocessingJob } from '@/firebase/firestore/reprocessingJobRunner';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const brandId = request.nextUrl.searchParams.get('brandId');
  if (!brandId) {
    return NextResponse.json({ error: 'brandId is required' }, { status: 400 });
  }

  const activeJob = await findActiveReprocessingJobForBrand(authResult.uid, brandId);
  if (!activeJob) {
    return NextResponse.json({ success: true, job: null });
  }

  if (shouldResumeReprocessingJob(activeJob)) {
    after(async () => {
      await runReprocessingJob(activeJob.id);
    });
  }

  return NextResponse.json({
    success: true,
    job: activeJob,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiRequest(request, { requireProfile: true });
  if (!authResult?.profile) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const brandId = typeof body?.brandId === 'string' ? body.brandId : '';
    const queriesFilter = Array.isArray(body?.queriesFilter)
      ? body.queriesFilter.filter((value: unknown): value is string => typeof value === 'string')
      : [];

    if (!brandId) {
      return NextResponse.json({ error: 'brandId is required' }, { status: 400 });
    }

    const { result: brand, error } = await getBrandServer(brandId, authResult.uid);
    if (error || !brand) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }

    const allQueries = Array.isArray((brand as any).queries) ? (brand as any).queries : [];
    const queries = queriesFilter.length > 0
      ? allQueries.filter((query: any) => queriesFilter.includes(buildTrackedQueryIdentity(query)))
      : allQueries;

    if (queries.length === 0) {
      return NextResponse.json({ error: 'No queries to process' }, { status: 400 });
    }

    const creditsRequired = queries.length * 10;
    const availableCredits = Number(authResult.profile.credits ?? 0);
    if (availableCredits < creditsRequired) {
      return NextResponse.json({
        error: 'Insufficient credits',
        code: 'INSUFFICIENT_CREDITS',
        requiredCredits: creditsRequired,
        availableCredits,
      }, { status: 402 });
    }

    const existingActiveJob = await findActiveReprocessingJobForBrand(authResult.uid, brandId);
    if (existingActiveJob) {
      if (shouldResumeReprocessingJob(existingActiveJob)) {
        after(async () => {
          await runReprocessingJob(existingActiveJob.id);
        });
      }

      return NextResponse.json({
        success: true,
        job: existingActiveJob,
        reusedExistingJob: true,
      });
    }

    const job = await createReprocessingJob({
      userId: authResult.uid,
      brandId: brand.id,
      brandName: brand.companyName,
      brandDomain: brand.domain,
      queries,
      creditsRequired,
    });

    after(async () => {
      await runReprocessingJob(job.id);
    });

    return NextResponse.json({
      success: true,
      job,
      reusedExistingJob: false,
    });
  } catch (error) {
    console.error('❌ /api/reprocessing-jobs POST failed:', error);
    return NextResponse.json({ error: 'Failed to create reprocessing job' }, { status: 500 });
  }
}
