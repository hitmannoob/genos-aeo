import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { auth, firestore, FieldValue } from '@/firebase/firebase-admin';
import { getUserProfileServer } from '@/firebase/firestore/userProfileServer';
import { persistOneQueryResultServer } from '@/firebase/firestore/persistQueryResultServer';
import {
  acquireQueryExecution,
  completeQueryExecution,
  failQueryExecution,
} from '@/firebase/firestore/queryExecutionLedger';
import type { QueryProcessingResult } from '@/firebase/firestore/queryResultUtils';

// Type definitions
interface UserQueryRequest {
  query: string;
  context?: string;
  userId?: string;
  persistResult?: boolean;
  brandId?: string;
  brandName?: string;
  brandDomain?: string;
  keyword?: string;
  category?: string;
  processingSessionId?: string;
  processingSessionTimestamp?: string;
  clientRequestId?: string;
}

interface ProviderResult {
  providerId: string;
  status: 'success' | 'error';
  data?: any;
  error?: string;
  responseTime: number;
  cost: number;
  timestamp: string;
}

interface ModalQueryResult {
  success: boolean;
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

// Helper function to authenticate user and get profile.
// Supports two modes:
//   1. User mode: Authorization: Bearer <firebase-id-token> — verified via Admin SDK
//   2. Service mode: Authorization: Bearer <CRON_SECRET> + X-Cron-User-Id: <uid>
//      — used by internal server-owned workers to run on behalf of a brand's
//        owner. Billing behavior is selected later via X-Service-Billing-Mode.
async function authenticateUser(
  request: NextRequest
): Promise<{ uid: string; profile: any; isCron?: boolean } | null> {
  try {
    // Check for Authorization header
    const authorization = request.headers.get('authorization');

    if (!authorization) {
      console.log('❌ No authorization header found');
      return null;
    }

    // Extract token from "Bearer <token>" format
    const token = authorization.split(' ')[1];

    if (!token) {
      console.log('❌ No token found in authorization header');
      return null;
    }

    // Cron/service mode
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && token === cronSecret) {
      const cronUserId = request.headers.get('x-cron-user-id');
      if (!cronUserId) {
        console.log('❌ Cron request missing X-Cron-User-Id header');
        return null;
      }
      console.log('🔑 Service-authenticated request for user:', cronUserId, {
        billingMode: request.headers.get('x-service-billing-mode') || 'skip',
      });
      const { result: userProfile, error } = await getUserProfileServer(cronUserId);
      if (error || !userProfile) {
        console.log('❌ Cron request: user profile not found for', cronUserId);
        return null;
      }
      return { uid: cronUserId, profile: userProfile, isCron: true };
    }

    console.log('🔑 Verifying Firebase ID token...');

    // Verify the Firebase ID token
    const decodedToken = await auth.verifyIdToken(token);
    
    if (!decodedToken || !decodedToken.uid) {
      console.log('❌ Invalid or expired Firebase ID token');
      return null;
    }

    console.log('✅ Firebase ID token verified successfully for user:', decodedToken.uid);
    console.log('🔍 Fetching user profile from Firestore...');

    // Get user profile from Firestore with better error handling
    try {
      const { result: userProfile, error: profileError } = await getUserProfileServer(decodedToken.uid);
      
      if (profileError) {
        console.error('❌ Error fetching user profile:', profileError);
        
        // Check if it's a permission error
        if (profileError.code === 'permission-denied') {
          console.error('🔥 Firestore permission denied error - possible causes:');
          console.error('   1. Firebase Admin SDK not properly authenticated');
          console.error('   2. Project ID mismatch between client and server');
          console.error('   3. Invalid Firebase Admin credentials');
          console.error('   4. Firestore rules blocking Admin SDK access');
          
          // Try to provide more specific debugging info
          console.log('🔍 Debug info:');
          console.log('   - User UID:', decodedToken.uid);
          console.log('   - Project ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
          console.log('   - Client Email:', process.env.FIREBASE_CLIENT_EMAIL?.substring(0, 20) + '...');
        }
        
        return null;
      }

      if (!userProfile) {
        console.log('❌ User profile not found for UID:', decodedToken.uid);
        return null;
      }

      console.log('✅ User profile fetched successfully:', {
        uid: decodedToken.uid,
        email: userProfile.email,
        credits: userProfile.credits
      });

      return {
        uid: decodedToken.uid,
        profile: userProfile
      };

    } catch (firestoreError) {
      console.error('❌ Firestore access error:', firestoreError);
      return null;
    }

  } catch (error) {
    console.error('❌ Authentication error:', error);
    return null;
  }
}

// Main POST handler
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let parsedBody: UserQueryRequest | null = null;
  let executionIdentityForCatch:
    | {
        userId: string;
        brandId?: string;
        clientRequestId: string;
      }
    | null = null;
  
  try {
    const body: UserQueryRequest = await request.json();
    parsedBody = body;
    const {
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
    } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    if (
      persistResult &&
      (!brandId || !processingSessionId || !processingSessionTimestamp)
    ) {
      return NextResponse.json(
        {
          error: 'brandId, processingSessionId, and processingSessionTimestamp are required when persistResult is true',
          code: 'PERSISTENCE_METADATA_REQUIRED',
        },
        { status: 400 }
      );
    }

    if (persistResult && !clientRequestId) {
      return NextResponse.json(
        {
          error: 'clientRequestId is required when persistResult is true',
          code: 'CLIENT_REQUEST_ID_REQUIRED',
        },
        { status: 400 }
      );
    }

    // Authenticate user
    const authResult = await authenticateUser(request);
    
    if (!authResult) {
      return NextResponse.json(
        { 
          error: 'Authentication required. Please provide a valid authorization token.',
          code: 'AUTHENTICATION_REQUIRED'
        },
        { status: 401 }
      );
    }

    const { uid, profile, isCron } = authResult;
    const requiredCredits = 10; // Cost for processing a query
    const executionIdentity = clientRequestId
      ? {
          userId: uid,
          brandId,
          clientRequestId,
        }
      : null;
    executionIdentityForCatch = executionIdentity;
    const markExecutionFailed = async (
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

    // Service-authenticated internal callers can explicitly choose whether to
    // skip billing (`skip`, scheduled cron) or charge (`charge`, manual
    // server-owned batch jobs). Browser-authenticated user requests always pay.
    const serviceBillingMode = request.headers.get('x-service-billing-mode') || 'skip';
    const skipBilling = !!isCron && serviceBillingMode !== 'charge';

    console.log('📝 Processing user query with authentication:', {
      query: query.substring(0, 100) + '...',
      persistResult,
      brandId,
      processingSessionId,
      clientRequestId,
      userId: uid,
      userCredits: profile.credits,
      requiredCredits,
      isCron: !!isCron,
      serviceBillingMode,
      skipBilling,
      timestamp: new Date().toISOString()
    });

    if (executionIdentity) {
      const acquireResult = await acquireQueryExecution<ModalQueryResult>({
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
        return NextResponse.json(acquireResult.response);
      }

      if (acquireResult.status === 'in_progress') {
        return NextResponse.json(
          {
            success: false,
            error: 'This request is already being processed.',
            code: 'REQUEST_IN_PROGRESS',
            retryAfterSeconds: acquireResult.retryAfterSeconds,
          },
          {
            status: 409,
            headers: {
              'Retry-After': String(acquireResult.retryAfterSeconds),
            },
          }
        );
      }

      if (acquireResult.status === 'conflict') {
        return NextResponse.json(
          {
            success: false,
            error: acquireResult.message,
            code: 'IDEMPOTENCY_KEY_REUSED',
          },
          { status: 409 }
        );
      }
    }

    // Advisory upfront credit check: fail fast if the user is obviously
    // short on credits. This is NOT a reservation — the transaction below
    // (after provider execution) is the real atomicity guard against
    // concurrent requests draining credits simultaneously.
    if (!skipBilling) {
      if (profile.credits < requiredCredits) {
        await markExecutionFailed(
          'INSUFFICIENT_CREDITS',
          `Insufficient credits. Required: ${requiredCredits}, Available: ${profile.credits}`,
          402
        );
        return NextResponse.json(
          {
            error: `Insufficient credits. Required: ${requiredCredits}, Available: ${profile.credits}`,
            code: 'INSUFFICIENT_CREDITS',
            requiredCredits,
            availableCredits: profile.credits
          },
          { status: 402 }
        );
      }
    } else {
      console.log('🛠️ Cron-authenticated request — skipping credit check and deduction');
    }

    // Initialize provider manager
    const providerManager = new ProviderManager();

    // Preferred providers for user queries. Filter to those actually
    // configured so unconfigured providers don't register as failures
    // (and don't trip ALL_PROVIDERS_FAILED when only one real failure occurs).
    const preferredProviders = ['chatgptsearch', 'google-ai-overview', 'perplexity'];
    const availableProviders = new Set(providerManager.getAvailableProviders());
    const selectedProviders = preferredProviders.filter(p => availableProviders.has(p));
    const skippedProviders = preferredProviders.filter(p => !availableProviders.has(p));

    if (selectedProviders.length === 0) {
      console.error('❌ No user-query providers configured. Preferred:', preferredProviders, 'Available:', Array.from(availableProviders));
      await markExecutionFailed(
        'NO_PROVIDERS_CONFIGURED',
        'No AI providers are configured.',
        503
      );
      return NextResponse.json(
        {
          success: false,
          error: 'No AI providers are configured. Set at least one of OPENAI_API_KEY, PERPLEXITY_API_KEY, or DATAFORSEO_USERNAME+DATAFORSEO_PASSWORD.',
          code: 'NO_PROVIDERS_CONFIGURED',
          preferredProviders,
          availableProviders: Array.from(availableProviders)
        },
        { status: 503 }
      );
    }

    // Create API request for the available providers
    const apiRequest = {
      id: clientRequestId || `user-query-${Date.now()}`,
      prompt: query,
      providers: selectedProviders,
      userId: uid,
      priority: 'high' as const,
      createdAt: new Date(),
      metadata: {
        context,
        type: 'user-query',
        creditsDeducted: skipBilling ? 0 : requiredCredits
      }
    };

    console.log(`🚀 Executing query with ${selectedProviders.length} provider(s):`, selectedProviders, skippedProviders.length ? `(skipped unconfigured: ${skippedProviders.join(', ')})` : '');

    // Execute the request BEFORE charging credits. This way the user isn't
    // billed if every provider fails.
    const jobResult = await providerManager.executeRequest(apiRequest);

    let totalTime = Date.now() - startTime;

    // Determine success: at least one provider returned success.
    const anySuccess = jobResult.results.some(r => r.status === 'success');

    // If all providers errored, do not deduct credits. Return 502.
    if (!anySuccess) {
      console.error('❌ All providers failed for user query — skipping credit deduction', {
        userId: uid,
        providerCount: jobResult.results.length,
        totalTime
      });
      await markExecutionFailed(
        'ALL_PROVIDERS_FAILED',
        'All AI providers failed. No credits were deducted.',
        502
      );
      return NextResponse.json(
        {
          success: false,
          error: 'All AI providers failed. No credits were deducted.',
          code: 'ALL_PROVIDERS_FAILED',
          results: jobResult.results.map(r => ({
            providerId: r.providerId,
            status: r.status,
            error: r.error
          })),
          totalTime,
          timestamp: new Date().toISOString()
        },
        { status: 502 }
      );
    }

    // Atomic deduct-after-success. Transaction re-reads credits inside the
    // transaction so concurrent requests cannot both pass the earlier
    // advisory check and overspend.
    let creditsBefore = profile.credits;
    if (!skipBilling) {
      try {
        creditsBefore = await firestore.runTransaction(async (tx) => {
          const userRef = firestore.collection('users').doc(uid);
          const snap = await tx.get(userRef);
          const current = (snap.data()?.credits ?? 0) as number;
          if (current < requiredCredits) {
            throw new Error('INSUFFICIENT_CREDITS');
          }
          tx.update(userRef, {
            credits: FieldValue.increment(-requiredCredits)
          });
          return current;
        });

        console.log('✅ Credits deducted successfully:', {
          userId: uid,
          deducted: requiredCredits,
          previousCredits: creditsBefore,
          newCredits: creditsBefore - requiredCredits
        });
      } catch (txError) {
        const msg = txError instanceof Error ? txError.message : String(txError);
        if (msg === 'INSUFFICIENT_CREDITS') {
          // Rare: concurrent requests drained credits while providers ran.
          // The AI work is already done, but we can't charge them — surface
          // 402 so the client knows the balance is empty. We do NOT retry.
          console.warn('⚠️ Credit deduction race: credits drained during provider execution', { userId: uid });
          await markExecutionFailed(
            'INSUFFICIENT_CREDITS',
            `Insufficient credits. Required: ${requiredCredits}.`,
            402
          );
          return NextResponse.json(
            {
              error: `Insufficient credits. Required: ${requiredCredits}.`,
              code: 'INSUFFICIENT_CREDITS',
              requiredCredits
            },
            { status: 402 }
          );
        }
        console.error('❌ Credit deduction transaction failed:', txError);
        await markExecutionFailed(
          'CREDIT_DEDUCTION_FAILED',
          'Failed to deduct credits. Please try again.',
          500
        );
        return NextResponse.json(
          {
            error: 'Failed to deduct credits. Please try again.',
            code: 'CREDIT_DEDUCTION_FAILED'
          },
          { status: 500 }
        );
      }
    }
    
    // Transform results for modal display
    const modalResults: ProviderResult[] = jobResult.results.map(result => ({
      providerId: result.providerId,
      // Only allow 'success' or 'error' as valid statuses
      status: result.status === 'success' || result.status === 'error' ? result.status : 'error',
      data: result.data,
      error: result.error,
      responseTime: result.responseTime,
      cost: result.cost,
      timestamp: result.timestamp instanceof Date
        ? result.timestamp.toISOString()
        : new Date(result.timestamp).toISOString()
    }));

    // Create summary for easy modal display
    const summary: any = {};
    
    jobResult.results.forEach(result => {
      if (result.status === 'success' && result.data) {
        switch (result.providerId) {
          case 'chatgptsearch':
            summary.chatgptSearch = {
              content: result.data.content || '',
              webSearchUsed: result.data.webSearchUsed || false,
              citations: result.data.annotations?.length || 0,
              responseTime: result.responseTime
            };
            break;
            
          case 'google-ai-overview':
            summary.googleAiOverview = {
              totalItems: result.data.totalItems || 0,
              peopleAlsoAskCount: result.data.peopleAlsoAskCount || 0,
              organicResultsCount: result.data.organicResultsCount || 0,
              location: result.data.location || 'Unknown',
              responseTime: result.responseTime
            };
            break;
            
          case 'perplexity':
            summary.perplexity = {
              content: result.data.content || '',
              citations: result.data.citations?.length || 0,
              realTimeData: result.data.realTimeData || false,
              responseTime: result.responseTime
            };
            break;
        }
      }
    });

    const deductedAmount = skipBilling ? 0 : requiredCredits;

    let persistedQueryResult: QueryProcessingResult | undefined;
    if (persistResult) {
      try {
        const persistenceResponse = {
          success: true,
          results: modalResults,
          userCredits: {
            before: creditsBefore,
            after: creditsBefore - deductedAmount,
            deducted: deductedAmount,
          },
          totalCost: jobResult.totalCost,
        };

        const persisted = await persistOneQueryResultServer({
          brandId: brandId!,
          userId: uid,
          companyName: brandName || 'Unknown',
          brandDomain: brandDomain || '',
          query: {
            query,
            keyword,
            category,
          },
          processingSessionId: processingSessionId!,
          processingSessionTimestamp: processingSessionTimestamp!,
          userQueryResponse: persistenceResponse,
        });

        persistedQueryResult = persisted.queryResult;
      } catch (persistError) {
        let refundApplied = false;
        let refundErrorMessage: string | undefined;

        if (!skipBilling) {
          try {
            await firestore.collection('users').doc(uid).update({
              credits: FieldValue.increment(requiredCredits),
            });
            refundApplied = true;
          } catch (refundError) {
            refundErrorMessage =
              refundError instanceof Error ? refundError.message : String(refundError);
            console.error('❌ Failed to refund credits after persistence error:', refundError);
          }
        }

        await markExecutionFailed(
          refundApplied
            ? 'PERSISTENCE_FAILED_REFUNDED'
            : (skipBilling ? 'PERSISTENCE_FAILED' : 'PERSISTENCE_FAILED_REFUND_FAILED'),
          persistError instanceof Error ? persistError.message : 'Unknown persistence error',
          500,
          refundApplied
        );

        return NextResponse.json(
          {
            success: false,
            error: 'Failed to persist query result',
            code: refundApplied
              ? 'PERSISTENCE_FAILED_REFUNDED'
              : (skipBilling ? 'PERSISTENCE_FAILED' : 'PERSISTENCE_FAILED_REFUND_FAILED'),
            message: persistError instanceof Error ? persistError.message : 'Unknown persistence error',
            refundApplied,
            refundError: refundErrorMessage,
            totalTime: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          },
          { status: 500 }
        );
      }
    }

    totalTime = Date.now() - startTime;

    const modalResult: ModalQueryResult = {
      success: true,
      query,
      totalResults: jobResult.results.length,
      successfulResults: jobResult.results.filter(r => r.status === 'success').length,
      totalCost: jobResult.totalCost,
      totalTime,
      results: modalResults,
      summary,
      timestamp: new Date().toISOString(),
      userCredits: {
        before: creditsBefore,
        after: creditsBefore - deductedAmount,
        deducted: deductedAmount
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

    console.log('✅ User query processed successfully:', {
      query: query.substring(0, 50) + '...',
      userId: uid,
      totalResults: modalResult.totalResults,
      successfulResults: modalResult.successfulResults,
      totalCost: modalResult.totalCost,
      totalTime: modalResult.totalTime,
      creditsDeducted: deductedAmount
    });

    return NextResponse.json(modalResult);

  } catch (error) {
    const totalTime = Date.now() - startTime;

    if (executionIdentityForCatch) {
      try {
        await failQueryExecution({
          ...executionIdentityForCatch,
          code: 'UNHANDLED_USER_QUERY_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          httpStatus: 500,
        });
      } catch (ledgerError) {
        console.error('❌ Failed to mark unhandled user-query error in ledger:', ledgerError);
      }
    } else if (parsedBody?.clientRequestId) {
      const authResult = await authenticateUser(request).catch(() => null);
      if (authResult?.uid) {
        try {
          await failQueryExecution({
            userId: authResult.uid,
            brandId: parsedBody.brandId,
            clientRequestId: parsedBody.clientRequestId,
            code: 'UNHANDLED_USER_QUERY_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
            httpStatus: 500,
          });
        } catch (ledgerError) {
          console.error('❌ Failed to mark unhandled user-query error in ledger:', ledgerError);
        }
      }
    }

    console.error('❌ User query error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      totalTime
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to process user query',
      message: error instanceof Error ? error.message : 'Unknown error',
      totalTime,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// GET handler for API documentation
export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Enhanced User Query API - 3 Provider System with Credit Deduction',
    authentication: {
      required: true,
      method: 'Bearer token in Authorization header',
      description: 'Firebase ID token required for authentication'
    },
    creditCost: {
      perQuery: 10,
      description: 'Credits are deducted only after at least one provider succeeds'
    },
    providers: [
      {
        name: 'ChatGPT Search',
        capabilities: ['AI reasoning', 'Real-time web search', 'Citations'],
        responseTime: '8-15 seconds',
        cost: '~$0.003 per request'
      },
      {
        name: 'Google AI Overview',
        capabilities: ['SERP data', 'People Also Ask', 'Organic results', 'AI Overview'],
        responseTime: '14-17 seconds', 
        cost: '~$0.0046 per request'
      },
      {
        name: 'Perplexity AI',
        capabilities: ['AI reasoning', 'Real-time web search', 'Citations', 'Current information'],
        responseTime: '7-8 seconds',
        cost: '~$0.005 per request'
      }
    ],
    endpoints: {
      POST: {
        description: 'Submit a query to the 3 selected AI providers (requires authentication)',
        headers: {
          'Authorization': 'Bearer <firebase-id-token>',
          'Content-Type': 'application/json'
        },
        body: {
          query: 'Your question here (required)',
          context: 'Additional context for the query (optional)',
          clientRequestId: 'Stable idempotency key (optional, required for persistResult)',
          persistResult: 'Persist the result server-side and return only after the write succeeds (optional)',
        }
      }
    },
    example: {
      query: 'What are the latest developments in AI technology?',
      context: 'Focus on 2025 developments'
    },
    modalFormat: {
      description: 'Results are formatted for easy modal display with credit tracking',
      structure: {
        summary: 'Quick overview of each provider result',
        results: 'Detailed provider responses on the first execution; replayed idempotent responses return summary results without raw provider data',
        performance: 'Response times and costs',
        userCredits: 'Credit balance before/after processing'
      }
    },
    errorCodes: {
      AUTHENTICATION_REQUIRED: 'No valid authorization token provided',
      INSUFFICIENT_CREDITS: 'User does not have enough credits (requires 10)',
      CREDIT_DEDUCTION_FAILED: 'Failed to deduct credits from user account',
      CLIENT_REQUEST_ID_REQUIRED: 'persistResult requests must include a stable clientRequestId',
      REQUEST_IN_PROGRESS: 'Another request with the same clientRequestId is already executing',
      IDEMPOTENCY_KEY_REUSED: 'The same clientRequestId was reused with a different request payload',
      PERSISTENCE_FAILED: 'Provider execution succeeded but the server could not persist the result',
      PERSISTENCE_FAILED_REFUNDED: 'Persistence failed and any deducted credits were refunded',
      PERSISTENCE_FAILED_REFUND_FAILED: 'Persistence failed and the refund also failed'
    }
  });
}
