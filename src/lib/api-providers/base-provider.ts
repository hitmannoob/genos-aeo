import { APIResponse, ProviderConfig } from './types';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';
import { logger } from '@/lib/logger';

// Sentinel userId used when no per-user identity is provided. All such
// callers share a single "global" bucket — convenient for health checks
// and test endpoints, but callers that represent real user traffic should
// pass the actual userId so limits are enforced per user.
const GLOBAL_BUCKET_KEY = '__global__';

export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    message = `Provider request failed with HTTP ${status}`
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export abstract class BaseAPIProvider {
  protected config: ProviderConfig;
  protected name: string;
  protected type: 'ai' | 'seo' | 'data' | 'analytics';

  // Rate-limit configuration. Default: 20 requests / 60 seconds / user.
  private readonly rateLimitPerMinute: number;

  constructor(
    name: string,
    type: 'ai' | 'seo' | 'data' | 'analytics',
    config: ProviderConfig,
    options: { rateLimitPerMinute?: number } = {}
  ) {
    this.name = name;
    this.type = type;
    this.config = config;

    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 20;
  }

  // Abstract methods that each provider must implement
  abstract execute(request: any): Promise<APIResponse>;
  abstract validateRequest(request: any): boolean;
  abstract transformResponse(rawResponse: any): any;

  // Common methods available to all providers
  protected async makeRequest(url: string, options: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...this.config.customHeaders,
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new ProviderHttpError(response.status);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  protected async retryRequest(
    requestFn: () => Promise<any>,
    maxRetries: number = this.config.retryAttempts
  ): Promise<any> {
    let lastError: Error;
    const maxAttempts = Math.max(1, Math.floor(maxRetries));

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as Error;

        const status = error instanceof ProviderHttpError ? error.status : undefined;
        const isRetryable = status === undefined
          || status === 408
          || status === 409
          || status === 425
          || status === 429
          || status >= 500;
        if (!isRetryable) throw lastError;

        if (attempt < maxAttempts) {
          const delay = Math.min(8_000, (2 ** (attempt - 1)) * 1_000);
          const jitter = Math.floor(Math.random() * 250);
          await new Promise(resolve => setTimeout(resolve, delay + jitter));
        }
      }
    }

    throw lastError!;
  }

  // Per-user provider rate limiter. Backed by the rate_limit_buckets SQLite
  // table so serverless instance count does not multiply effective limits.
  protected async checkRateLimit(userId?: string): Promise<boolean> {
    const key = userId && userId.trim() !== '' ? userId : GLOBAL_BUCKET_KEY;
    try {
      const result = await consumeRateLimit({
        bucketId: `provider:${this.name}:user:${key}`,
        limit: this.rateLimitPerMinute,
        windowMs: 60_000,
      });
      return result.allowed;
    } catch (error) {
      logger.error(`Provider rate-limit check failed for ${this.name}`, error);
      return false;
    }
  }

  // Cost calculation — providers override this with whatever signature makes
  // sense for their API (token counts, raw response objects, etc.). The
  // default implementation returns a minimal flat fee.
  protected calculateCost(...args: any[]): number {
    void args;
    return 0;
  }

  // Getters
  getName(): string {
    return this.name;
  }

  getType(): string {
    return this.type;
  }
} 
