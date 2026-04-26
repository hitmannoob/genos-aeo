import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { APIRequest } from '@/lib/api-providers/types';
import { authenticateApiRequest } from '@/lib/serverAuth';
import { z } from 'zod';

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

    // Create API request
    const apiRequest: APIRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      prompt,
      providers,
      priority,
      userId: authResult.uid,
      metadata: {
        userAgent: request.headers.get('user-agent'),
        timestamp: new Date().toISOString(),
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
