import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authenticateApiRequest,
  configuredServiceSecret,
  getOpenRouterApiKey,
  parseBearerToken,
  secretsMatch,
} from '@/lib/serverAuth';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';
import { getAppUserProfileByUserId } from '@/lib/db/appUsers';
import {
  executeUserQueryServer,
  type UserQueryWorkflowResult,
} from '@/lib/userQueryExecutionServer';
import { logger } from '@/lib/logger';

const UserQueryRequestSchema = z.object({
  query: z.string().trim().min(4).max(500),
  persistResult: z.boolean().optional().default(false),
  brandId: z.string().trim().min(1).max(200).optional(),
  keyword: z.string().trim().min(1).max(160).optional(),
  category: z.enum(['Awareness', 'Interest', 'Consideration', 'Purchase']).optional(),
  processingSessionId: z.string().trim().min(1).max(200).optional(),
  processingSessionTimestamp: z.iso.datetime().optional(),
  clientRequestId: z.string().trim().min(1).max(160),
}).strict().superRefine((value, ctx) => {
  if (!value.persistResult) return;

  if (!value.brandId) {
    ctx.addIssue({
      code: 'custom',
      path: ['brandId'],
      message: 'brandId is required when persistResult is true',
    });
  }

  if (!value.processingSessionId) {
    ctx.addIssue({
      code: 'custom',
      path: ['processingSessionId'],
      message: 'processingSessionId is required when persistResult is true',
    });
  }

  if (!value.processingSessionTimestamp) {
    ctx.addIssue({
      code: 'custom',
      path: ['processingSessionTimestamp'],
      message: 'processingSessionTimestamp is required when persistResult is true',
    });
  }

});

async function authenticateUserQueryRequest(
  request: NextRequest
): Promise<{ uid: string; openRouterApiKey?: string } | null> {
  const token = parseBearerToken(request);
  const serviceSecret = configuredServiceSecret(process.env.SERVICE_API_SECRET);

  if (token && serviceSecret && secretsMatch(token, serviceSecret)) {
    const serviceUserIdResult = z.string().trim().min(1).max(200).safeParse(
      request.headers.get('x-service-user-id')
    );
    if (!serviceUserIdResult.success) {
      return null;
    }
    const serviceUserId = serviceUserIdResult.data;

    const profile = await getAppUserProfileByUserId(serviceUserId);
    if (!profile) {
      return null;
    }

    return {
      uid: serviceUserId,
      openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || undefined,
    };
  }

  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return null;
  }

  return {
    uid: authResult.uid,
    openRouterApiKey: getOpenRouterApiKey(request) || undefined,
  };
}

function jsonWorkflowResult(result: UserQueryWorkflowResult): NextResponse {
  if (result.success) {
    return NextResponse.json(result);
  }

  const { httpStatus, ...body } = result;
  return NextResponse.json(body, {
    status: httpStatus,
    ...(result.retryAfterSeconds && {
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
      },
    }),
  });
}

async function handlePost(request: NextRequest) {
  const authResult = await authenticateUserQueryRequest(request);
  if (!authResult) {
    return NextResponse.json(
      {
        success: false,
        error: 'OpenRouter API key required.',
        code: 'OPENROUTER_KEY_REQUIRED',
      },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsedInput = UserQueryRequestSchema.safeParse(body);

  if (!parsedInput.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid user query request',
        code: 'INVALID_REQUEST',
        issues: parsedInput.error.issues,
      },
      { status: 400 }
    );
  }

  const rateLimit = await consumeRateLimit({
    bucketId: `endpoint:/api/user-query:user:${authResult.uid}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many query requests. Please retry shortly.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const result = await executeUserQueryServer({
    userId: authResult.uid,
    openRouterApiKey: authResult.openRouterApiKey,
    ...parsedInput.data,
  });

  return jsonWorkflowResult(result);
}

export async function POST(request: NextRequest) {
  try {
    return await handlePost(request);
  } catch (error) {
    logger.error('User Query API error', error);
    return NextResponse.json(
      {
        success: false,
        error: 'The query service is temporarily unavailable. Please try again.',
        code: 'USER_QUERY_SERVICE_UNAVAILABLE',
      },
      { status: 503 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'User Query API - provider execution, idempotency, and persistence are handled by the server workflow service.',
    localMode: {
      authenticationRequired: false,
      providerKeyHeader: 'X-OpenRouter-Api-Key',
      description: 'Browser requests use the fixed local workspace identity and provide the OpenRouter key per request.',
    },
    endpoints: {
      POST: {
        description: 'Submit a query to configured user-query providers.',
        headers: {
          'X-OpenRouter-Api-Key': '<openrouter-api-key>',
          'Content-Type': 'application/json',
        },
        body: {
          query: 'Your question here (required)',
          clientRequestId: 'Stable idempotency key (required)',
          persistResult: 'Persist the result server-side and return only after the write succeeds (optional)',
          brandId: 'Required when persistResult is true',
          processingSessionId: 'Required when persistResult is true',
          processingSessionTimestamp: 'Required when persistResult is true',
        },
      },
    },
    errorCodes: {
      OPENROUTER_KEY_REQUIRED: 'No OpenRouter API key was provided',
      LOCAL_PROFILE_REQUIRED: 'The local workspace profile is unavailable',
      INVALID_REQUEST: 'Request body failed validation',
      RATE_LIMITED: 'Per-user endpoint rate limit exceeded',
      REQUEST_IN_PROGRESS: 'The same idempotency key is currently processing',
      REQUEST_PREVIOUSLY_FAILED: 'The same idempotency key previously failed; submit a new key for a new attempt',
      IDEMPOTENCY_KEY_REUSED: 'The idempotency key was reused for a different payload',
      NO_PROVIDERS_CONFIGURED: 'No preferred query providers are configured',
      ALL_PROVIDERS_FAILED: 'No provider returned a successful response',
      PERSISTENCE_FAILED: 'Provider response could not be persisted',
      UNHANDLED_USER_QUERY_ERROR: 'Unhandled server workflow error',
      USER_QUERY_SERVICE_UNAVAILABLE: 'Authentication, rate limiting, or workflow infrastructure is unavailable',
    },
  });
}
