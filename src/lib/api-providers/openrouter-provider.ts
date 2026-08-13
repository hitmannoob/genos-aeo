import { BaseAPIProvider, ProviderHttpError } from './base-provider';
import type {
  APIResponse,
  NormalizedCitation,
  ProviderConfig,
} from './types';
import { parseDomain } from './types';
import { resolveCitationDomain } from '@/lib/citations/domain';

type GenosProviderId = 'chatgptsearch' | 'google-ai-overview' | 'perplexity';

interface OpenRouterAnnotation {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      annotations?: OpenRouterAnnotation[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    server_tool_use?: {
      web_search_requests?: number;
    };
  };
  error?: {
    message?: string;
  };
}

interface OpenRouterRequest {
  prompt: string;
  temperature?: number;
  max_tokens?: number;
  webSearch?: boolean;
  _userId?: string;
}

interface CitationRecord {
  url: string;
  title?: string;
  content?: string;
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterProvider extends BaseAPIProvider {
  constructor(
    private readonly providerId: GenosProviderId,
    private readonly model: string,
    config: ProviderConfig,
  ) {
    super(providerId, 'ai', config);
  }

  async execute(request: OpenRouterRequest): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `${this.providerId}-${Date.now()}`;

    try {
      if (!this.config.apiKey.trim()) {
        throw new Error('OpenRouter API key is not configured');
      }
      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }
      if (!(await this.checkRateLimit(request._userId))) {
        throw new Error(`Rate limit exceeded for ${this.providerId} provider`);
      }

      const rawResponse = await this.retryRequest(async () => {
        const response = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
            'X-Title': 'Genos',
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              {
                role: 'system',
                content: 'Answer the user accurately. Use current web sources and preserve source attribution.',
              },
              {
                role: 'user',
                content: request.prompt,
              },
            ],
            temperature: request.temperature ?? 0.7,
            max_tokens: request.max_tokens ?? 1_500,
            stream: false,
            ...(request.webSearch !== false && this.providerId !== 'perplexity' && {
              tools: [{
                type: 'openrouter:web_search',
                parameters: {
                  engine: 'auto',
                  max_results: 8,
                },
              }],
            }),
          }),
          signal: AbortSignal.timeout(this.config.timeout),
        });

        const payload = await response.json().catch(() => null) as OpenRouterResponse | null;
        if (!response.ok) {
          throw new ProviderHttpError(
            response.status,
            payload?.error?.message || `OpenRouter request failed with HTTP ${response.status}`,
          );
        }
        if (!payload) throw new Error('OpenRouter returned an empty response');
        return payload;
      });

      const data = this.transformResponse(rawResponse);
      if (typeof data.content !== 'string' || !data.content.trim()) {
        throw new Error('OpenRouter returned an empty response');
      }

      return {
        providerId: this.providerId,
        requestId,
        status: 'success',
        data,
        responseTime: Date.now() - startTime,
        cost: this.calculateCost(rawResponse),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        providerId: this.providerId,
        requestId,
        status: 'error',
        error: error instanceof Error ? error.message : 'OpenRouter request failed',
        responseTime: Date.now() - startTime,
        cost: 0,
        timestamp: new Date(),
      };
    }
  }

  validateRequest(request: OpenRouterRequest): boolean {
    return typeof request.prompt === 'string' && request.prompt.trim().length > 0;
  }

  transformResponse(rawResponse: OpenRouterResponse): Record<string, unknown> {
    const choice = rawResponse.choices?.[0];
    const content = choice?.message?.content || '';
    const annotations = Array.isArray(choice?.message?.annotations)
      ? choice.message.annotations
      : [];
    const citations = OpenRouterProvider.collectCitations(annotations);
    const normalizedCitations = this.normalizeCitations(citations);
    const webSearchRequests = Number(
      rawResponse.usage?.server_tool_use?.web_search_requests ?? 0
    );

    const common = {
      content,
      model: rawResponse.model || this.model,
      usage: rawResponse.usage,
      finish_reason: choice?.finish_reason || 'unknown',
      normalizedCitations,
      metadata: {
        id: rawResponse.id,
        provider: this.providerId,
        routedThrough: 'openrouter',
      },
    };

    if (this.providerId === 'chatgptsearch') {
      return {
        ...common,
        searchEnabled: true,
        webSearchUsed: webSearchRequests > 0 || citations.length > 0,
        webSearchCallCount: webSearchRequests,
        tools: ['openrouter:web_search'],
        annotations: citations.map((citation) => ({
          type: 'url_citation',
          url: citation.url,
          title: citation.title,
        })),
        annotationsCount: citations.length,
      };
    }

    if (this.providerId === 'perplexity') {
      return {
        ...common,
        citations: citations.map((citation, index) => ({
          url: citation.url,
          text: citation.title || citation.url,
          source: 'Perplexity via OpenRouter',
          index: index + 1,
          type: 'url_citation',
        })),
        structuredCitations: citations,
        searchResults: citations.map((citation) => ({
          url: citation.url,
          title: citation.title || citation.url,
        })),
        webSearchEnabled: true,
        realTimeData: true,
      };
    }

    return {
      ...common,
      aiOverview: content,
      aiOverviewReferences: normalizedCitations.map((citation) => ({
        url: citation.url,
        title: citation.title || citation.domain,
        domain: citation.domain,
      })),
      totalItems: normalizedCitations.length,
      organicResultsCount: normalizedCitations.length,
      peopleAlsoAskCount: 0,
      location: 'OpenRouter web search',
      hasAIOverview: content.trim().length > 0,
    };
  }

  private static collectCitations(annotations: OpenRouterAnnotation[]): CitationRecord[] {
    const seen = new Set<string>();
    const citations: CitationRecord[] = [];

    for (const annotation of annotations) {
      if (annotation?.type !== 'url_citation') continue;
      const citation = annotation.url_citation;
      const url = citation?.url?.trim();
      if (!url || !parseDomain(url) || seen.has(url)) continue;
      seen.add(url);
      citations.push({
        url,
        title: citation?.title?.trim() || undefined,
        content: citation?.content?.trim() || undefined,
      });
    }

    return citations;
  }

  private normalizeCitations(citations: CitationRecord[]): NormalizedCitation[] {
    const sourceProvider = this.providerId === 'chatgptsearch'
      ? 'chatgpt'
      : this.providerId === 'google-ai-overview'
        ? 'google-ai-overview'
        : 'perplexity';

    return citations.flatMap((citation) => {
      const domain = resolveCitationDomain(citation);
      if (!domain) return [];
      return [{
        url: citation.url,
        domain,
        title: citation.title,
        sourceProvider,
        rawKind: 'url_citation',
      }];
    });
  }

  protected calculateCost(rawResponse?: OpenRouterResponse): number {
    const cost = Number(rawResponse?.usage?.cost ?? 0);
    return Number.isFinite(cost) && cost >= 0 ? cost : 0;
  }
}
