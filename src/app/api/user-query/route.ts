import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { USER_QUERY_CREDIT_COST } from '@/lib/billing/serverCredits';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';
import { getAppUserProfileByFirebaseUid } from '@/lib/db/appUsers';
import {
  executeUserQueryServer,
  type UserQueryWorkflowResult,
} from '@/lib/userQueryExecutionServer';

const UserQueryRequestSchema = z.object({
  query: z.string().trim().min(1).max(20_000),
  context: z.string().max(10_000).optional(),
  persistResult: z.boolean().optional().default(false),
  brandId: z.string().trim().min(1).optional(),
  brandName: z.string().optional(),
  brandDomain: z.string().optional(),
  keyword: z.string().optional(),
  category: z.string().optional(),
  processingSessionId: z.string().trim().min(1).optional(),
  processingSessionTimestamp: z.string().trim().min(1).optional(),
  clientRequestId: z.string().trim().min(1).max(200).optional(),
}).superRefine((value, ctx) => {
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

  if (!value.clientRequestId) {
    ctx.addIssue({
      code: 'custom',
      path: ['clientRequestId'],
      message: 'clientRequestId is required when persistResult is true',
    });
  }
});

async function authenticateUserQueryRequest(
  request: NextRequest
): Promise<{ uid: string; isCron: boolean } | null> {
  const authorization = request.headers.get('authorization');
  const [scheme, token] = authorization?.split(' ') || [];

  if (scheme?.toLowerCase() === 'bearer' && token && process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
    const cronUserId = request.headers.get('x-cron-user-id');
    if (!cronUserId) {
      return null;
    }

    const profile = await getAppUserProfileByFirebaseUid(cronUserId);
    if (!profile) {
      return null;
    }

    return {
      uid: cronUserId,
      isCron: true,
    };
  }

  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return null;
  }

  return {
    uid: authResult.uid,
    isCron: false,
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

export async function POST(request: NextRequest) {
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

  const authResult = await authenticateUserQueryRequest(request);
  if (!authResult) {
    return NextResponse.json(
      {
        success: false,
        error: 'Authentication required. Please provide a valid authorization token.',
        code: 'AUTHENTICATION_REQUIRED',
      },
      { status: 401 }
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

  const serviceBillingMode = request.headers.get('x-service-billing-mode') || 'skip';
  const skipBilling = authResult.isCron && serviceBillingMode !== 'charge';

  const result = await executeUserQueryServer({
    userId: authResult.uid,
    ...parsedInput.data,
    skipBilling,
  });

  return jsonWorkflowResult(result);
}

export async function GET() {
  return NextResponse.json({
    message: 'User Query API - provider execution, billing, idempotency, and persistence are handled by the server workflow service.',
    authentication: {
      required: true,
      method: 'Bearer token in Authorization header',
      description: 'Firebase ID token required for browser requests. Service requests may use CRON_SECRET with X-Cron-User-Id.',
    },
    creditCost: {
      perQuery: USER_QUERY_CREDIT_COST,
      description: 'Credits are deducted only after at least one provider succeeds.',
    },
    endpoints: {
      POST: {
        description: 'Submit a query to configured user-query providers.',
        headers: {
          Authorization: 'Bearer <firebase-id-token>',
          'Content-Type': 'application/json',
        },
        body: {
          query: 'Your question here (required)',
          context: 'Additional context for the query (optional)',
          clientRequestId: 'Stable idempotency key (optional, required for persistResult)',
          persistResult: 'Persist the result server-side and return only after the write succeeds (optional)',
          brandId: 'Required when persistResult is true',
          processingSessionId: 'Required when persistResult is true',
          processingSessionTimestamp: 'Required when persistResult is true',
        },
      },
    },
    errorCodes: {
      AUTHENTICATION_REQUIRED: 'Missing or invalid bearer token',
      INVALID_REQUEST: 'Request body failed validation',
      RATE_LIMITED: 'Per-user endpoint rate limit exceeded',
      REQUEST_IN_PROGRESS: 'The same idempotency key is currently processing',
      IDEMPOTENCY_KEY_REUSED: 'The idempotency key was reused for a different payload',
      INSUFFICIENT_CREDITS: 'User does not have enough credits',
      NO_PROVIDERS_CONFIGURED: 'No preferred query providers are configured',
      ALL_PROVIDERS_FAILED: 'No provider returned a successful response',
      CREDIT_DEDUCTION_FAILED: 'Provider succeeded but credit deduction failed',
      PERSISTENCE_FAILED_REFUNDED: 'Persistence failed and credits were refunded',
      PERSISTENCE_FAILED_REFUND_FAILED: 'Persistence failed and refund failed',
      UNHANDLED_USER_QUERY_ERROR: 'Unhandled server workflow error',
    },
  });
}
