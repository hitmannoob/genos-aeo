import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import type { APIRequest } from '@/lib/api-providers/types';
import { authenticateApiRequest } from '@/lib/serverAuth';
import {
  deductUserCreditsServer,
  QUERY_GENERATION_CREDIT_COST,
  refundUserCreditsServer,
} from '@/lib/billing/serverCredits';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';
import {
  normalizeGeneratedQueries,
  QueryGenerationInputSchema,
} from '@/lib/queryGeneration';
import {
  acquireQueryExecution,
  completeQueryExecution,
  failQueryExecution,
} from '@/lib/db/queryExecution';
import { buildQueryGenerationPrompt, parseQueryGenerationResponse } from '@/lib/prompts/queryGeneration';
import { logger } from '@/lib/logger';

export const maxDuration = 300;

const PREFERRED_PROVIDERS = ['chatgptsearch', 'google-ai-overview'];

export async function POST(request: NextRequest) {
  let executionIdentity: { userId: string; clientRequestId: string } | null = null;
  let creditReservation: {
    userId: string;
    clientRequestId: string;
    fingerprint: string;
    executionRequestId: string;
  } | null = null;
  let userCredits: Awaited<ReturnType<typeof deductUserCreditsServer>> | null = null;

  const refundReservation = async (failureReason: string): Promise<boolean> => {
    if (!creditReservation) return true;
    const reservation = creditReservation;
    try {
      await refundUserCreditsServer(reservation.userId, QUERY_GENERATION_CREDIT_COST, {
        idempotencyKey: `query-generation:${reservation.userId}:${reservation.clientRequestId}:${reservation.fingerprint}:refund`,
        reason: 'query generation failure refund',
        executionRequestId: reservation.executionRequestId,
        metadata: { failureReason },
      });
      creditReservation = null;
      return true;
    } catch (refundError) {
      logger.error('Failed to refund query-generation credit reservation', refundError);
      return false;
    }
  };
  try {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
  if (!authResult.openRouterApiKey) {
    return NextResponse.json(
      { success: false, error: 'Add an OpenRouter API key to continue', code: 'OPENROUTER_KEY_REQUIRED' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsedInput = QueryGenerationInputSchema.safeParse(body);
  if (!parsedInput.success || parsedInput.data.company.keywords.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Valid company information with at least one keyword is required' },
      { status: 400 }
    );
  }

  const { clientRequestId, company } = parsedInput.data;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(company))
    .digest('hex');
  const execution = await acquireQueryExecution<Record<string, unknown>>({
    userId: authResult.uid,
    clientRequestId,
    requestFingerprintSource: {
      query: company.companyName,
      keyword: `query-generation:${JSON.stringify(company)}`,
    },
  });
  if (execution.status === 'replay') {
    return NextResponse.json(execution.response);
  }
  if (execution.status === 'in_progress') {
    return NextResponse.json(
      {
        success: false,
        error: 'This query-generation request is already in progress.',
        code: 'REQUEST_IN_PROGRESS',
        retryAfterSeconds: execution.retryAfterSeconds,
      },
      { status: 409, headers: { 'Retry-After': String(execution.retryAfterSeconds) } }
    );
  }
  if (execution.status === 'conflict' || execution.status === 'previous_failure') {
    return NextResponse.json(
      {
        success: false,
        error: execution.status === 'conflict'
          ? execution.message
          : 'This request previously failed. Retry with a new clientRequestId.',
        code: 'REQUEST_ID_CONFLICT',
      },
      { status: 409 }
    );
  }
  executionIdentity = { userId: authResult.uid, clientRequestId };

  const failExecution = async (code: string, message: string, httpStatus: number) => {
    await failQueryExecution({ ...executionIdentity!, code, message, httpStatus });
    executionIdentity = null;
  };

  const rateLimit = await consumeRateLimit({
    bucketId: `endpoint:/api/generate-queries:user:${authResult.uid}`,
    limit: 12,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    await failExecution('RATE_LIMITED', 'Too many query-generation requests.', 429);
    return NextResponse.json(
      {
        success: false,
        error: 'Too many query-generation requests. Please retry shortly.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  const providerManager = new ProviderManager(authResult.openRouterApiKey);
  const availableProviders = new Set(providerManager.getAvailableProviders());
  const providers = PREFERRED_PROVIDERS.filter((provider) => availableProviders.has(provider));
  if (providers.length === 0) {
    await failExecution('NO_PROVIDERS_CONFIGURED', 'No query-generation provider is configured', 503);
    return NextResponse.json(
      { success: false, error: 'No query-generation provider is configured', code: 'NO_PROVIDERS_CONFIGURED' },
      { status: 503 }
    );
  }

  try {
    userCredits = await deductUserCreditsServer(authResult.uid, QUERY_GENERATION_CREDIT_COST, {
      idempotencyKey: `query-generation:${authResult.uid}:${clientRequestId}:${fingerprint}:debit`,
      reason: 'query generation credit reservation',
      executionRequestId: execution.docId,
      metadata: { companyName: company.companyName },
    });
    creditReservation = {
      userId: authResult.uid,
      clientRequestId,
      fingerprint,
      executionRequestId: execution.docId,
    };
  } catch (creditError) {
    const insufficient = creditError instanceof Error && creditError.message === 'INSUFFICIENT_CREDITS';
    const code = insufficient ? 'INSUFFICIENT_CREDITS' : 'CREDIT_DEDUCTION_FAILED';
    const message = insufficient ? 'Insufficient credits' : 'Failed to reserve credits';
    await failExecution(code, message, insufficient ? 402 : 500);
    return NextResponse.json({
      success: false,
      error: message,
      code,
      ...(insufficient && { requiredCredits: QUERY_GENERATION_CREDIT_COST }),
    }, { status: insufficient ? 402 : 500 });
  }

  const prompt = buildQueryGenerationPrompt(company);
  const apiRequest: APIRequest = {
    id: clientRequestId,
    prompt,
    providers,
    priority: 'medium',
    userId: authResult.uid,
    metadata: {
      type: 'query-generation',
      webSearch: false,
      temperature: 0.2,
      maxTokens: 4_000,
    },
    createdAt: new Date(),
  };

  const result = await providerManager.executeRequest(apiRequest);
  let generatedQueries = null;
  let sourceProvider = '';

  for (const providerResult of result.results) {
    if (providerResult.status !== 'success') continue;
    const candidate = normalizeGeneratedQueries(
      parseQueryGenerationResponse(providerResult.data?.content),
      company.companyName,
      company.keywords
    );
    if (candidate) {
      generatedQueries = candidate;
      sourceProvider = providerResult.providerId;
      break;
    }
  }

  if (!generatedQueries) {
    const anyProviderSucceeded = result.results.some((providerResult) => providerResult.status === 'success');
    const refundApplied = await refundReservation(
      anyProviderSucceeded ? 'invalid provider response' : 'all providers failed'
    );
    const baseCode = anyProviderSucceeded ? 'INVALID_PROVIDER_RESPONSE' : 'ALL_PROVIDERS_FAILED';
    const code = refundApplied ? baseCode : `${baseCode}_REFUND_FAILED`;
    await failExecution(code, 'AI providers did not return valid search queries.', refundApplied ? 502 : 500);
    return NextResponse.json(
      {
        success: false,
        error: refundApplied
          ? 'AI providers did not return valid search queries. Reserved credits were refunded.'
          : 'Query generation failed and the automatic credit refund also failed.',
        code,
        refundApplied,
      },
      { status: refundApplied ? 502 : 500 }
    );
  }

  const responsePayload = {
    success: true,
    requestId: result.requestId,
    data: generatedQueries,
    sourceProvider,
    totalCost: result.totalCost,
    completedAt: result.completedAt,
    userCredits: userCredits!,
  };
  await completeQueryExecution({
    userId: authResult.uid,
    clientRequestId,
    replayResponse: responsePayload,
  });
  creditReservation = null;
  executionIdentity = null;
  return NextResponse.json(responsePayload);
  } catch (error) {
    const refundApplied = creditReservation
      ? await refundReservation('unhandled query-generation error')
      : false;
    if (executionIdentity) {
      await failQueryExecution({
        ...executionIdentity,
        code: 'QUERY_GENERATION_FAILED',
        message: 'Query generation failed',
        httpStatus: 500,
      }).catch(() => undefined);
    }
    logger.error('Query generation failed', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR', refundApplied },
      { status: 500 }
    );
  }
}
