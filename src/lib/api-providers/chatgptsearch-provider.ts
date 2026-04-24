import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, ChatGPTSearchRequest, NormalizedCitation, parseDomain } from './types';
import OpenAI from 'openai';

export class ChatGPTSearchProvider extends BaseAPIProvider {
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    super('chatgptsearch', 'ai', config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async execute(request: ChatGPTSearchRequest & { _userId?: string }): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `chatgptsearch-${Date.now()}`;

    try {
      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      if (!(await this.checkRateLimit(request._userId))) {
        throw new Error('Rate limit exceeded for chatgptsearch provider');
      }

      const response = await this.retryRequest(async () => {
        return await this.client.responses.create({
          model: request.model || "gpt-5.4-mini",
          tools: [{ type: "web_search_preview" }],
          input: request.input,
          temperature: request.temperature,
          // Note: max_tokens might not be available in responses API
          // max_tokens: request.max_tokens,
        });
      });

      // Console log the complete raw response from ChatGPT Search
      console.log('🔍 ChatGPT Search Complete Raw Response:', JSON.stringify(response, null, 2));
      
      // Log specific parts for easier debugging
      console.log('🌐 ChatGPT Search Response Summary:', {
        model: response.model || 'gpt-5.4-mini',
        hasOutput: !!response.output_text,
        outputLength: response.output_text?.length || 0,
        preview: response.output_text?.substring(0, 200) + '...',
        usage: response.usage,
        hasAnnotations: !!response.annotations,
        annotationsCount: response.annotations?.length || 0,
        annotationsPreview: response.annotations?.slice(0, 3) || []
      });

      const transformedData = this.transformResponse(response);
      
      // Console log the transformed data
      console.log('✨ ChatGPT Search Transformed Data:', JSON.stringify(transformedData, null, 2));
      
      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(response.usage?.total_tokens);

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
      
      // Console log ChatGPT Search errors
      console.error('❌ ChatGPT Search Request Error:', {
        requestId,
        error: (error as Error).message,
        stack: (error as Error).stack,
        responseTime,
        request: JSON.stringify(request, null, 2)
      });
      
      return {
        providerId: this.name,
        requestId,
        status: 'error',
        error: (error as Error).message,
        responseTime,
        cost: 0,
        timestamp: new Date(),
      };
    }
  }

  validateRequest(request: ChatGPTSearchRequest): boolean {
    return !!(
      request.input &&
      typeof request.input === 'string' &&
      request.input.trim().length > 0
    );
  }

  transformResponse(rawResponse: any): any {
    const annotations = ChatGPTSearchProvider.collectAnnotations(rawResponse);

    return {
      content: rawResponse.output_text || '',
      model: rawResponse.model || 'gpt-5.4-mini',
      usage: rawResponse.usage,
      searchEnabled: true,
      webSearchUsed: true,
      tools: ['web_search_preview'],
      // Include annotations (sources, citations, etc.)
      annotations,
      annotationsCount: annotations.length,
      // Canonical normalized citation list for downstream aggregation
      normalizedCitations: ChatGPTSearchProvider.extractNormalizedCitations(rawResponse),
      // Include any other metadata
      metadata: {
        hasAnnotations: annotations.length > 0,
        responseId: rawResponse.id,
        created: rawResponse.created,
        object: rawResponse.object,
      },
      // Raw response for debugging (optional)
      rawResponse: rawResponse
    };
  }

  // OpenAI's responses API nests annotations under each output item's content
  // parts. Older/flat-shape responses also put them at `response.annotations`.
  // Gather both so downstream callers don't need to care where they lived.
  private static collectAnnotations(rawResponse: any): any[] {
    const annotations: any[] = [];
    if (Array.isArray(rawResponse?.annotations)) {
      annotations.push(...rawResponse.annotations);
    }
    const output = rawResponse?.output;
    if (Array.isArray(output)) {
      output.forEach((item: any) => {
        if (Array.isArray(item?.content)) {
          item.content.forEach((part: any) => {
            if (Array.isArray(part?.annotations)) {
              annotations.push(...part.annotations);
            }
          });
        }
        // Some shapes attach annotations directly on the item
        if (Array.isArray(item?.annotations)) {
          annotations.push(...item.annotations);
        }
      });
    }
    return annotations;
  }

  // Build the canonical NormalizedCitation list from a raw ChatGPT Search response.
  // Maps each annotation whose `type` indicates a URL citation
  // (`url_citation` in OpenAI's responses API) into a NormalizedCitation.
  static extractNormalizedCitations(rawResponse: any): NormalizedCitation[] {
    const annotations = ChatGPTSearchProvider.collectAnnotations(rawResponse);
    const out: NormalizedCitation[] = [];
    const seen = new Set<string>();

    annotations.forEach((ann: any) => {
      if (!ann || typeof ann !== 'object') return;
      // OpenAI responses API uses `url_citation`. Accept any type that carries
      // an explicit URL so schema drift between model versions doesn't silently
      // drop citations.
      const type = typeof ann.type === 'string' ? ann.type : '';
      const url: string | undefined = ann.url || ann.source?.url;
      if (!url) return;
      if (type && type !== 'url_citation' && !type.toLowerCase().includes('citation') && !type.toLowerCase().includes('url')) {
        return;
      }
      const domain = parseDomain(url);
      if (!domain) return;
      if (seen.has(url)) return;
      seen.add(url);
      out.push({
        url,
        domain,
        title: ann.title || ann.source?.title,
        sourceProvider: 'chatgpt',
        rawKind: 'annotation',
      });
    });

    return out;
  }

  protected calculateCost(tokensUsed: number = 0): number {
    // ChatGPT Search pricing (with web search premium)
    const baseCostPer1K = 0.002;  // Base cost per 1K tokens
    const webSearchPremium = 0.001; // Additional cost for web search
    
    return (tokensUsed / 1000) * (baseCostPer1K + webSearchPremium);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: ChatGPTSearchRequest = {
        input: 'What is the current weather?',
        model: 'gpt-5.4-mini',
        max_tokens: 50,
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 