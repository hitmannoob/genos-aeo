import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { APIRequest } from '@/lib/api-providers/types';
import { getDomainMetadata } from '@/lib/domain-metadata';
import { CompanyInfoInputSchema, type CompanyInfo } from '@/lib/get-company-info';
import { authenticateApiRequest } from '@/lib/serverAuth';
import {
  DomainValidationError,
  normalizePublicDomain,
} from '@/lib/domainValidation';
import {
  COMPANY_INFO_CREDIT_COST,
  deductUserCreditsServer,
  refundUserCreditsServer,
} from '@/lib/billing/serverCredits';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';
import {
  acquireQueryExecution,
  completeQueryExecution,
  failQueryExecution,
} from '@/lib/db/queryExecution';
import { buildCompanyInfoPrompt, parseCompanyInfoResponse } from '@/lib/prompts/companyInfo';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  let executionIdentity: { userId: string; clientRequestId: string } | null = null;
  let creditReservation: {
    userId: string;
    domain: string;
    clientRequestId: string;
    executionRequestId: string;
  } | null = null;
  let userCredits: Awaited<ReturnType<typeof deductUserCreditsServer>> | null = null;

  const refundReservation = async (failureReason: string): Promise<boolean> => {
    if (!creditReservation) return true;
    const reservation = creditReservation;
    try {
      await refundUserCreditsServer(reservation.userId, COMPANY_INFO_CREDIT_COST, {
        idempotencyKey: `companyinfo:${reservation.userId}:${reservation.domain}:${reservation.clientRequestId}:refund`,
        reason: 'company info failure refund',
        executionRequestId: reservation.executionRequestId,
        metadata: { domain: reservation.domain, failureReason },
      });
      creditReservation = null;
      return true;
    } catch (refundError) {
      logger.error('Failed to refund company-info credit reservation', refundError);
      return false;
    }
  };

  try {
    const authResult = await authenticateApiRequest(request);
    if (!authResult) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }
    if (!authResult.openRouterApiKey) {
      return NextResponse.json(
        { success: false, error: 'Add an OpenRouter API key to continue', code: 'OPENROUTER_KEY_REQUIRED' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsedInput = CompanyInfoInputSchema.safeParse(body);
    if (!parsedInput.success) {
      return NextResponse.json(
        { success: false, error: 'A valid domain is required' },
        { status: 400 }
      );
    }

    const domain = normalizePublicDomain(parsedInput.data.domain);
    const clientRequestId = parsedInput.data.clientRequestId;

    const execution = await acquireQueryExecution<Record<string, unknown>>({
      userId: authResult.uid,
      clientRequestId,
      requestFingerprintSource: {
        query: domain,
        keyword: 'company-info',
      },
    });
    if (execution.status === 'replay') {
      return NextResponse.json(execution.response);
    }
    if (execution.status === 'in_progress') {
      return NextResponse.json(
        {
          success: false,
          error: 'This company lookup is already in progress.',
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
      await failQueryExecution({
        ...executionIdentity!,
        code,
        message,
        httpStatus,
      });
      executionIdentity = null;
    };

    const rateLimit = await consumeRateLimit({
      bucketId: `endpoint:/api/get-company-info:user:${authResult.uid}`,
      limit: 12,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      await failExecution('RATE_LIMITED', 'Too many company-info requests.', 429);
      return NextResponse.json(
        {
          success: false,
          error: 'Too many company-info requests. Please retry shortly.',
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

    // Step 1: Fetch actual website metadata first
    let websiteMetadata = null;
    try {
      websiteMetadata = await getDomainMetadata({ domain });
    } catch (error) {
      if (error instanceof DomainValidationError) throw error;
    }
    
    // Step 2: Generate enhanced prompt with website data
    const prompt = buildCompanyInfoPrompt(domain, websiteMetadata || undefined);
    
    // Initialize provider manager
    const providerManager = new ProviderManager(authResult.openRouterApiKey);
    
    const preferredProviders = [
      'chatgptsearch',
      'perplexity',
      ...(websiteMetadata ? ['google-ai-overview'] : []),
    ];
    const availableProviders = new Set(providerManager.getAvailableProviders());
    const providers = preferredProviders.filter((provider) => availableProviders.has(provider));
    if (providers.length === 0) {
      await failExecution('NO_PROVIDERS_CONFIGURED', 'No company-research provider is configured', 503);
      return NextResponse.json(
        { success: false, error: 'No company-research provider is configured', code: 'NO_PROVIDERS_CONFIGURED' },
        { status: 503 }
      );
    }

    try {
      userCredits = await deductUserCreditsServer(authResult.uid, COMPANY_INFO_CREDIT_COST, {
        idempotencyKey: `companyinfo:${authResult.uid}:${domain}:${clientRequestId}:debit`,
        reason: 'company info credit reservation',
        executionRequestId: execution.docId,
        metadata: { domain },
      });
      creditReservation = {
        userId: authResult.uid,
        domain,
        clientRequestId,
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
        ...(insufficient && { requiredCredits: COMPANY_INFO_CREDIT_COST }),
      }, { status: insufficient ? 402 : 500 });
    }

    const apiRequest: APIRequest = {
      id: clientRequestId,
      prompt: prompt,
      providers,
      priority: 'medium',
      userId: authResult.uid,
      createdAt: new Date(),
      metadata: {
        domain: domain,
        type: 'company-info',
        temperature: 0.2,
        maxTokens: 2_500,
      }
    };

    // Execute the request
    const result = await providerManager.executeRequest(apiRequest);

    // Try successful providers in priority order, but only accept output that
    // satisfies the public company-info contract.
    const successfulResults = result.results.filter(r => r.status === 'success');
    
    if (successfulResults.length === 0) {
      const refundApplied = await refundReservation('all providers failed');
      const code = refundApplied ? 'ALL_PROVIDERS_FAILED' : 'ALL_PROVIDERS_FAILED_REFUND_FAILED';
      await failExecution(code, 'All AI providers failed to analyze the domain.', refundApplied ? 502 : 500);
      return NextResponse.json(
        {
          success: false,
          error: refundApplied
            ? 'All AI providers failed to analyze the domain. Reserved credits were refunded.'
            : 'All AI providers failed and the automatic credit refund also failed.',
          code,
          refundApplied,
        },
        { status: refundApplied ? 502 : 500 }
      );
    }

    const website = websiteMetadata?.url || `https://${domain}`;
    let selected: { result: (typeof successfulResults)[number]; companyInfo: CompanyInfo } | null = null;
    for (const providerResult of successfulResults) {
      if (typeof providerResult.data?.content !== 'string') continue;
      const companyInfo = parseCompanyInfoResponse(providerResult.data.content, website);
      if (companyInfo) {
        selected = { result: providerResult, companyInfo };
        break;
      }
    }

    if (!selected) {
      const refundApplied = await refundReservation('invalid provider response');
      const code = refundApplied ? 'INVALID_PROVIDER_RESPONSE' : 'INVALID_PROVIDER_RESPONSE_REFUND_FAILED';
      await failExecution(code, 'AI providers returned invalid company information.', refundApplied ? 502 : 500);
      return NextResponse.json(
        {
          success: false,
          error: refundApplied
            ? 'AI providers returned invalid company information. Reserved credits were refunded.'
            : 'AI providers returned invalid data and the automatic credit refund also failed.',
          code,
          refundApplied,
        },
        { status: refundApplied ? 502 : 500 }
      );
    }

    const primaryResult = selected.result;
    const companyInfo = selected.companyInfo;
    
    const responsePayload = {
      success: true,
      data: companyInfo,
      metadata: {
        timestamp: new Date().toISOString(),
        source: primaryResult.providerId,
        responseTime: primaryResult.responseTime,
        cost: primaryResult.cost,
        totalProviderCost: result.totalCost,
        userCredits: userCredits!,
        websiteMetadata: websiteMetadata ? {
          title: websiteMetadata.title,
          description: websiteMetadata.description,
          siteName: websiteMetadata.siteName,
          hasRealData: true
        } : { hasRealData: false },
        providersUsed: result.results.map(r => ({
          provider: r.providerId,
          status: r.status,
          responseTime: r.responseTime
        }))
      }
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
      ? await refundReservation('unhandled company-info error')
      : false;
    if (executionIdentity) {
      await failQueryExecution({
        ...executionIdentity,
        code: 'COMPANY_INFO_FAILED',
        message: error instanceof DomainValidationError ? error.message : 'Company info lookup failed',
        httpStatus: error instanceof DomainValidationError ? 400 : 500,
      }).catch(() => undefined);
    }
    if (error instanceof DomainValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 }
      );
    }

    logger.error('Company info API error', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        refundApplied,
      },
      { status: 500 }
    );
  }
} 
