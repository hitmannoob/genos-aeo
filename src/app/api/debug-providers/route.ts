import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Starting provider debug check...');
    
    // Check environment variables
    const envCheck = {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      GOOGLE_AI_API_KEY: !!process.env.GOOGLE_AI_API_KEY || !!process.env.GEMINI_API_KEY,
      PERPLEXITY_API_KEY: !!process.env.PERPLEXITY_API_KEY,
      DATAFORSEO_USERNAME: !!process.env.DATAFORSEO_USERNAME,
      DATAFORSEO_PASSWORD: !!process.env.DATAFORSEO_PASSWORD,
      // Firebase Admin SDK environment variables
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    };
    
    console.log('🔑 Environment variables check:', envCheck);
    
    // Try to import and test Firebase Admin SDK
    let firebaseAdminCheck = null;
    try {
      const admin = await import('@/firebase/firebase-admin');
      console.log('✅ Firebase Admin SDK imported successfully');
      
      // Test if admin is properly initialized
      if (admin.auth && admin.firestore) {
        firebaseAdminCheck = '✅ Firebase Admin SDK initialized and ready';
        console.log('✅ Firebase Admin SDK services available');
      } else {
        firebaseAdminCheck = '❌ Firebase Admin SDK services not available';
      }
    } catch (error) {
      console.error('❌ Firebase Admin SDK error:', error);
      firebaseAdminCheck = `❌ Firebase Admin SDK error: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    // Try to import the ProviderManager
    let providerManagerImportError = null;
    let providerManager = null;
    
    try {
      const { ProviderManager } = await import('@/lib/api-providers/provider-manager');
      console.log('✅ ProviderManager imported successfully');
      
      // Try to initialize it
      providerManager = new ProviderManager();
      console.log('✅ ProviderManager initialized successfully');
      
    } catch (error) {
      console.error('❌ ProviderManager import/init error:', error);
      providerManagerImportError = error instanceof Error ? error.message : 'Unknown error';
    }
    
    // Try to get available providers
    let availableProviders: any[] = [];
    let providersError = null;
    
    if (providerManager) {
      try {
        availableProviders = providerManager.getAvailableProviders();
        console.log('📋 Available providers:', availableProviders);
      } catch (error) {
        console.error('❌ Error getting providers:', error);
        providersError = error instanceof Error ? error.message : 'Unknown error';
      }
    }
    
    // Try to import individual providers
    const providerImports: Record<string, string> = {};
    
    try {
      const { GeminiProvider } = await import('@/lib/api-providers/gemini-provider');
      providerImports['GeminiProvider'] = '✅ Success';
    } catch (error) {
      providerImports['GeminiProvider'] = `❌ ${error instanceof Error ? error.message : String(error)}`;
    }
    
    try {
      const { ChatGPTSearchProvider } = await import('@/lib/api-providers/chatgptsearch-provider');
      providerImports['ChatGPTSearchProvider'] = '✅ Success';
    } catch (error) {
      providerImports['ChatGPTSearchProvider'] = `❌ ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
      const { GoogleAIOverviewProvider } = await import('@/lib/api-providers/google-ai-overview-provider');
      providerImports['GoogleAIOverviewProvider'] = '✅ Success';
    } catch (error) {
      providerImports['GoogleAIOverviewProvider'] = `❌ ${error instanceof Error ? error.message : String(error)}`;
    }
    
    try {
      const { PerplexityProvider } = await import('@/lib/api-providers/perplexity-provider');
      providerImports['PerplexityProvider'] = '✅ Success';
    } catch (error) {
      providerImports['PerplexityProvider'] = `❌ ${error instanceof Error ? error.message : String(error)}`;
    }
    
    // Check if OpenAI package is available
    let openaiPackageCheck = null;
    try {
      const OpenAI = await import('openai');
      openaiPackageCheck = '✅ OpenAI package available';
    } catch (error) {
      openaiPackageCheck = `❌ OpenAI package error: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    // Check if firebase-admin package is available
    let firebaseAdminPackageCheck = null;
    try {
      const firebaseAdmin = await import('firebase-admin');
      firebaseAdminPackageCheck = '✅ Firebase Admin package available';
    } catch (error) {
      firebaseAdminPackageCheck = `❌ Firebase Admin package error: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    // Test authentication middleware
    let authMiddlewareCheck = null;
    try {
      const { withAuth } = await import('@/lib/api-auth-middleware');
      authMiddlewareCheck = '✅ Authentication middleware available';
    } catch (error) {
      authMiddlewareCheck = `❌ Authentication middleware error: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      checks: {
        environment: envCheck,
        firebaseAdmin: firebaseAdminCheck,
        firebaseAdminPackage: firebaseAdminPackageCheck,
        authMiddleware: authMiddlewareCheck,
        providerManagerImport: providerManagerImportError ? `❌ ${providerManagerImportError}` : '✅ Success',
        availableProviders,
        providersError,
        providerImports,
        openaiPackage: openaiPackageCheck,
      },
      recommendations: [
        !envCheck.OPENAI_API_KEY ? '⚠️ Set OPENAI_API_KEY in your .env file' : null,
        !envCheck.PERPLEXITY_API_KEY ? '⚠️ Set PERPLEXITY_API_KEY in your .env file' : null,
        !envCheck.DATAFORSEO_USERNAME ? '⚠️ Set DATAFORSEO_USERNAME in your .env file' : null,
        !envCheck.DATAFORSEO_PASSWORD ? '⚠️ Set DATAFORSEO_PASSWORD in your .env file' : null,
        !envCheck.FIREBASE_CLIENT_EMAIL ? '⚠️ Set FIREBASE_CLIENT_EMAIL in your .env file' : null,
        !envCheck.FIREBASE_PRIVATE_KEY ? '⚠️ Set FIREBASE_PRIVATE_KEY in your .env file' : null,
        !envCheck.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? '⚠️ Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in your .env file' : null,
        firebaseAdminCheck?.includes('❌') ? '⚠️ Check Firebase Admin SDK configuration' : null,
        authMiddlewareCheck?.includes('❌') ? '⚠️ Check authentication middleware' : null,
        providerManagerImportError ? '⚠️ Check provider manager implementation' : null,
        providersError ? '⚠️ Check provider initialization' : null,
        !availableProviders.includes('chatgptsearch') ? '⚠️ ChatGPT Search provider not available' : null,
        !availableProviders.includes('perplexity') ? '⚠️ Perplexity provider not available' : null,
        !availableProviders.includes('google-ai-overview') ? '⚠️ Google AI Overview provider not available' : null,
      ].filter(Boolean)
    });
    
  } catch (error) {
    console.error('❌ Debug check failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Debug check failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : null
    }, { status: 500 });
  }
} 