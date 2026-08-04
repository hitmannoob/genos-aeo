import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { getAppUserProfileByUserId } from '@/lib/db/appUsers';
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
import type { APIResponse } from '@/lib/api-providers/types';
import { logger } from '@/lib/logger';

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
  persistedQueryResult?: QueryProcessingResult;
  persistence?: {
    persisted: boolean;
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
  retryAfterSeconds?: number;
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
}

export interface ExecutePersistedUserQueryServerResult {
  success: boolean;
  code?: string;
  error?: string;
  message?: string;
  totalTime: number;
  totalCost?: number;
  retryAfterSeconds?: number;
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
  } = args;

  const executionIdentity = {
    userId,
    brandId,
    clientRequestId,
  };
  const failExecution = async (
    code: string,
    message: string,
    httpStatus: number,
  ) => {
    try {
      await failQueryExecution({
        ...executionIdentity,
        code,
        message,
        httpStatus,
      });
    } catch (ledgerError) {
      logger.error('Failed to update query execution ledger', ledgerError);
    }
  };

  try {
    const profile = await getAppUserProfileByUserId(userId);
    if (!profile) {
      return nowError({
        code: 'LOCAL_PROFILE_REQUIRED',
        error: 'Local profile not found',
        httpStatus: 503,
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
        error: 'No OpenRouter API key is configured.',
        httpStatus: 503,
        totalTime: Date.now() - startTime,
      });
    }

    const jobResult = await providerManager.executeRequest({
      id: clientRequestId,
      prompt: query,
      providers: selectedProviders,
      userId,
      priority: 'high',
      createdAt: new Date(),
      metadata: { type: 'user-query' },
    });

    const anySuccess = jobResult.results.some((result) => result.status === 'success');
    if (!anySuccess) {
      const code = 'ALL_PROVIDERS_FAILED';
      const message = 'All AI providers failed.';
      await failExecution(code, message, 502);
      return nowError({
        code,
        error: message,
        httpStatus: 502,
        results: jobResult.results.map((result) => ({
          providerId: result.providerId,
          status: result.status,
          error: 'Provider request failed',
        })),
        totalTime: Date.now() - startTime,
      });
    }

    const modalResults = serializeProviderResults(jobResult.results);
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
      ...(persistedQueryResult && { persistedQueryResult }),
      ...(persistedQueryResult && {
        persistence: {
          persisted: true,
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
        return persisted.executionReplayResponse;
      } catch (persistError) {
        logger.error('Failed to persist query result', persistError);
        const code = 'PERSISTENCE_FAILED';

        await failExecution(
          code,
          'Failed to persist query result',
          500
        );

        return nowError({
          code,
          error: 'Failed to persist query result',
          message: 'The provider response could not be saved. Please retry with a new clientRequestId.',
          httpStatus: 500,
          totalTime: Date.now() - startTime,
        });
      }
    }

    const modalResult = buildModalResult();
    await completeQueryExecution({
      ...executionIdentity,
      replayResponse: modalResult,
    });
    return modalResult;
  } catch (error) {
    logger.error('Unhandled user query workflow error', error);
    await failExecution(
      'UNHANDLED_USER_QUERY_ERROR',
      'Failed to process user query',
      500
    );

    return nowError({
      code: 'UNHANDLED_USER_QUERY_ERROR',
      error: 'Failed to process user query',
      message: 'An unexpected server error occurred while processing the query.',
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
  };
}
