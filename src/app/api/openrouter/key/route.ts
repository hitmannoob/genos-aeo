import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';
import { validateOpenRouterCredential } from '@/lib/openRouterCredential';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult) {
      return NextResponse.json(
        { valid: false, error: 'Authentication required' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    if (!authResult.openRouterApiKey) {
      return NextResponse.json(
        { valid: false, error: 'Enter a valid OpenRouter API key' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const rateLimit = await consumeRateLimit({
      bucketId: `endpoint:/api/openrouter/key:user:${authResult.uid}`,
      limit: 10,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { valid: false, error: 'Too many key checks. Please retry shortly.' },
        {
          status: 429,
          headers: {
            ...NO_STORE_HEADERS,
            'Retry-After': String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const validation = await validateOpenRouterCredential(authResult.openRouterApiKey);
    if (validation.status === 'valid') {
      return NextResponse.json(
        { valid: true },
        { headers: NO_STORE_HEADERS },
      );
    }

    const status = validation.status === 'invalid' ? 400 : 503;
    const retryAfterSeconds = validation.status === 'unavailable'
      ? validation.retryAfterSeconds
      : undefined;
    return NextResponse.json(
      { valid: false, error: validation.message },
      {
        status,
        headers: {
          ...NO_STORE_HEADERS,
          ...(retryAfterSeconds
            ? { 'Retry-After': String(retryAfterSeconds) }
            : {}),
        },
      },
    );
  } catch (error) {
    logger.error('OpenRouter key validation failed', error);
    return NextResponse.json(
      { valid: false, error: 'The key validation service is temporarily unavailable.' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
