import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, ChatGPTSearchRequest, NormalizedCitation, parseDomain } from './types';
import OpenAI from 'openai';
import type { Response as OpenAIResponse, ResponseUsage } from 'openai/resources/responses/responses';
import { calculateOpenAICost } from './openai-cost';

interface OpenAIAnnotation {
  type?: string;
  url?: string;
  title?: string;
  source?: {
    url?: string;
    title?: string;
  };
}

interface ChatGPTSearchData {
  content: string;
  model: string;
  usage: ResponseUsage | undefined;
  searchEnabled: boolean;
  webSearchUsed: boolean;
  webSearchCallCount: number;
  tools: string[];
  annotations: OpenAIAnnotation[];
  annotationsCount: number;
  normalizedCitations: NormalizedCitation[];
  metadata: {
    hasAnnotations: boolean;
    responseId: string;
    createdAt: number;
    object: string;
  };
}

export class ChatGPTSearchProvider extends BaseAPIProvider {
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    super('chatgptsearch', 'ai', config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout,
      maxRetries: 0,
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
        const webSearch = request.webSearch !== false;
        return await this.client.responses.create({
          model: request.model || "gpt-5.4-mini",
          ...(webSearch && {
            tools: [{ type: "web_search" as const }],
            tool_choice: "required" as const,
            // Keep a single request bounded while still allowing the model to
            // search, open a result, and inspect a page when needed.
            max_tool_calls: 3,
          }),
          input: request.input,
          max_output_tokens: request.max_tokens,
        });
      });

      const transformedData = this.transformResponse(response, request.webSearch !== false);
      if (!transformedData.content.trim()) {
        throw new Error('OpenAI returned an empty response');
      }
      
      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(response.usage, transformedData.webSearchCallCount);

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

  transformResponse(rawResponse: OpenAIResponse, searchEnabled = true): ChatGPTSearchData {
    const annotations = ChatGPTSearchProvider.collectAnnotations(rawResponse);
    const webSearchCallCount = ChatGPTSearchProvider.countWebSearchCalls(rawResponse, annotations);

    return {
      content: rawResponse.output_text || '',
      model: rawResponse.model || 'gpt-5.4-mini',
      usage: rawResponse.usage,
      searchEnabled,
      webSearchUsed: webSearchCallCount > 0,
      webSearchCallCount,
      tools: searchEnabled ? ['web_search'] : [],
      // Include annotations (sources, citations, etc.)
      annotations,
      annotationsCount: annotations.length,
      // Canonical normalized citation list for downstream aggregation
      normalizedCitations: ChatGPTSearchProvider.extractNormalizedCitations(rawResponse),
      // Include any other metadata
      metadata: {
        hasAnnotations: annotations.length > 0,
        responseId: rawResponse.id,
        createdAt: rawResponse.created_at,
        object: rawResponse.object,
      },
    };
  }

  // Bill each web-search output item. If a legacy response omits tool-call
  // items but includes URL citations, conservatively count one search.
  private static countWebSearchCalls(
    rawResponse: OpenAIResponse,
    annotations: OpenAIAnnotation[],
  ): number {
    const callCount = rawResponse.output.filter((item) => item.type === 'web_search_call').length;
    if (callCount > 0) return callCount;

    const hasCitation = annotations.some((annotation) => {
      const type = annotation.type?.toLowerCase() ?? '';
      return type === 'url_citation' || type.includes('citation') || type.includes('url');
    });
    return hasCitation ? 1 : 0;
  }

  // OpenAI's responses API nests annotations under each output item's content
  // parts. Older/flat-shape responses also put them at `response.annotations`.
  // Gather both so downstream callers don't need to care where they lived.
  private static collectAnnotations(rawResponse: OpenAIResponse): OpenAIAnnotation[] {
    const annotations: OpenAIAnnotation[] = [];
    rawResponse.output.forEach((item) => {
      if (item.type !== 'message') return;
      item.content.forEach((part) => {
        if (part.type === 'output_text') annotations.push(...part.annotations);
      });
    });
    return annotations;
  }

  // Build the canonical NormalizedCitation list from a raw ChatGPT Search response.
  // Maps each annotation whose `type` indicates a URL citation
  // (`url_citation` in OpenAI's responses API) into a NormalizedCitation.
  static extractNormalizedCitations(rawResponse: OpenAIResponse): NormalizedCitation[] {
    const annotations = ChatGPTSearchProvider.collectAnnotations(rawResponse);
    const out: NormalizedCitation[] = [];
    const seen = new Set<string>();

    annotations.forEach((ann) => {
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

  protected calculateCost(usage?: ResponseUsage, webSearchCallCount = 0): number {
    // Standard-tier gpt-5.4-mini pricing is expressed per one million
    // tokens. Environment overrides keep this auditable when pricing changes.
    const readRate = (value: string | undefined, fallback: number) => {
      const parsed = value === undefined ? fallback : Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return calculateOpenAICost(usage, webSearchCallCount, {
      inputPerMillion: readRate(process.env.OPENAI_INPUT_PRICE_PER_MILLION, 0.75),
      cachedInputPerMillion: readRate(process.env.OPENAI_CACHED_INPUT_PRICE_PER_MILLION, 0.075),
      outputPerMillion: readRate(process.env.OPENAI_OUTPUT_PRICE_PER_MILLION, 4.5),
      webSearchPerCall: readRate(process.env.OPENAI_WEB_SEARCH_PRICE_PER_CALL, 0.01),
    });
  }

}
