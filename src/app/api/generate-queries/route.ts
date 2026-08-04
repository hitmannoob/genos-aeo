import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import type { APIRequest } from '@/lib/api-providers/types';
import { authenticateApiRequest } from '@/lib/serverAuth';
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

const PREFERRED_PROVIDERS = ['chatgptsearch', 'google-ai-overview'];

export async function POST(request: NextRequest) {
  let executionIdentity: { userId: string; clientRequestId: string } | null = null;
  try {
  const authResult = await authenticateApiRequest(request);
  if (!authResult) {
    return NextResponse.json({ success: false, error: 'Local profile unavailable' }, { status: 503 });
  }
  const providerManager = new ProviderManager(authResult.openRouterApiKey || undefined);

  const body = await request.json().catch(() => null);
  const parsedInput = QueryGenerationInputSchema.safeParse(body);
  if (!parsedInput.success || parsedInput.data.company.keywords.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Valid company information with at least one keyword is required' },
      { status: 400 }
    );
  }

  const { clientRequestId, company } = parsedInput.data;
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

  const availableProviders = new Set(providerManager.getAvailableProviders());
  const providers = PREFERRED_PROVIDERS.filter((provider) => availableProviders.has(provider));
  if (providers.length === 0) {
    await failExecution('NO_PROVIDERS_CONFIGURED', 'No query-generation provider is configured', 503);
    return NextResponse.json(
      { success: false, error: 'No query-generation provider is configured', code: 'NO_PROVIDERS_CONFIGURED' },
      { status: 503 }
    );
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
    const baseCode = anyProviderSucceeded ? 'INVALID_PROVIDER_RESPONSE' : 'ALL_PROVIDERS_FAILED';
    await failExecution(baseCode, 'AI providers did not return valid search queries.', 502);
    return NextResponse.json(
      {
        success: false,
        error: 'AI providers did not return valid search queries.',
        code: baseCode,
      },
      { status: 502 }
    );
  }

  const responsePayload = {
    success: true,
    requestId: result.requestId,
    data: generatedQueries,
    sourceProvider,
    totalCost: result.totalCost,
    completedAt: result.completedAt,
  };
  await completeQueryExecution({
    userId: authResult.uid,
    clientRequestId,
    replayResponse: responsePayload,
  });
  executionIdentity = null;
  return NextResponse.json(responsePayload);
  } catch (error) {
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
      { success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
