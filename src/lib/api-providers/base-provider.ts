import { APIResponse, ProviderConfig } from './types';
import { consumeRateLimit } from '@/lib/rateLimit/rateLimit';

// Sentinel userId used when no per-user identity is provided. All such
// callers share a single "global" bucket — convenient for health checks
// and test endpoints, but callers that represent real user traffic should
// pass the actual userId so limits are enforced per user.
const GLOBAL_BUCKET_KEY = '__global__';

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

export abstract class BaseAPIProvider {
  protected config: ProviderConfig;
  protected name: string;
  protected type: 'ai' | 'seo' | 'data' | 'analytics';

  // Rate-limit configuration. Default: 20 requests / 60 seconds / user.
  private readonly rateLimitPerMinute: number;
  private readonly rateLimitCapacity: number;
  private readonly rateLimitRefillPerMs: number;

  // Per-user token buckets. NOTE: this limiter is single-process and
  // in-memory only. If deployed to multiple instances (serverless, multiple
  // pods, etc.) each instance will keep its own bucket and the effective
  // limit multiplies by the instance count.
  // TODO: swap for a Redis (or Firestore-backed) limiter in production so
  // state is shared across instances.
  private readonly buckets: Map<string, TokenBucket> = new Map();

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
    this.rateLimitCapacity = this.rateLimitPerMinute;
    // Tokens per millisecond so we can do continuous refill on every check.
    this.rateLimitRefillPerMs = this.rateLimitPerMinute / 60_000;
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
        // Try to get detailed error message from response body
        let errorDetails = response.statusText;
        try {
          const errorBody = await response.text();
          if (errorBody) {
            try {
              const errorJson = JSON.parse(errorBody);
              errorDetails = errorJson.error?.message || errorJson.message || errorBody;
            } catch {
              errorDetails = errorBody.substring(0, 500); // Limit error message length
            }
          }
        } catch {
          // If we can't read the body, just use statusText
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorDetails}`);
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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  // Per-user provider rate limiter. Backed by the rate_limit_buckets Postgres
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
      console.error(`❌ Provider rate-limit check failed for ${this.name}:`, error);
      return false;
    }
  }

  // Cost calculation — providers override this with whatever signature makes
  // sense for their API (token counts, raw response objects, etc.). The
  // default implementation returns a minimal flat fee.
  protected calculateCost(...args: any[]): number {
    void args;
    return 0.001; // Default minimal cost
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // Each provider can override this for specific health checks
      return true;
    } catch {
      return false;
    }
  }

  // Getters
  getName(): string {
    return this.name;
  }

  getType(): string {
    return this.type;
  }
} 
