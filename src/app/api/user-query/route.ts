import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { auth, firestore, FieldValue } from '@/firebase/firebase-admin';
import { getUserProfileServer } from '@/firebase/firestore/userProfileServer';

// Type definitions
interface UserQueryRequest {
  query: string;
  context?: string;
  userId?: string;
  isAutoStart?: boolean; // Add this flag
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
}

// Helper function to authenticate user and get profile.
// Supports two modes:
//   1. User mode: Authorization: Bearer <firebase-id-token> — verified via Admin SDK
//   2. Cron/service mode: Authorization: Bearer <CRON_SECRET> + X-Cron-User-Id: <uid>
//      — used by /api/cron/process-scheduled to run on behalf of a brand's owner.
//      Returns isCron=true so callers can adjust behaviour (e.g. credits).
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
      console.log('🔑 Cron-authenticated request for user:', cronUserId);
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
  
  try {
    const body: UserQueryRequest = await request.json();
    const { query, context, isAutoStart } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
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

    console.log('📝 Processing user query with authentication:', {
      query: query.substring(0, 100) + '...',
      userId: uid,
      userCredits: profile.credits,
      requiredCredits,
      isAutoStart,
      isCron: !!isCron,
      timestamp: new Date().toISOString()
    });

    // Advisory upfront credit check: fail fast if the user is obviously
    // short on credits. This is NOT a reservation — the transaction below
    // (after provider execution) is the real atomicity guard against
    // concurrent requests draining credits simultaneously.
    //
    // Auto-start queries are free: skip the check AND skip the later
    // deduction (preserves prior behaviour).
    if (!isAutoStart) {
      if (profile.credits < requiredCredits) {
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
      console.log('🚀 Auto-start query - skipping credit check and deduction');
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
      id: `user-query-${Date.now()}`,
      prompt: query,
      providers: selectedProviders,
      userId: uid,
      priority: 'high' as const,
      createdAt: new Date(),
      metadata: {
        context,
        type: 'user-query',
        creditsDeducted: isAutoStart ? 0 : requiredCredits
      }
    };

    console.log(`🚀 Executing query with ${selectedProviders.length} provider(s):`, selectedProviders, skippedProviders.length ? `(skipped unconfigured: ${skippedProviders.join(', ')})` : '');

    // Execute the request BEFORE charging credits. This way the user isn't
    // billed if every provider fails.
    const jobResult = await providerManager.executeRequest(apiRequest);

    const totalTime = Date.now() - startTime;

    // Determine success: at least one provider returned success.
    const anySuccess = jobResult.results.some(r => r.status === 'success');

    // If all providers errored, do not deduct credits. Return 502.
    if (!anySuccess) {
      console.error('❌ All providers failed for user query — skipping credit deduction', {
        userId: uid,
        providerCount: jobResult.results.length,
        totalTime
      });
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
    if (!isAutoStart) {
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

    const deductedAmount = isAutoStart ? 0 : requiredCredits;

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
      }
    };

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
      description: 'Credits are deducted before processing begins'
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
          context: 'Additional context for the query (optional)'
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
        results: 'Detailed provider responses',
        performance: 'Response times and costs',
        userCredits: 'Credit balance before/after processing'
      }
    },
    errorCodes: {
      AUTHENTICATION_REQUIRED: 'No valid authorization token provided',
      INSUFFICIENT_CREDITS: 'User does not have enough credits (requires 10)',
      CREDIT_DEDUCTION_FAILED: 'Failed to deduct credits from user account'
    }
  });
} 