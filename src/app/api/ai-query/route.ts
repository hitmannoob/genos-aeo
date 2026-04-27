import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { APIRequest } from '@/lib/api-providers/types';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { z } from 'zod';
import {
  deductUserCreditsServer,
  GENERIC_AI_QUERY_CREDIT_COST,
  requireSufficientCreditsServer,
} from '@/lib/billing/serverCredits';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';

const providerManager = new ProviderManager();

const AllowedProviderSchema = z.enum([
  'chatgptsearch',
  'google-gemini',
  'google-ai-overview',
  'perplexity',
]);

const AIQueryRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(20000),
  providers: z.array(AllowedProviderSchema).max(4).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  clientRequestId: z.string().trim().min(1).max(160).optional(),
});

const DEFAULT_AI_QUERY_PROVIDERS: APIRequest['providers'] = [
  'chatgptsearch',
  'google-gemini',
];

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsedInput = AIQueryRequestSchema.safeParse(body);
    if (!parsedInput.success) {
      return NextResponse.json(
        { error: 'Invalid AI query request' },
        { status: 400 }
      );
    }

    const { prompt, priority = 'medium' } = parsedInput.data;
    const providers = parsedInput.data.providers && parsedInput.data.providers.length > 0
      ? parsedInput.data.providers
      : DEFAULT_AI_QUERY_PROVIDERS;

    const rateLimit = await consumeRateLimit({
      bucketId: `endpoint:/api/ai-query:user:${authResult.uid}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many AI query requests. Please retry shortly.',
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

    try {
      await requireSufficientCreditsServer(authResult.uid, GENERIC_AI_QUERY_CREDIT_COST);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient credits',
          code: 'INSUFFICIENT_CREDITS',
          requiredCredits: GENERIC_AI_QUERY_CREDIT_COST,
        },
        { status: 402 }
      );
    }

    // Create API request
    const apiRequest: APIRequest = {
      id: parsedInput.data.clientRequestId || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      prompt,
      providers,
      priority,
      userId: authResult.uid,
      metadata: {
        userAgent: request.headers.get('user-agent'),
        timestamp: new Date().toISOString(),
        type: 'generic-ai-query',
      },
      createdAt: new Date(),
    };

    console.log('📝 Created API Request:', {
      id: apiRequest.id,
      providers: apiRequest.providers,
      priority: apiRequest.priority
    });

    // Execute request across providers
    console.log('⚡ Executing request across providers...');
    const result = await providerManager.executeRequest(apiRequest);
    const successfulResults = result.results?.filter((providerResult) => providerResult.status === 'success') || [];

    if (successfulResults.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'All AI providers failed. No credits were deducted.',
          code: 'ALL_PROVIDERS_FAILED',
          results: result.results,
        },
        { status: 502 }
      );
    }

    let userCredits;
    try {
      userCredits = await deductUserCreditsServer(authResult.uid, GENERIC_AI_QUERY_CREDIT_COST, {
        idempotencyKey: parsedInput.data.clientRequestId
          ? `generic-ai-query:${parsedInput.data.clientRequestId}:debit`
          : undefined,
        reason: 'generic AI query provider execution',
        metadata: {
          prompt,
          providers,
          requestId: apiRequest.id,
        },
      });
    } catch (creditError) {
      const message = creditError instanceof Error ? creditError.message : String(creditError);
      return NextResponse.json(
        {
          success: false,
          error: message === 'INSUFFICIENT_CREDITS'
            ? 'Insufficient credits'
            : 'Failed to deduct credits',
          code: message === 'INSUFFICIENT_CREDITS'
            ? 'INSUFFICIENT_CREDITS'
            : 'CREDIT_DEDUCTION_FAILED',
          requiredCredits: GENERIC_AI_QUERY_CREDIT_COST,
        },
        { status: message === 'INSUFFICIENT_CREDITS' ? 402 : 500 }
      );
    }

    console.log('✅ AI Query API Response:', {
      requestId: result.requestId,
      resultsCount: result.results?.length || 0,
      totalCost: result.totalCost,
      aggregatedDataKeys: Object.keys(result.aggregatedData || {}),
      completedAt: result.completedAt
    });

    return NextResponse.json({
      success: true,
      requestId: result.requestId,
      data: result.aggregatedData,
      results: result.results,
      totalCost: result.totalCost,
      completedAt: result.completedAt,
      userCredits,
      debug: {
        providersExecuted: result.results?.map(r => r.providerId) || [],
      }
    });

  } catch (error) {
    console.error('API Query Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
