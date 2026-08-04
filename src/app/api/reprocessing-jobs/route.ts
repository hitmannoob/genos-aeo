import { after, NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { getBrandSql } from '@/lib/db/brands';
import {
  createReprocessingJob,
  findActiveReprocessingJobForBrand,
  shouldResumeReprocessingJob,
} from '@/lib/jobs/reprocessingJobs';
import { buildTrackedQueryIdentity } from '@/lib/queryResultUtils';
import { runReprocessingJob } from '@/lib/jobs/reprocessingJobRunner';
import { z } from 'zod';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const createJobSchema = z.object({
  brandId: z.string().trim().min(1).max(200),
  queriesFilter: z.array(z.string().trim().min(1).max(1_000)).max(100).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });
  }

  try {
    const brandIdResult = z.string().trim().min(1).max(200).safeParse(
      request.nextUrl.searchParams.get('brandId')
    );
    if (!brandIdResult.success) {
      return NextResponse.json({ error: 'brandId is required' }, { status: 400 });
    }
    const brandId = brandIdResult.data;

    const activeJob = await findActiveReprocessingJobForBrand(authResult.uid, brandId);
    if (!activeJob) {
      return NextResponse.json({ success: true, job: null });
    }

    if (shouldResumeReprocessingJob(activeJob)) {
      after(async () => {
        try {
          await runReprocessingJob(activeJob.id, authResult.openRouterApiKey || undefined);
        } catch (error) {
          logger.error('Failed to resume reprocessing job', error);
        }
      });
    }

    return NextResponse.json({
      success: true,
      job: activeJob,
    });
  } catch (error) {
    logger.error('Failed to load active reprocessing job', error);
    return NextResponse.json({ error: 'Failed to load reprocessing job' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateApiRequest(request, { requireProfile: true });
    if (!authResult?.profile) {
      return NextResponse.json({ error: 'Local profile unavailable' }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const parsedBody = createJobSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid reprocessing request' }, { status: 400 });
    }
    const { brandId, queriesFilter = [] } = parsedBody.data;

    const brand = await getBrandSql(brandId, authResult.uid);
    if (!brand) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }

    const allQueries = brand.queries ?? [];
    const queries = queriesFilter.length > 0
      ? allQueries.filter((query) => queriesFilter.includes(buildTrackedQueryIdentity(query)))
      : allQueries;

    if (queries.length === 0) {
      return NextResponse.json({ error: 'No queries to process' }, { status: 400 });
    }

    const existingActiveJob = await findActiveReprocessingJobForBrand(authResult.uid, brandId);
    if (existingActiveJob) {
      if (shouldResumeReprocessingJob(existingActiveJob)) {
        after(async () => {
          try {
            await runReprocessingJob(
              existingActiveJob.id,
              authResult.openRouterApiKey || undefined,
            );
          } catch (error) {
            logger.error('Failed to resume existing reprocessing job', error);
          }
        });
      }

      return NextResponse.json({
        success: true,
        job: existingActiveJob,
        reusedExistingJob: true,
      });
    }

    const creation = await createReprocessingJob({
      userId: authResult.uid,
      brandId: brand.id,
      brandName: brand.companyName,
      brandDomain: brand.domain,
      queries,
    });

    after(async () => {
      try {
        await runReprocessingJob(creation.job.id, authResult.openRouterApiKey || undefined);
      } catch (error) {
        logger.error('Failed to run new reprocessing job', error);
      }
    });

    return NextResponse.json({
      success: true,
      job: creation.job,
      reusedExistingJob: creation.reusedExistingJob,
    });
  } catch (error) {
    logger.error('Failed to create reprocessing job', error);
    return NextResponse.json({ error: 'Failed to create reprocessing job' }, { status: 500 });
  }
}
