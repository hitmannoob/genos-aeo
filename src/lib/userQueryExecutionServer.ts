import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { getAppUserProfileByFirebaseUid } from '@/lib/db/appUsers';
import { persistOneQueryResultSql } from '@/lib/db/queryResults';
import {
  acquireQueryExecution,
  completeQueryExecution,
  failQueryExecution,
} from '@/lib/db/queryExecution';
import type {
  QueryProcessingResult,
  UserQueryApiResponse,
} from '@/lib/queryResultUtils';
import {
  deductUserCreditsServer,
  refundUserCreditsServer,
  USER_QUERY_CREDIT_COST,
} from '@/lib/billing/serverCredits';
import type { APIResponse } from '@/lib/api-providers/types';

const REQUIRED_CREDITS = USER_QUERY_CREDIT_COST;
const PREFERRED_PROVIDERS = ['chatgptsearch', 'google-ai-overview', 'perplexity'];

export interface ExecuteUserQueryServerArgs {
  userId: string;
  query: string;
  context?: string;
  persistResult?: boolean;
  brandId?: string;
  brandName?: string;
  brandDomain?: string;
  keyword?: string;
  category?: string;
  processingSessionId?: string;
  processingSessionTimestamp?: string;
  clientRequestId?: string;
  skipBilling?: boolean;
}

export interface ProviderResult {
  providerId: string;
  status: 'success' | 'error';
  data?: any;
  error?: string;
  responseTime: number;
  cost: number;
  timestamp: string;
}

export interface ModalQueryResult {
  success: true;
  query: string;
  totalResults: number;
  successfulResults: number;
  totalCost: number;
  totalTime: number;
  results: ProviderResult[];
  summary: {
    chatgptSearch?: {
      content: string;
      webSearchUsed: boolean;
      citations: number;
      responseTime: number;
    };
    googleAiOverview?: {
      totalItems: number;
      peopleAlsoAskCount: number;
      organicResultsCount: number;
      location: string;
      responseTime: number;
    };
    perplexity?: {
      content: string;
      citations: number;
      realTimeData: boolean;
      responseTime: number;
    };
  };
  timestamp: string;
  userCredits: {
    before: number;
    after: number;
    deducted: number;
  };
  persistedQueryResult?: QueryProcessingResult;
  persistence?: {
    persisted: boolean;
    refundApplied: boolean;
  };
}

export interface UserQueryWorkflowError {
  success: false;
  code: string;
  error: string;
  message?: string;
  httpStatus: number;
  totalTime: number;
  timestamp: string;
  results?: Array<{
    providerId: string;
    status: string;
    error?: string;
  }>;
  requiredCredits?: number;
  availableCredits?: number;
  retryAfterSeconds?: number;
  refundApplied?: boolean;
  refundError?: string;
  userCredits?: {
    before: number;
    after: number;
    deducted: number;
  };
}

export type UserQueryWorkflowResult = ModalQueryResult | UserQueryWorkflowError;

export interface ExecutePersistedUserQueryServerArgs {
  userId: string;
  query: string;
  context?: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  keyword?: string;
  category?: string;
  processingSessionId: string;
  processingSessionTimestamp: string;
  clientRequestId: string;
  skipBilling?: boolean;
}

export interface ExecutePersistedUserQueryServerResult {
  success: boolean;
  code?: string;
  error?: string;
  message?: string;
  totalTime: number;
  totalCost?: number;
  retryAfterSeconds?: number;
  userCredits?: {
    before: number;
    after: number;
    deducted: number;
  };
  persistedQueryResult?: QueryProcessingResult;
}

function nowError(args: Omit<UserQueryWorkflowError, 'success' | 'timestamp'>): UserQueryWorkflowError {
  return {
    success: false,
    timestamp: new Date().toISOString(),
    ...args,
  };
}

function buildReplayModalResult(modalResult: ModalQueryResult): ModalQueryResult {
  return {
    ...modalResult,
    results: modalResult.results.map((result) => ({
      providerId: result.providerId,
      status: result.status,
      error: result.error,
      responseTime: result.responseTime,
      cost: result.cost,
      timestamp: result.timestamp,
    })),
  };
}

function serializeProviderResults(results: APIResponse[]): ProviderResult[] {
  return results.map((result) => ({
    providerId: result.providerId,
    status: result.status === 'success' || result.status === 'error' ? result.status : 'error',
    data: result.data,
    error: result.error,
    responseTime: result.responseTime,
    cost: result.cost,
    timestamp: result.timestamp instanceof Date
      ? result.timestamp.toISOString()
      : new Date(result.timestamp).toISOString(),
  }));
}

function buildSummary(results: APIResponse[]): ModalQueryResult['summary'] {
  const summary: ModalQueryResult['summary'] = {};

  results.forEach((result) => {
    if (result.status !== 'success' || !result.data) {
      return;
    }

    switch (result.providerId) {
      case 'chatgptsearch':
        summary.chatgptSearch = {
          content: result.data.content || '',
          webSearchUsed: result.data.webSearchUsed || false,
          citations: result.data.annotations?.length || 0,
          responseTime: result.responseTime,
        };
        break;
      case 'google-ai-overview':
        summary.googleAiOverview = {
          totalItems: result.data.totalItems || 0,
          peopleAlsoAskCount: result.data.peopleAlsoAskCount || 0,
          organicResultsCount: result.data.organicResultsCount || 0,
          location: result.data.location || 'Unknown',
          responseTime: result.responseTime,
        };
        break;
      case 'perplexity':
        summary.perplexity = {
          content: result.data.content || '',
          citations: result.data.citations?.length || 0,
          realTimeData: result.data.realTimeData || false,
          responseTime: result.responseTime,
        };
        break;
    }
  });

  return summary;
}

export async function executeUserQueryServer(
  args: ExecuteUserQueryServerArgs
): Promise<UserQueryWorkflowResult> {
  const startTime = Date.now();
  const {
    userId,
    query,
    context,
    persistResult = false,
    brandId,
    brandName,
    brandDomain,
    keyword,
    category,
    processingSessionId,
    processingSessionTimestamp,
    clientRequestId,
    skipBilling = false,
  } = args;

  const executionIdentity = clientRequestId
    ? {
        userId,
        brandId,
        clientRequestId,
      }
    : null;

  const failExecution = async (
    code: string,
    message: string,
    httpStatus: number,
    refundApplied?: boolean
  ) => {
    if (!executionIdentity) return;

    try {
      await failQueryExecution({
        ...executionIdentity,
        code,
        message,
        httpStatus,
        refundApplied,
      });
    } catch (ledgerError) {
      console.error('❌ Failed to update query execution ledger:', ledgerError);
    }
  };

  try {
    const profile = await getAppUserProfileByFirebaseUid(userId);
    if (!profile) {
      return nowError({
        code: 'AUTHENTICATION_REQUIRED',
        error: 'User profile not found',
        httpStatus: 401,
        totalTime: Date.now() - startTime,
      });
    }

    if (executionIdentity) {
      const acquireResult = await acquireQueryExecution<UserQueryWorkflowResult>({
        ...executionIdentity,
        requestFingerprintSource: {
          query,
          context,
          persistResult,
          brandId,
          keyword,
          category,
          processingSessionId,
          processingSessionTimestamp,
        },
      });

      if (acquireResult.status === 'replay') {
        return acquireResult.response;
      }

      if (acquireResult.status === 'in_progress') {
        return nowError({
          code: 'REQUEST_IN_PROGRESS',
          error: 'This request is already being processed.',
          httpStatus: 409,
          retryAfterSeconds: acquireResult.retryAfterSeconds,
          totalTime: Date.now() - startTime,
        });
      }

      if (acquireResult.status === 'conflict') {
        return nowError({
          code: 'IDEMPOTENCY_KEY_REUSED',
          error: acquireResult.message,
          httpStatus: 409,
          totalTime: Date.now() - startTime,
        });
      }
    }

    const availableCredits = Number(profile.credits ?? 0);
    if (!skipBilling && availableCredits < REQUIRED_CREDITS) {
      await failExecution(
        'INSUFFICIENT_CREDITS',
        `Insufficient credits. Required: ${REQUIRED_CREDITS}, Available: ${availableCredits}`,
        402
      );
      return nowError({
        code: 'INSUFFICIENT_CREDITS',
        error: `Insufficient credits. Required: ${REQUIRED_CREDITS}, Available: ${availableCredits}`,
        httpStatus: 402,
        requiredCredits: REQUIRED_CREDITS,
        availableCredits,
        totalTime: Date.now() - startTime,
      });
    }

    const providerManager = new ProviderManager();
    const availableProviders = new Set(providerManager.getAvailableProviders());
    const selectedProviders = PREFERRED_PROVIDERS.filter((provider) => availableProviders.has(provider));

    if (selectedProviders.length === 0) {
      await failExecution('NO_PROVIDERS_CONFIGURED', 'No AI providers are configured.', 503);
      return nowError({
        code: 'NO_PROVIDERS_CONFIGURED',
        error: 'No AI providers are configured. Set at least one of OPENAI_API_KEY, PERPLEXITY_API_KEY, or DATAFORSEO_USERNAME+DATAFORSEO_PASSWORD.',
        httpStatus: 503,
        totalTime: Date.now() - startTime,
      });
    }

    const jobResult = await providerManager.executeRequest({
      id: clientRequestId || `user-query-${Date.now()}`,
      prompt: query,
      providers: selectedProviders,
      userId,
      priority: 'high',
      createdAt: new Date(),
      metadata: {
        context,
        type: 'user-query',
        creditsDeducted: skipBilling ? 0 : REQUIRED_CREDITS,
      },
    });

    const anySuccess = jobResult.results.some((result) => result.status === 'success');
    if (!anySuccess) {
      await failExecution('ALL_PROVIDERS_FAILED', 'All AI providers failed. No credits were deducted.', 502);
      return nowError({
        code: 'ALL_PROVIDERS_FAILED',
        error: 'All AI providers failed. No credits were deducted.',
        httpStatus: 502,
        results: jobResult.results.map((result) => ({
          providerId: result.providerId,
          status: result.status,
          error: result.error,
        })),
        totalTime: Date.now() - startTime,
      });
    }

    let creditsBefore = availableCredits;
    if (!skipBilling) {
      try {
        const creditResult = await deductUserCreditsServer(userId, REQUIRED_CREDITS, {
          idempotencyKey: clientRequestId
            ? `user-query:${brandId || 'no-brand'}:${clientRequestId}:debit`
            : undefined,
          reason: 'user query provider execution',
          metadata: {
            query,
            brandId,
            processingSessionId,
            processingSessionTimestamp,
          },
        });
        creditsBefore = creditResult.before;
      } catch (creditError) {
        const message = creditError instanceof Error ? creditError.message : String(creditError);
        const code = message === 'INSUFFICIENT_CREDITS'
          ? 'INSUFFICIENT_CREDITS'
          : 'CREDIT_DEDUCTION_FAILED';
        await failExecution(
          code,
          code === 'INSUFFICIENT_CREDITS'
            ? `Insufficient credits. Required: ${REQUIRED_CREDITS}.`
            : 'Failed to deduct credits. Please try again.',
          code === 'INSUFFICIENT_CREDITS' ? 402 : 500
        );
        return nowError({
          code,
          error: code === 'INSUFFICIENT_CREDITS'
            ? `Insufficient credits. Required: ${REQUIRED_CREDITS}.`
            : 'Failed to deduct credits. Please try again.',
          httpStatus: code === 'INSUFFICIENT_CREDITS' ? 402 : 500,
          requiredCredits: REQUIRED_CREDITS,
          totalTime: Date.now() - startTime,
        });
      }
    }

    const modalResults = serializeProviderResults(jobResult.results);
    const deductedAmount = skipBilling ? 0 : REQUIRED_CREDITS;

    let persistedQueryResult: QueryProcessingResult | undefined;
    if (persistResult) {
      try {
        if (!brandId || !processingSessionId || !processingSessionTimestamp) {
          throw new Error('Persistence metadata is required');
        }

        const userQueryResponse: UserQueryApiResponse = {
          success: true,
          results: modalResults,
          userCredits: {
            before: creditsBefore,
            after: creditsBefore - deductedAmount,
            deducted: deductedAmount,
          },
          totalCost: jobResult.totalCost,
        };

        const persisted = await persistOneQueryResultSql({
          brandId,
          userId,
          companyName: brandName || 'Unknown',
          brandDomain: brandDomain || '',
          query: {
            query,
            keyword,
            category,
          },
          processingSessionId,
          processingSessionTimestamp,
          userQueryResponse,
        });

        persistedQueryResult = persisted.queryResult;
      } catch (persistError) {
        let refundApplied = false;
        let refundErrorMessage: string | undefined;

        if (!skipBilling) {
          try {
            await refundUserCreditsServer(userId, REQUIRED_CREDITS, {
              idempotencyKey: clientRequestId
                ? `user-query:${brandId || 'no-brand'}:${clientRequestId}:refund`
                : undefined,
              reason: 'user query persistence failure refund',
              metadata: {
                query,
                brandId,
                processingSessionId,
                processingSessionTimestamp,
              },
            });
            refundApplied = true;
          } catch (refundError) {
            refundErrorMessage = refundError instanceof Error
              ? refundError.message
              : String(refundError);
            console.error('❌ Failed to refund credits after persistence error:', refundError);
          }
        }

        const code = refundApplied
          ? 'PERSISTENCE_FAILED_REFUNDED'
          : (skipBilling ? 'PERSISTENCE_FAILED' : 'PERSISTENCE_FAILED_REFUND_FAILED');

        await failExecution(
          code,
          persistError instanceof Error ? persistError.message : 'Unknown persistence error',
          500,
          refundApplied
        );

        return nowError({
          code,
          error: 'Failed to persist query result',
          message: persistError instanceof Error ? persistError.message : 'Unknown persistence error',
          httpStatus: 500,
          refundApplied,
          refundError: refundErrorMessage,
          totalTime: Date.now() - startTime,
          userCredits: {
            before: creditsBefore,
            after: refundApplied ? creditsBefore : creditsBefore - deductedAmount,
            deducted: refundApplied ? 0 : deductedAmount,
          },
        });
      }
    }

    const modalResult: ModalQueryResult = {
      success: true,
      query,
      totalResults: jobResult.results.length,
      successfulResults: jobResult.results.filter((result) => result.status === 'success').length,
      totalCost: jobResult.totalCost,
      totalTime: Date.now() - startTime,
      results: modalResults,
      summary: buildSummary(jobResult.results),
      timestamp: new Date().toISOString(),
      userCredits: {
        before: creditsBefore,
        after: creditsBefore - deductedAmount,
        deducted: deductedAmount,
      },
      ...(persistedQueryResult && { persistedQueryResult }),
      ...(persistResult && {
        persistence: {
          persisted: true,
          refundApplied: false,
        },
      }),
    };

    if (executionIdentity) {
      try {
        await completeQueryExecution({
          ...executionIdentity,
          replayResponse: buildReplayModalResult(modalResult),
        });
      } catch (ledgerError) {
        console.error('❌ Failed to mark query execution completed:', ledgerError);
      }
    }

    return modalResult;
  } catch (error) {
    await failExecution(
      'UNHANDLED_USER_QUERY_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );

    return nowError({
      code: 'UNHANDLED_USER_QUERY_ERROR',
      error: 'Failed to process user query',
      message: error instanceof Error ? error.message : 'Unknown error',
      httpStatus: 500,
      totalTime: Date.now() - startTime,
    });
  }
}

export async function executePersistedUserQueryServer(
  args: ExecutePersistedUserQueryServerArgs
): Promise<ExecutePersistedUserQueryServerResult> {
  const result = await executeUserQueryServer({
    ...args,
    persistResult: true,
  });

  if (result.success) {
    return {
      success: true,
      totalTime: result.totalTime,
      totalCost: result.totalCost,
      userCredits: result.userCredits,
      persistedQueryResult: result.persistedQueryResult,
    };
  }

  return {
    success: false,
    code: result.code,
    error: result.error,
    message: result.message,
    totalTime: result.totalTime,
    retryAfterSeconds: result.retryAfterSeconds,
    userCredits: result.userCredits,
  };
}
