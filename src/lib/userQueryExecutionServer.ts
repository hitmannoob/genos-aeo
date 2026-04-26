import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { firestore, FieldValue } from '@/firebase/firebase-admin';
import { getUserProfileServer } from '@/firebase/firestore/userProfileServer';
import { persistOneQueryResultServer } from '@/firebase/firestore/persistQueryResultServer';
import {
  acquireQueryExecution,
  completeQueryExecution,
  failQueryExecution,
} from '@/firebase/firestore/queryExecutionLedger';
import type {
  QueryProcessingResult,
  UserQueryApiResponse,
} from '@/firebase/firestore/queryResultUtils';

const REQUIRED_CREDITS = 10;
const PREFERRED_PROVIDERS = ['chatgptsearch', 'google-ai-overview', 'perplexity'];

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

export async function executePersistedUserQueryServer(
  args: ExecutePersistedUserQueryServerArgs
): Promise<ExecutePersistedUserQueryServerResult> {
  const startTime = Date.now();
  const {
    userId,
    query,
    context,
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

  const executionIdentity = {
    userId,
    brandId,
    clientRequestId,
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
      console.error('❌ Failed to update query execution ledger:', ledgerError);
    }
  };

  try {
    const { result: profile, error: profileError } = await getUserProfileServer(userId);
    if (profileError || !profile) {
      return {
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        error: 'User profile not found',
        totalTime: Date.now() - startTime,
      };
    }

    const acquireResult = await acquireQueryExecution<ExecutePersistedUserQueryServerResult>({
      ...executionIdentity,
      requestFingerprintSource: {
        query,
        context,
        persistResult: true,
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
      return {
        success: false,
        code: 'REQUEST_IN_PROGRESS',
        error: 'This request is already being processed.',
        retryAfterSeconds: acquireResult.retryAfterSeconds,
        totalTime: Date.now() - startTime,
      };
    }

    if (acquireResult.status === 'conflict') {
      return {
        success: false,
        code: 'IDEMPOTENCY_KEY_REUSED',
        error: acquireResult.message,
        totalTime: Date.now() - startTime,
      };
    }

    if (!skipBilling && Number(profile.credits ?? 0) < REQUIRED_CREDITS) {
      await failExecution(
        'INSUFFICIENT_CREDITS',
        `Insufficient credits. Required: ${REQUIRED_CREDITS}, Available: ${profile.credits}`,
        402
      );
      return {
        success: false,
        code: 'INSUFFICIENT_CREDITS',
        error: `Insufficient credits. Required: ${REQUIRED_CREDITS}, Available: ${profile.credits}`,
        totalTime: Date.now() - startTime,
        userCredits: {
          before: Number(profile.credits ?? 0),
          after: Number(profile.credits ?? 0),
          deducted: 0,
        },
      };
    }

    const providerManager = new ProviderManager();
    const availableProviders = new Set(providerManager.getAvailableProviders());
    const selectedProviders = PREFERRED_PROVIDERS.filter((provider) => availableProviders.has(provider));

    if (selectedProviders.length === 0) {
      await failExecution(
        'NO_PROVIDERS_CONFIGURED',
        'No AI providers are configured.',
        503
      );
      return {
        success: false,
        code: 'NO_PROVIDERS_CONFIGURED',
        error: 'No AI providers are configured.',
        totalTime: Date.now() - startTime,
      };
    }

    const apiRequest = {
      id: clientRequestId,
      prompt: query,
      providers: selectedProviders,
      userId,
      priority: 'high' as const,
      createdAt: new Date(),
      metadata: {
        context,
        type: 'user-query',
        creditsDeducted: skipBilling ? 0 : REQUIRED_CREDITS,
      },
    };

    const jobResult = await providerManager.executeRequest(apiRequest);
    const anySuccess = jobResult.results.some((result) => result.status === 'success');

    if (!anySuccess) {
      await failExecution(
        'ALL_PROVIDERS_FAILED',
        'All AI providers failed. No credits were deducted.',
        502
      );
      return {
        success: false,
        code: 'ALL_PROVIDERS_FAILED',
        error: 'All AI providers failed. No credits were deducted.',
        totalTime: Date.now() - startTime,
      };
    }

    let creditsBefore = Number(profile.credits ?? 0);
    if (!skipBilling) {
      try {
        creditsBefore = await firestore.runTransaction(async (tx) => {
          const userRef = firestore.collection('users').doc(userId);
          const snapshot = await tx.get(userRef);
          const currentCredits = Number(snapshot.data()?.credits ?? 0);
          if (currentCredits < REQUIRED_CREDITS) {
            throw new Error('INSUFFICIENT_CREDITS');
          }

          tx.update(userRef, {
            credits: FieldValue.increment(-REQUIRED_CREDITS),
          });

          return currentCredits;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'INSUFFICIENT_CREDITS') {
          await failExecution(
            'INSUFFICIENT_CREDITS',
            `Insufficient credits. Required: ${REQUIRED_CREDITS}.`,
            402
          );
          return {
            success: false,
            code: 'INSUFFICIENT_CREDITS',
            error: `Insufficient credits. Required: ${REQUIRED_CREDITS}.`,
            totalTime: Date.now() - startTime,
          };
        }

        await failExecution(
          'CREDIT_DEDUCTION_FAILED',
          'Failed to deduct credits. Please try again.',
          500
        );
        return {
          success: false,
          code: 'CREDIT_DEDUCTION_FAILED',
          error: 'Failed to deduct credits. Please try again.',
          totalTime: Date.now() - startTime,
        };
      }
    }

    const providerResults: NonNullable<UserQueryApiResponse['results']> = jobResult.results.map((result) => ({
      providerId: result.providerId,
      status: result.status === 'success' || result.status === 'error' ? result.status : 'error',
      data: result.data,
      error: result.error,
      responseTime: result.responseTime,
      timestamp: result.timestamp instanceof Date
        ? result.timestamp.toISOString()
        : new Date(result.timestamp).toISOString(),
    }));

    const deducted = skipBilling ? 0 : REQUIRED_CREDITS;

    let persistedQueryResult: QueryProcessingResult;
    try {
      const persisted = await persistOneQueryResultServer({
        brandId,
        userId,
        companyName: brandName,
        brandDomain,
        query: {
          query,
          keyword,
          category,
        },
        processingSessionId,
        processingSessionTimestamp,
        userQueryResponse: {
          success: true,
          results: providerResults,
          userCredits: {
            before: creditsBefore,
            after: creditsBefore - deducted,
            deducted,
          },
          totalCost: jobResult.totalCost,
        },
      });

      persistedQueryResult = persisted.queryResult;
    } catch (persistError) {
      let refundApplied = false;
      let refundErrorMessage: string | undefined;

      if (!skipBilling) {
        try {
          await firestore.collection('users').doc(userId).update({
            credits: FieldValue.increment(REQUIRED_CREDITS),
          });
          refundApplied = true;
        } catch (refundError) {
          refundErrorMessage = refundError instanceof Error
            ? refundError.message
            : String(refundError);
          console.error('❌ Failed to refund credits after persistence error:', refundError);
        }
      }

      const errorCode = refundApplied
        ? 'PERSISTENCE_FAILED_REFUNDED'
        : (skipBilling ? 'PERSISTENCE_FAILED' : 'PERSISTENCE_FAILED_REFUND_FAILED');

      await failExecution(
        errorCode,
        persistError instanceof Error ? persistError.message : 'Unknown persistence error',
        500,
        refundApplied
      );

      return {
        success: false,
        code: errorCode,
        error: 'Failed to persist query result',
        message: persistError instanceof Error ? persistError.message : 'Unknown persistence error',
        totalTime: Date.now() - startTime,
        userCredits: {
          before: creditsBefore,
          after: refundApplied ? creditsBefore : creditsBefore - deducted,
          deducted: refundApplied ? 0 : deducted,
        },
        ...(refundErrorMessage && {
          message: `${persistError instanceof Error ? persistError.message : 'Unknown persistence error'} (refund error: ${refundErrorMessage})`,
        }),
      };
    }

    const response: ExecutePersistedUserQueryServerResult = {
      success: true,
      totalTime: Date.now() - startTime,
      totalCost: jobResult.totalCost,
      userCredits: {
        before: creditsBefore,
        after: creditsBefore - deducted,
        deducted,
      },
      persistedQueryResult,
    };

    await completeQueryExecution({
      ...executionIdentity,
      replayResponse: response,
    });

    return response;
  } catch (error) {
    await failExecution(
      'UNHANDLED_USER_QUERY_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );

    return {
      success: false,
      code: 'UNHANDLED_USER_QUERY_ERROR',
      error: 'Failed to process user query',
      message: error instanceof Error ? error.message : 'Unknown error',
      totalTime: Date.now() - startTime,
    };
  }
}
