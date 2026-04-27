import { after, NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import {
  getReprocessingJobForUser,
  requestReprocessingJobCancellation,
  shouldResumeReprocessingJob,
} from '@/lib/jobs/reprocessingJobs';
import { runReprocessingJob } from '@/lib/jobs/reprocessingJobRunner';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { jobId } = await context.params;
  const job = await getReprocessingJobForUser(jobId, authResult.uid);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (shouldResumeReprocessingJob(job)) {
    after(async () => {
      await runReprocessingJob(job.id);
    });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { jobId } = await context.params;

  try {
    const body = await request.json();
    if (body?.action !== 'cancel') {
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
    console.error(`❌ /api/reprocessing-jobs/${jobId} POST failed:`, error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
