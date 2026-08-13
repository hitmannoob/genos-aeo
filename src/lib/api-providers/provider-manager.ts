import { BaseAPIProvider } from './base-provider';
import { createHash } from 'node:crypto';
import { OpenRouterProvider } from './openrouter-provider';
import {
  APIRequest,
  APIResponse,
  JobResult,
  type ProviderConfig,
} from './types';
import {
  buildProviderResponseCacheKey,
  getCachedProviderResponse,
  setCachedProviderResponse,
} from '@/lib/cache/providerResponseCache';
import { logger } from '@/lib/logger';

type OpenRouterProviderName = 'chatgptsearch' | 'google-ai-overview' | 'perplexity';

interface OpenRouterProviderConfig extends ProviderConfig {
  name: OpenRouterProviderName;
  model: string;
}

export class ProviderManager {
  private providers: Map<string, BaseAPIProvider> = new Map();
  private activeJobs: Map<string, Promise<JobResult>> = new Map();

  constructor(private readonly openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || '') {
    this.initializeProviders();
  }

  private initializeProviders() {
    // Initialize providers from environment variables or config
    const providers = this.getProviderConfigs();
    
    providers.forEach(config => {
      const provider = new OpenRouterProvider(config.name, config.model, config);
      
      this.providers.set(config.name, provider);
    });
  }

  private getProviderConfigs(): OpenRouterProviderConfig[] {
    if (!this.openRouterApiKey) return [];

    return [
      {
        name: 'chatgptsearch',
        model: process.env.OPENROUTER_OPENAI_MODEL || 'openai/gpt-5.4-mini',
        apiKey: this.openRouterApiKey,
        timeout: 45_000,
        retryAttempts: 3,
      },
      {
        name: 'google-ai-overview',
        model: process.env.OPENROUTER_GOOGLE_MODEL || 'google/gemini-3.1-flash-lite',
        apiKey: this.openRouterApiKey,
        timeout: 45_000,
        retryAttempts: 3,
      },
      {
        name: 'perplexity',
        model: process.env.OPENROUTER_PERPLEXITY_MODEL || 'perplexity/sonar-pro',
        apiKey: this.openRouterApiKey,
        timeout: 45_000,
        retryAttempts: 3,
      },
    ];
  }

  // Execute request across multiple providers
  async executeRequest(request: APIRequest): Promise<JobResult> {
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({
        prompt: request.prompt,
        providers: request.providers,
        metadata: request.metadata ?? {},
      }))
      .digest('hex');
    const jobId = `${request.userId}:${request.id}:${requestFingerprint}`;
    
    // Check if job is already running
    if (this.activeJobs.has(jobId)) {
      return this.activeJobs.get(jobId)!;
    }

    const jobPromise = this.processRequestWithCache(request);
    this.activeJobs.set(jobId, jobPromise);

    try {
      const result = await jobPromise;
      return result;
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private getProviderNamesForRequest(request: APIRequest): string[] {
    return request.providers.length > 0
      ? request.providers
      : Array.from(this.providers.keys());
  }

  private remapCachedResult(request: APIRequest, cached: JobResult): JobResult {
    return {
      ...cached,
      requestId: request.id,
      cacheHit: true,
      totalCost: 0,
      results: cached.results.map((result) => ({
        ...result,
        requestId: request.id,
        cacheHit: true,
        cost: 0,
        timestamp: result.timestamp instanceof Date
          ? result.timestamp
          : new Date(result.timestamp),
      })),
      completedAt: cached.completedAt instanceof Date
        ? cached.completedAt
        : new Date(cached.completedAt),
    };
  }

  private async processRequestWithCache(request: APIRequest): Promise<JobResult> {
    const providerNames = this.getProviderNamesForRequest(request);
    const cacheTtlMs = request.metadata?.cacheTtlMs;
    const cacheDisabled = cacheTtlMs === 0 || request.metadata?.cache === false;

    if (!cacheDisabled) {
      const cacheKey = buildProviderResponseCacheKey({
        prompt: request.prompt,
        providers: providerNames,
        purpose: request.metadata?.type,
        variant: {
          locationCode: request.metadata?.locationCode,
          languageCode: request.metadata?.languageCode,
          device: request.metadata?.device,
          os: request.metadata?.os,
          webSearch: request.metadata?.webSearch,
          temperature: request.metadata?.temperature,
          maxTokens: request.metadata?.maxTokens,
          cacheScope: request.userId,
          chatgptModel: process.env.OPENROUTER_OPENAI_MODEL || 'openai/gpt-5.4-mini',
          perplexityModel: process.env.OPENROUTER_PERPLEXITY_MODEL || 'perplexity/sonar-pro',
          geminiModel: process.env.OPENROUTER_GOOGLE_MODEL || 'google/gemini-3.1-flash-lite',
        },
      });
      let cached: JobResult | null = null;
      try {
        cached = await getCachedProviderResponse(cacheKey);
      } catch (error) {
        logger.warn('Provider cache read failed', error);
      }
      if (cached) {
        return this.remapCachedResult(request, cached);
      }

      const result = await this.processRequest(request);
      const allSucceeded = result.results.length === providerNames.length
        && result.results.every((providerResult) => providerResult.status === 'success');
      if (allSucceeded) {
        try {
          await setCachedProviderResponse(
            cacheKey,
            result,
            typeof cacheTtlMs === 'number' ? cacheTtlMs : undefined,
            typeof request.metadata?.type === 'string' ? request.metadata.type : 'default'
          );
        } catch (error) {
          logger.warn('Provider cache write failed', error);
        }
      }
      return result;
    }

    return this.processRequest(request);
  }

  private async processRequest(request: APIRequest): Promise<JobResult> {
    const results: APIResponse[] = [];
    
    // Get requested providers or use all available
    const providerNames = this.getProviderNamesForRequest(request);

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

        const result = await provider.execute(providerRequest);
        return result;
      } catch (error) {
        logger.error(`Provider ${providerName} execution failed`, error);
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

    const responses = await Promise.all(promises);
    results.push(...responses);

    // Calculate total cost
    const totalCost = results.reduce((sum, result) => sum + result.cost, 0);

    return {
      requestId: request.id,
      results,
      totalCost,
      completedAt: new Date(),
    };
  }

  private transformRequestForProvider(request: APIRequest, provider: BaseAPIProvider): any {
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
          prompt: request.prompt,
          temperature: typeof md.temperature === 'number' ? md.temperature : 0.7,
          max_tokens: typeof md.maxTokens === 'number' ? md.maxTokens : 1_500,
          webSearch: md.webSearch !== false,
          _userId: userId,
        };

      case 'perplexity':
        return {
          prompt: request.prompt,
          temperature: typeof md.temperature === 'number' ? md.temperature : 0.7,
          max_tokens: typeof md.maxTokens === 'number' ? md.maxTokens : 1_500,
          webSearch: md.webSearch !== false,
          _userId: userId,
        };

      case 'google-ai-overview':
        return {
          prompt: request.prompt,
          temperature: typeof md.temperature === 'number' ? md.temperature : 0.7,
          max_tokens: typeof md.maxTokens === 'number' ? md.maxTokens : 1_500,
          webSearch: md.webSearch !== false,
          _userId: userId,
        };

      default:
        return { prompt: request.prompt, _userId: userId };
    }
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
