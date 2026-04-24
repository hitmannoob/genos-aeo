import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, GeminiRequest, NormalizedCitation, parseDomain } from './types';

export class GeminiProvider extends BaseAPIProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super('google-gemini', 'ai', config);
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async execute(request: GeminiRequest & { model?: string; _userId?: string }): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `gemini-${Date.now()}`;

    try {
      if (!this.config.apiKey || this.config.apiKey.trim() === '') {
        throw new Error('Google AI API key is not configured');
      }

      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      if (!(await this.checkRateLimit(request._userId))) {
        throw new Error('Rate limit exceeded for gemini provider');
      }

      const model = request.model || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
      const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.config.apiKey}`;
      
      console.log(`🚀 Gemini API Request:`, {
        url: url.replace(this.config.apiKey, '[API_KEY]'),
        model,
        contentsLength: request.contents?.length
      });
      
      const rawResponse = await this.retryRequest(async () => {
        return await this.makeRequest(url, {
          method: 'POST',
          body: JSON.stringify({
            contents: request.contents,
            generationConfig: request.generationConfig,
          }),
        });
      });

      console.log(`✅ Gemini API Response received:`, {
        hasCandidates: !!rawResponse.candidates,
        candidatesLength: rawResponse.candidates?.length
      });

      const transformedData = this.transformResponse(rawResponse);
      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(rawResponse, model);

      return {
        providerId: this.name,
        requestId,
        status: 'success',
        data: transformedData,
        responseTime,
        cost,
        timestamp: new Date(),
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = (error as Error).message;
      
      console.error(`❌ Gemini API Error:`, {
        error: errorMessage,
        responseTime,
        apiKeyConfigured: !!this.config.apiKey && this.config.apiKey.trim() !== ''
      });
      
      return {
        providerId: this.name,
        requestId,
        status: 'error',
        error: errorMessage,
        responseTime,
        cost: 0,
        timestamp: new Date(),
      };
    }
  }

  validateRequest(request: GeminiRequest): boolean {
    return !!(
      request.contents &&
      Array.isArray(request.contents) &&
      request.contents.length > 0 &&
      request.contents[0].parts &&
      Array.isArray(request.contents[0].parts)
    );
  }

  transformResponse(rawResponse: any): any {
    const candidate = rawResponse.candidates?.[0];
    return {
      content: candidate?.content?.parts?.[0]?.text || '',
      finishReason: candidate?.finishReason,
      safetyRatings: candidate?.safetyRatings,
      citationMetadata: candidate?.citationMetadata,
      // Canonical normalized citation list for downstream aggregation
      normalizedCitations: GeminiProvider.extractNormalizedCitations(rawResponse),
    };
  }

  // Build the canonical NormalizedCitation list from a raw Gemini response.
  // Gemini exposes a `citationMetadata.citationSources` array with `uri` fields
  // on candidates when grounded generation is used. If none are present (the
  // typical case for plain generateContent calls), returns an empty list.
  static extractNormalizedCitations(rawResponse: any): NormalizedCitation[] {
    const candidate = rawResponse?.candidates?.[0];
    const sources = candidate?.citationMetadata?.citationSources
      || candidate?.citationMetadata?.citations
      || [];

    if (!Array.isArray(sources) || sources.length === 0) return [];

    const out: NormalizedCitation[] = [];
    const seen = new Set<string>();

    sources.forEach((src: any) => {
      const url: string | undefined = src?.uri || src?.url;
      if (!url) return;
      const domain = parseDomain(url);
      if (!domain) return;
      if (seen.has(url)) return;
      seen.add(url);
      out.push({
        url,
        domain,
        title: src.title,
        sourceProvider: 'gemini',
        rawKind: 'metadata',
      });
    });

    return out;
  }

  // Flat-fee fallback used when the API doesn't return token counts
  // (some Gemini REST responses omit usageMetadata).
  private static readonly FLAT_FEE_FALLBACK = 0.0005;

  // Model -> { input, output } USD per 1K tokens.
  // Prices as of 2024; verify against current Gemini pricing before billing:
  // https://ai.google.dev/pricing
  // Overridable per-call via env vars GEMINI_INPUT_PRICE_PER_1K and
  // GEMINI_OUTPUT_PRICE_PER_1K (applies to all models).
  private static readonly PRICE_TABLE: Record<string, { input: number; output: number }> = {
    'gemini-1.5-flash':     { input: 0.000075, output: 0.0003 },
    'gemini-1.5-flash-8b':  { input: 0.0000375, output: 0.00015 },
    'gemini-1.5-pro':       { input: 0.00125,  output: 0.005 },
    'gemini-1.0-pro':       { input: 0.0005,   output: 0.0015 },
    'gemini-pro':           { input: 0.0005,   output: 0.0015 }, // alias
    'gemini-2.0-flash':     { input: 0.000075, output: 0.0003 },
  };

  private resolvePricePer1K(model: string): { input: number; output: number } {
    // Env var overrides win if set and parseable.
    const envInput = process.env.GEMINI_INPUT_PRICE_PER_1K;
    const envOutput = process.env.GEMINI_OUTPUT_PRICE_PER_1K;
    const envIn = envInput ? parseFloat(envInput) : NaN;
    const envOut = envOutput ? parseFloat(envOutput) : NaN;
    if (Number.isFinite(envIn) && Number.isFinite(envOut)) {
      return { input: envIn, output: envOut };
    }

    // Exact match first.
    if (GeminiProvider.PRICE_TABLE[model]) return GeminiProvider.PRICE_TABLE[model];

    // Prefix match for versioned models like "gemini-1.5-flash-002".
    const m = model.toLowerCase();
    for (const key of Object.keys(GeminiProvider.PRICE_TABLE)) {
      if (m.startsWith(key)) return GeminiProvider.PRICE_TABLE[key];
    }

    // Unknown model — fall back to flash pricing as a conservative default.
    return GeminiProvider.PRICE_TABLE['gemini-1.5-flash'];
  }

  protected calculateCost(rawResponse?: any, model?: string): number {
    // Gemini REST returns token counts in `usageMetadata` when available.
    const usage = rawResponse?.usageMetadata;
    const promptTokens =
      typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : undefined;
    const outputTokens =
      typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : undefined;

    if (promptTokens === undefined || outputTokens === undefined) {
      // Gemini REST API sometimes omits token counts; log a warning and
      // return the flat-fee fallback so billing doesn't silently go to $0.
      console.warn(
        '⚠️ Gemini cost: usageMetadata missing token counts; using flat-fee fallback',
        { model, hasUsage: !!usage }
      );
      return GeminiProvider.FLAT_FEE_FALLBACK;
    }

    const price = this.resolvePricePer1K(model || 'gemini-1.5-flash');
    return (promptTokens / 1000) * price.input + (outputTokens / 1000) * price.output;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: GeminiRequest = {
        contents: [{
          parts: [{ text: 'Hello' }]
        }]
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 