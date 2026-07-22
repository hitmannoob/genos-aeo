import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, GeminiRequest, NormalizedCitation, parseDomain } from './types';
import {
  calculateGeminiCost,
  DEFAULT_GEMINI_MODEL,
  resolveGeminiPricePer1K,
} from './gemini-cost';

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

      const model = request.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
      const url = `${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
      
      const rawResponse = await this.retryRequest(async () => {
        return await this.makeRequest(url, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.config.apiKey },
          body: JSON.stringify({
            contents: request.contents,
            generationConfig: request.generationConfig,
          }),
        });
      });

      const transformedData = this.transformResponse(rawResponse);
      if (!transformedData.content.trim()) {
        throw new Error('Gemini returned an empty or blocked response');
      }
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

  protected calculateCost(rawResponse?: any, requestedModel = DEFAULT_GEMINI_MODEL): number {
    const responseModel = typeof rawResponse?.modelVersion === 'string'
      ? rawResponse.modelVersion
      : requestedModel;
    const price = resolveGeminiPricePer1K(
      responseModel,
      process.env.GEMINI_INPUT_PRICE_PER_1K,
      process.env.GEMINI_OUTPUT_PRICE_PER_1K,
    );
    return calculateGeminiCost(rawResponse?.usageMetadata, price);
  }

}
