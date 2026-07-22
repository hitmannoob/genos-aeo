import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/firebase/firebase-admin';
import {
  runDataSanityChecks,
  type DataSanityCheckOptions,
} from '@/lib/dataSanityServer';
import { isAdminEmail } from '@/lib/adminEmails';
import {
  configuredServiceSecret,
  parseBearerToken,
  secretsMatch,
} from '@/lib/serverAuth';
import { logger } from '@/lib/logger';

interface AuthenticatedActor {
  uid?: string;
  email?: string | null;
  mode: 'admin' | 'service';
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

async function authenticateAdminRequest(
  request: NextRequest
): Promise<
  | { actor: AuthenticatedActor }
  | { error: string; code: string; status: number }
> {
  const token = parseBearerToken(request);
  if (!request.headers.get('authorization')) {
    return {
      error: 'Missing authorization header.',
      code: 'NO_AUTH_HEADER',
      status: 401,
    };
  }

  if (!token) {
    return {
      error: 'Missing bearer token.',
      code: 'NO_BEARER_TOKEN',
      status: 401,
    };
  }

  const serviceSecret = configuredServiceSecret(process.env.ADMIN_API_SECRET)
    ?? configuredServiceSecret(process.env.SERVICE_API_SECRET);
  if (serviceSecret && secretsMatch(token, serviceSecret)) {
    return {
      actor: {
        mode: 'service',
      },
    };
  }

  try {
    const decodedToken = await auth.verifyIdToken(token, true);
    if (!decodedToken?.uid) {
      return {
        error: 'Invalid Firebase ID token.',
        code: 'INVALID_TOKEN',
        status: 401,
      };
    }

    if (!isAdminEmail(decodedToken.email)) {
      return {
        error: 'User is not allowed to run data sanity checks.',
        code: 'NOT_ADMIN',
        status: 403,
      };
    }

    return {
      actor: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        mode: 'admin',
      },
    };
  } catch (error) {
    logger.warn('Admin data-sanity authentication failed', error);
    return {
      error: 'Token verification failed.',
      code: 'TOKEN_VERIFICATION_FAILED',
      status: 401,
    };
  }
}

function buildOptionsFromSearchParams(searchParams: URLSearchParams): DataSanityCheckOptions {
  return {
    brandId: searchParams.get('brandId') || undefined,
    userId: searchParams.get('userId') || undefined,
    maxBrands: parseInteger(searchParams.get('maxBrands')),
    maxIssues: parseInteger(searchParams.get('maxIssues')),
    maxLedgerDocs: parseInteger(searchParams.get('maxLedgerDocs')),
    includeProviderResults: parseBoolean(
      searchParams.get('includeProviderResults') ?? searchParams.get('includeAnalytics'),
      true
    ),
    includeLedger: parseBoolean(searchParams.get('includeLedger'), true),
  };
}

function buildOptionsFromBody(body: Record<string, unknown>): DataSanityCheckOptions {
  return {
    brandId: typeof body.brandId === 'string' ? body.brandId : undefined,
    userId: typeof body.userId === 'string' ? body.userId : undefined,
    maxBrands: parseInteger(body.maxBrands),
    maxIssues: parseInteger(body.maxIssues),
    maxLedgerDocs: parseInteger(body.maxLedgerDocs),
    includeProviderResults: parseBoolean(
      body.includeProviderResults ?? body.includeAnalytics,
      true
    ),
    includeLedger: parseBoolean(body.includeLedger, true),
  };
}

async function handleRun(
  request: NextRequest,
  options: DataSanityCheckOptions
) {
  const authResult = await authenticateAdminRequest(request);
  if ('error' in authResult) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
        code: authResult.code,
      },
      { status: authResult.status }
    );
  }

  try {
    const report = await runDataSanityChecks(options);
    return NextResponse.json({
      success: true,
      requestedBy: authResult.actor,
      report,
    });
  } catch (error) {
    logger.error('Data-sanity checks failed', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run data sanity checks.',
        code: 'DATA_SANITY_CHECK_FAILED',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const options = buildOptionsFromSearchParams(request.nextUrl.searchParams);
  return handleRun(request, options);
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const options = buildOptionsFromBody(body);
  return handleRun(request, options);
}
