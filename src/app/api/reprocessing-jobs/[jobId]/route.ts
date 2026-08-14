import { after, NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import {
  getReprocessingJobForUser,
  requestReprocessingJobCancellation,
  shouldResumeReprocessingJob,
} from '@/lib/jobs/reprocessingJobs';
import { runReprocessingJob } from '@/lib/jobs/reprocessingJobRunner';
import { z } from 'zod';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const jobIdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const parsedJobId = jobIdSchema.safeParse((await context.params).jobId);
    if (!parsedJobId.success) {
      return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }
    const jobId = parsedJobId.data;
    const job = await getReprocessingJobForUser(jobId, authResult.uid);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (shouldResumeReprocessingJob(job)) {
      if (!authResult.openRouterApiKey) {
        return NextResponse.json(
          { error: 'Add an OpenRouter API key to resume this job', code: 'OPENROUTER_KEY_REQUIRED' },
          { status: 400 }
        );
      }
      after(async () => {
        try {
          await runReprocessingJob(job.id, authResult.openRouterApiKey || undefined);
        } catch (error) {
          logger.error('Failed to resume reprocessing job', error);
        }
      });
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    logger.error('Failed to load reprocessing job', error);
    return NextResponse.json({ error: 'Failed to load reprocessing job' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const parsedJobId = jobIdSchema.safeParse((await context.params).jobId);
  if (!parsedJobId.success) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }
  const jobId = parsedJobId.data;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || body.action !== 'cancel') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const job = await requestReprocessingJobCancellation(jobId, authResult.uid);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    logger.error('Failed to update reprocessing job', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
