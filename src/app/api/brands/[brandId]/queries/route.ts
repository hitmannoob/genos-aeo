import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/serverAuth';
import {
  addKeywordToBrandSql,
  addQueryToBrandSql,
} from '@/lib/db/brands';
import { z } from 'zod';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const mutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('addKeyword'),
    keyword: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    action: z.literal('addQuery'),
    query: z.string().trim().min(4).max(500),
    keyword: z.string().trim().min(1).max(160),
    category: z.enum(['Awareness', 'Interest', 'Consideration', 'Purchase']),
  }).strict(),
]);

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
    const body = await request.json().catch(() => null);
    const parsedBody = mutationSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid query mutation request' }, { status: 400 });
    }
    const mutation = parsedBody.data;

    if (mutation.action === 'addKeyword') {
      await addKeywordToBrandSql(brandId, authResult.uid, mutation.keyword);
      return NextResponse.json({ success: true });
    }

    if (mutation.action === 'addQuery') {
      await addQueryToBrandSql({
        brandId,
        firebaseUid: authResult.uid,
        rawQuery: mutation.query,
        category: mutation.category,
        keyword: mutation.keyword,
      });
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      message === 'Unauthorized' ? 403 :
      message === 'Brand not found' ? 404 :
      message === 'Query already exists' ? 409 :
      message === 'Topic is empty' ||
      message === 'Query is empty' ||
      message === 'Topic is required' ||
      message === 'Invalid query category' ||
      message === 'A brand can have at most 20 topics' ||
      message === 'A brand can have at most 100 queries' ? 400 :
      500;

    const safeValidationMessages = new Set([
      'Topic is empty',
      'Query is empty',
      'Query already exists',
      'Topic is required',
      'Invalid query category',
      'A brand can have at most 20 topics',
      'A brand can have at most 100 queries',
    ]);
    if (!safeValidationMessages.has(message) && status === 500) {
      logger.error('Failed to update brand queries', error);
    }
    return NextResponse.json({
      error: safeValidationMessages.has(message)
        ? message
        : status === 404
          ? 'Brand not found'
          : 'Failed to update brand queries',
    }, { status });
  }
}
