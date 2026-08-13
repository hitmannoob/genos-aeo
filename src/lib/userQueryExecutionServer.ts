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
import { logger } from '@/lib/logger';

const REQUIRED_CREDITS = USER_QUERY_CREDIT_COST;
const PREFERRED_PROVIDERS = ['chatgptsearch', 'google-ai-overview', 'perplexity'];

export interface ExecuteUserQueryServerArgs {
  userId: string;
  openRouterApiKey?: string;
  query: string;
  persistResult?: boolean;
  brandId?: string;
  keyword?: string;
  category?: string;
  processingSessionId?: string;
  processingSessionTimestamp?: string;
  clientRequestId: string;
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
  openRouterApiKey?: string;
  query: string;
  brandId: string;
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
    openRouterApiKey,
    query,
    persistResult = false,
    brandId,
    keyword,
    category,
    processingSessionId,
    processingSessionTimestamp,
    clientRequestId,
    skipBilling = false,
  } = args;

  const executionIdentity = {
    userId,
    brandId,
    clientRequestId,
  };
  let reservedExecutionRequestId: string | null = null;
  let creditsBefore = 0;

  const refundReservedCredits = async (failureReason: string): Promise<boolean> => {
    if (skipBilling || !reservedExecutionRequestId) return true;
    try {
      await refundUserCreditsServer(userId, REQUIRED_CREDITS, {
        idempotencyKey: `user-query:${brandId || 'no-brand'}:${clientRequestId}:refund`,
        reason: 'user query failure refund',
        executionRequestId: reservedExecutionRequestId,
        metadata: {
          query,
          brandId,
          processingSessionId,
          processingSessionTimestamp,
          failureReason,
        },
      });
      reservedExecutionRequestId = null;
      return true;
    } catch (refundError) {
      logger.error('Failed to refund reserved query credits', refundError);
      return false;
    }
  };

  const failExecution = async (
    code: string,
    message: string,
    httpStatus: number,
    refundApplied?: boolean
  ) => {
    try {
      await failQueryExecution({
        ...executionIdentity,
        code,
        message,
        httpStatus,
        refundApplied,
      });
    } catch (ledgerError) {
      logger.error('Failed to update query execution ledger', ledgerError);
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

    const acquireResult = await acquireQueryExecution<UserQueryWorkflowResult>({
      ...executionIdentity,
      requestFingerprintSource: {
        query,
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

    if (acquireResult.status === 'previous_failure') {
      return nowError({
        code: 'REQUEST_PREVIOUSLY_FAILED',
        error: acquireResult.failure.message,
        message: `Previous failure code: ${acquireResult.failure.code}. Start a new attempt with a new clientRequestId.`,
        httpStatus: 409,
        refundApplied: acquireResult.failure.refundApplied,
        totalTime: Date.now() - startTime,
      });
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

    const providerManager = new ProviderManager(openRouterApiKey);
    const availableProviders = new Set(providerManager.getAvailableProviders());
    const selectedProviders = PREFERRED_PROVIDERS.filter((provider) => availableProviders.has(provider));

    if (selectedProviders.length === 0) {
      await failExecution('NO_PROVIDERS_CONFIGURED', 'No AI providers are configured.', 503);
      return nowError({
        code: 'NO_PROVIDERS_CONFIGURED',
        error: 'An OpenRouter API key is required to run AI provider requests.',
        httpStatus: 503,
        totalTime: Date.now() - startTime,
      });
    }

    creditsBefore = availableCredits;
    if (!skipBilling) {
      try {
        const creditResult = await deductUserCreditsServer(userId, REQUIRED_CREDITS, {
          idempotencyKey: `user-query:${brandId || 'no-brand'}:${clientRequestId}:debit`,
          reason: 'user query credit reservation',
          executionRequestId: acquireResult.docId,
          metadata: {
            query,
            brandId,
            processingSessionId,
            processingSessionTimestamp,
          },
        });
        creditsBefore = creditResult.before;
        reservedExecutionRequestId = acquireResult.docId;
      } catch (creditError) {
        const insufficient = creditError instanceof Error
          && creditError.message === 'INSUFFICIENT_CREDITS';
        const code = insufficient ? 'INSUFFICIENT_CREDITS' : 'CREDIT_DEDUCTION_FAILED';
        const message = insufficient
          ? `Insufficient credits. Required: ${REQUIRED_CREDITS}.`
          : 'Failed to reserve credits. Please try again.';
        await failExecution(code, message, insufficient ? 402 : 500);
        return nowError({
          code,
          error: message,
          httpStatus: insufficient ? 402 : 500,
          requiredCredits: REQUIRED_CREDITS,
          totalTime: Date.now() - startTime,
        });
      }
    }

    const jobResult = await providerManager.executeRequest({
      id: clientRequestId,
      prompt: query,
      providers: selectedProviders,
      userId,
      priority: 'high',
      createdAt: new Date(),
      metadata: {
        type: 'user-query',
        creditsDeducted: skipBilling ? 0 : REQUIRED_CREDITS,
      },
    });

    const anySuccess = jobResult.results.some((result) => result.status === 'success');
    if (!anySuccess) {
      const refundApplied = !skipBilling && reservedExecutionRequestId !== null
        && await refundReservedCredits('all providers failed');
      const refundSucceeded = skipBilling || refundApplied;
      const code = refundSucceeded
        ? 'ALL_PROVIDERS_FAILED'
        : 'ALL_PROVIDERS_FAILED_REFUND_FAILED';
      const message = refundSucceeded
        ? (skipBilling
            ? 'All AI providers failed. No credits were charged.'
            : 'All AI providers failed. Reserved credits were refunded.')
        : 'All AI providers failed and the automatic credit refund also failed.';
      await failExecution(code, message, refundSucceeded ? 502 : 500, refundApplied);
      return nowError({
        code,
        error: message,
        httpStatus: refundSucceeded ? 502 : 500,
        refundApplied,
        results: jobResult.results.map((result) => ({
          providerId: result.providerId,
          status: result.status,
          error: 'Provider request failed',
        })),
        totalTime: Date.now() - startTime,
      });
    }

    const modalResults = serializeProviderResults(jobResult.results);
    const deductedAmount = skipBilling ? 0 : REQUIRED_CREDITS;

    const buildModalResult = (
      persistedQueryResult?: QueryProcessingResult
    ): ModalQueryResult => ({
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
      ...(persistedQueryResult && {
        persistence: {
          persisted: true,
          refundApplied: false,
        },
      }),
    });

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

        const persisted = await persistOneQueryResultSql<ModalQueryResult>({
          brandId,
          userId,
          query: {
            query,
            keyword,
            category,
          },
          processingSessionId,
          processingSessionTimestamp,
          userQueryResponse,
          executionRequestId: acquireResult.docId,
          buildExecutionReplayResponse: buildModalResult,
        });
        if (!persisted.executionReplayResponse) {
          throw new Error('EXECUTION_REPLAY_RESPONSE_MISSING');
        }
        reservedExecutionRequestId = null;
        return persisted.executionReplayResponse;
      } catch (persistError) {
        logger.error('Failed to persist query result', persistError);
        const refundApplied = !skipBilling && reservedExecutionRequestId !== null
          && await refundReservedCredits('query persistence failed');

        const code = skipBilling
          ? 'PERSISTENCE_FAILED'
          : refundApplied
            ? 'PERSISTENCE_FAILED_REFUNDED'
            : 'PERSISTENCE_FAILED_REFUND_FAILED';

        await failExecution(
          code,
          'Failed to persist query result',
          500,
          refundApplied
        );

        return nowError({
          code,
          error: 'Failed to persist query result',
          message: 'The provider response could not be saved. Please retry with a new clientRequestId.',
          httpStatus: 500,
          refundApplied,
          totalTime: Date.now() - startTime,
          userCredits: {
            before: creditsBefore,
            after: refundApplied ? creditsBefore : creditsBefore - deductedAmount,
            deducted: refundApplied ? 0 : deductedAmount,
          },
        });
      }
    }

    const modalResult = buildModalResult();
    await completeQueryExecution({
      ...executionIdentity,
      replayResponse: modalResult,
    });
    reservedExecutionRequestId = null;

    return modalResult;
  } catch (error) {
    logger.error('Unhandled user query workflow error', error);
    const refundApplied = !skipBilling && reservedExecutionRequestId !== null
      && await refundReservedCredits('unhandled workflow error');
    await failExecution(
      'UNHANDLED_USER_QUERY_ERROR',
      'Failed to process user query',
      500,
      refundApplied
    );

    return nowError({
      code: 'UNHANDLED_USER_QUERY_ERROR',
      error: 'Failed to process user query',
      message: 'An unexpected server error occurred while processing the query.',
      httpStatus: 500,
      refundApplied,
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
