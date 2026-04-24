import { BaseAPIProvider } from './base-provider';
import { GeminiProvider } from './gemini-provider';
import { ChatGPTSearchProvider } from './chatgptsearch-provider';
import { GoogleAIOverviewProvider } from './google-ai-overview-provider';
import { PerplexityProvider } from './perplexity-provider';
import { APIRequest, APIResponse, JobResult } from './types';

export class ProviderManager {
  private providers: Map<string, BaseAPIProvider> = new Map();
  private jobQueue: APIRequest[] = [];
  private activeJobs: Map<string, Promise<JobResult>> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    // Initialize providers from environment variables or config
    const providers = this.getProviderConfigs();
    
    providers.forEach(config => {
      let provider: BaseAPIProvider;
      
      switch (config.type) {
        case 'google-gemini':
          provider = new GeminiProvider(config);
          break;
        case 'chatgptsearch':
          provider = new ChatGPTSearchProvider(config);
          break;
        case 'google-ai-overview':
          provider = new GoogleAIOverviewProvider(config);
          break;
        case 'perplexity':
          provider = new PerplexityProvider(config);
          break;
        default:
          console.warn(`Unknown provider type: ${config.type}`);
          return;
      }
      
      this.providers.set(config.name, provider);
    });
  }

  private getProviderConfigs(): Array<any> {
    // In production, this would come from environment variables or database
    const configs = [];
    
    // ChatGPT Search Configuration
    const chatgptSearchApiKey = process.env.OPENAI_API_KEY || process.env.CHATGPT_SEARCH_API_KEY;
    if (chatgptSearchApiKey && chatgptSearchApiKey.trim() !== '') {
      const chatgptSearchConfig = {
        name: 'chatgptsearch',
        type: 'chatgptsearch' as const,
        apiKey: chatgptSearchApiKey,
        timeout: 45000, // Longer timeout for web search
        retryAttempts: 3,
      };
      configs.push(chatgptSearchConfig);
      console.log('✅ ChatGPT Search provider configured');
    } else {
      console.warn('⚠️ ChatGPT Search API key not found. Set OPENAI_API_KEY or CHATGPT_SEARCH_API_KEY environment variable to enable ChatGPT Search provider.');
    }
    
    // Perplexity Configuration
    const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    if (perplexityApiKey && perplexityApiKey.trim() !== '') {
      const perplexityConfig = {
        name: 'perplexity',
        type: 'perplexity' as const,
        apiKey: perplexityApiKey,
        timeout: 30000,
        retryAttempts: 3,
      };
      configs.push(perplexityConfig);
      console.log('✅ Perplexity provider configured');
    } else {
      console.warn('⚠️ Perplexity API key not found. Set PERPLEXITY_API_KEY environment variable to enable Perplexity provider.');
    }
    
    // Google Gemini Configuration
    const geminiApiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (geminiApiKey && geminiApiKey.trim() !== '') {
      const geminiConfig = {
        name: 'google-gemini',
        type: 'google-gemini' as const,
        apiKey: geminiApiKey,
        timeout: 30000,
        retryAttempts: 3,
      };
      configs.push(geminiConfig);
      console.log('✅ Google Gemini provider configured');
    } else {
      console.warn('⚠️ Google Gemini API key not found. Set GOOGLE_AI_API_KEY or GEMINI_API_KEY environment variable to enable Gemini provider.');
    }
    
    // Google AI Overview Configuration (DataForSEO) - Only enable with proper credentials
    const dataForSeoUsername = process.env.DATAFORSEO_USERNAME;
    const dataForSeoPassword = process.env.DATAFORSEO_PASSWORD;
    
    // Only configure if both username and password are provided
    if (dataForSeoUsername && dataForSeoPassword && 
        dataForSeoUsername.trim() !== '' && dataForSeoPassword.trim() !== '') {
      const credentials = Buffer.from(`${dataForSeoUsername}:${dataForSeoPassword}`).toString('base64');
      const authHeader = `Basic ${credentials}`;
    
    const googleAIOverviewConfig = {
      name: 'google-ai-overview',
      type: 'google-ai-overview' as const,
      apiKey: '', // Not used for DataForSEO
      authHeader: authHeader,
      username: dataForSeoUsername,
      password: dataForSeoPassword,
      timeout: 30000,
      retryAttempts: 3,
    };
    configs.push(googleAIOverviewConfig);
      console.log('✅ Google AI Overview provider configured with environment credentials');
    } else {
      console.log('⚠️ Google AI Overview provider disabled - set DATAFORSEO_USERNAME and DATAFORSEO_PASSWORD environment variables to enable');
      console.log('💡 DataForSEO requires paid credits. Sign up at https://dataforseo.com for API access.');
    }
    
    console.log('🔧 Provider Manager Initialized:', {
      availableProviders: configs.map(c => c.name),
      chatgptSearchConfigured: !!chatgptSearchApiKey,
      perplexityConfigured: !!perplexityApiKey,
      geminiConfigured: !!geminiApiKey,
      dataForSeoConfigured: !!(dataForSeoUsername && dataForSeoPassword)
    });
    
    return configs;
  }

  // Execute request across multiple providers
  async executeRequest(request: APIRequest): Promise<JobResult> {
    const jobId = request.id;
    
    // Check if job is already running
    if (this.activeJobs.has(jobId)) {
      return this.activeJobs.get(jobId)!;
    }

    const jobPromise = this.processRequest(request);
    this.activeJobs.set(jobId, jobPromise);

    try {
      const result = await jobPromise;
      return result;
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private async processRequest(request: APIRequest): Promise<JobResult> {
    const startTime = Date.now();
    const results: APIResponse[] = [];
    
    // Get requested providers or use all available
    const providerNames = request.providers.length > 0 
      ? request.providers 
      : Array.from(this.providers.keys());

    console.log('🔄 ProviderManager Processing Request:', {
      requestId: request.id,
      availableProviders: Array.from(this.providers.keys()),
      requestedProviders: request.providers,
      providersToExecute: providerNames,
      prompt: request.prompt.substring(0, 100) + '...'
    });

    // EXPLICIT LOGGING FOR GOOGLE AI OVERVIEW
    console.log('🚨🚨🚨 PROVIDER AVAILABILITY CHECK 🚨🚨🚨');
    console.log('Google AI Overview requested:', request.providers.includes('google-ai-overview'));
    console.log('Google AI Overview available:', Array.from(this.providers.keys()).includes('google-ai-overview'));
    console.log('Google AI Overview provider exists:', this.providers.has('google-ai-overview'));
    console.log('All providers map:', Array.from(this.providers.keys()));
    console.log('🚨🚨🚨 PROVIDER AVAILABILITY CHECK END 🚨🚨🚨');

    // Execute requests in parallel. Each mapper catches its own errors and
    // returns an `APIResponse` with `status: 'error'` — so the outer
    // `Promise.all` cannot see a rejection, and no provider identity is ever
    // lost to an `'unknown'` fallback.
    const promises = providerNames.map(async (providerName): Promise<APIResponse> => {
      const provider = this.providers.get(providerName);
      if (!provider) {
        return {
          providerId: providerName,
          requestId: request.id,
          status: 'error',
          error: 'Provider not found',
          responseTime: 0,
          cost: 0,
          timestamp: new Date(),
        };
      }

      try {
        // Transform generic request to provider-specific format
        const providerRequest = this.transformRequestForProvider(request, provider);
        console.log(`🚀 Executing ${providerName} with request:`, JSON.stringify(providerRequest, null, 2));

        const result = await provider.execute(providerRequest);
        console.log(`✅ ${providerName} completed:`, {
          status: result.status,
          responseTime: result.responseTime,
          cost: result.cost,
          hasContent: !!result.data?.content
        });

        // Enhanced logging for specific providers
        if (providerName === 'google-ai-overview') {
          console.log(`🔍 ${providerName} detailed result:`, {
            dataKeys: Object.keys(result.data || {}),
            contentField: result.data?.content,
            contentLength: result.data?.content?.length || 0,
            aiOverview: result.data?.aiOverview,
            hasAIOverview: result.data?.hasAIOverview,
            organicResultsCount: result.data?.organicResultsCount || 0
          });
        }

        if (providerName === 'perplexity') {
          console.log(`🔍 ${providerName} detailed result:`, {
            dataKeys: Object.keys(result.data || {}),
            content: result.data?.content?.substring(0, 200) + '...',
            contentLength: result.data?.content?.length || 0,
            hasCitations: !!result.data?.citations,
            citationsCount: result.data?.citations?.length || 0,
            realTimeData: result.data?.realTimeData
          });
        }

        return result;
      } catch (error) {
        console.error(`❌ ${providerName} execution failed:`, {
          error: (error as Error).message,
          stack: (error as Error).stack
        });
        return {
          providerId: providerName,
          requestId: request.id,
          status: 'error',
          error: (error as Error).message,
          responseTime: 0,
          cost: 0,
          timestamp: new Date(),
        };
      }
    });

    // Wait for all providers to complete. Rejections are impossible here
    // because each mapper catches and returns an error-shaped APIResponse.
    console.log('⏳ Waiting for all providers to complete...');
    const responses = await Promise.all(promises);
    results.push(...responses);

    // Calculate total cost
    const totalCost = results.reduce((sum, result) => sum + result.cost, 0);

    console.log('📊 All providers completed:', {
      totalResults: results.length,
      successfulResults: results.filter(r => r.status === 'success').length,
      totalCost,
      totalTime: Date.now() - startTime
    });
    
    // Log individual provider results for debugging
    results.forEach(result => {
      if (result.status === 'error') {
        console.error(`❌ ${result.providerId} FAILED:`, {
          error: result.error,
          responseTime: result.responseTime
        });
      } else {
        console.log(`✅ ${result.providerId} SUCCESS:`, {
          hasData: !!result.data,
          cost: result.cost,
          responseTime: result.responseTime
        });
      }
    });

    // Aggregate results (implement your business logic here)
    const aggregatedData = this.aggregateResults(results);

    return {
      requestId: request.id,
      results,
      aggregatedData,
      totalCost,
      completedAt: new Date(),
    };
  }

  private transformRequestForProvider(request: APIRequest, provider: BaseAPIProvider): any {
    const providerType = provider.getType();
    const providerName = provider.getName();

    // Pull locale / device overrides from the request's metadata bag. These
    // are optional; provider defaults apply when absent. Shape:
    //   metadata: { locationCode?: number; languageCode?: string;
    //               device?: string; os?: string }
    const md = request.metadata ?? {};
    const userId = request.userId;

    switch (providerName) {
      case 'chatgptsearch':
        return {
          input: request.prompt,
          model: 'gpt-4.1',
          temperature: 0.7,
          _userId: userId,
        };

      case 'perplexity':
        return {
          prompt: request.prompt,
          model: 'sonar-pro',
          temperature: 0.7,
          max_tokens: 1000,
          _userId: userId,
        };

      case 'google-ai-overview':
        // Only forward override fields when explicitly supplied on
        // metadata — the provider applies documented defaults itself.
        return {
          keyword: request.prompt,
          ...(md.locationCode !== undefined && { location_code: md.locationCode }),
          ...(md.languageCode !== undefined && { language_code: md.languageCode }),
          ...(md.device !== undefined && { device: md.device }),
          ...(md.os !== undefined && { os: md.os }),
          depth: 10,
          group_organic_results: true,
          load_async_ai_overview: true,
          people_also_ask_click_depth: 4,
          _userId: userId,
        };

      case 'google-gemini':
        return {
          contents: [{
            parts: [{ text: request.prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
          _userId: userId,
        };

      default:
        return { prompt: request.prompt, _userId: userId };
    }
  }

  private aggregateResults(results: APIResponse[]): any {
    const successfulResults = results.filter(r => r.status === 'success');
    
    if (successfulResults.length === 0) {
      return { error: 'All providers failed' };
    }

    // Simple aggregation - you can implement more sophisticated logic
    return {
      responses: successfulResults.map(r => ({
        provider: r.providerId,
        content: r.data?.content || '',
        confidence: this.calculateConfidence(r),
      })),
      consensus: this.findConsensus(successfulResults),
      averageResponseTime: results.reduce((sum, r) => sum + r.responseTime, 0) / results.length,
    };
  }

  private calculateConfidence(response: APIResponse): number {
    // Implement confidence scoring based on provider reliability, response time, etc.
    const baseConfidence = 0.8;
    const responseTimePenalty = Math.min(response.responseTime / 10000, 0.2); // Penalty for slow responses
    return Math.max(0, baseConfidence - responseTimePenalty);
  }

  private findConsensus(results: APIResponse[]): string {
    // Simple consensus - in production you'd use more sophisticated algorithms
    if (results.length === 0) return '';
    
    // For now, return the first successful response
    return results[0].data?.content || '';
  }

  // Get provider status
  async getProviderStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    
    const healthChecks = Array.from(this.providers.entries()).map(async ([name, provider]) => {
      try {
        status[name] = await provider.healthCheck();
      } catch {
        status[name] = false;
      }
    });

    await Promise.allSettled(healthChecks);
    return status;
  }

  // Get available providers
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  // Add new provider
  addProvider(name: string, provider: BaseAPIProvider): void {
    this.providers.set(name, provider);
  }

  // Remove provider
  removeProvider(name: string): boolean {
    return this.providers.delete(name);
  }
} 