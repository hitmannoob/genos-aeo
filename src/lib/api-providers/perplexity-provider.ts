import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, PerplexityRequest, NormalizedCitation, parseDomain } from './types';

export class PerplexityProvider extends BaseAPIProvider {
  private apiKey: string;
  private apiUrl: string;

  constructor(config: ProviderConfig) {
    super('perplexity', 'ai', config);
    this.apiKey = config.apiKey;
    this.apiUrl = 'https://api.perplexity.ai/chat/completions';
  }

  async execute(request: PerplexityRequest & { _userId?: string }): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `perplexity-${Date.now()}`;

    try {
      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      if (!(await this.checkRateLimit(request._userId))) {
        throw new Error('Rate limit exceeded for perplexity provider');
      }

      const payload = {
        model: request.model || 'sonar',
        messages: request.messages || [
          {
            role: 'system',
            content: 'Be precise and concise. Provide current and accurate information with sources when available.'
          },
          {
            role: 'user',
            content: request.prompt || request.input || 'Please provide information on this topic.'
          }
        ],
        temperature: request.temperature || 0.7,
        max_tokens: request.max_tokens || 1000,
        top_p: request.top_p || 1,
        stream: false,
        presence_penalty: request.presence_penalty || 0,
        frequency_penalty: request.frequency_penalty || 0,
        // Experimental search parameters for better results
        ...(request.search_domain_filter && { search_domain_filter: request.search_domain_filter }),
        ...(request.search_recency_filter && { search_recency_filter: request.search_recency_filter }),
        ...(request.return_citations && { return_citations: request.return_citations }),
        ...(request.return_images && { return_images: request.return_images }),
        ...(request.return_related_questions && { return_related_questions: request.return_related_questions })
      };

      console.log('🔍 Perplexity Request Payload:', JSON.stringify(payload, null, 2));

      const response = await this.retryRequest(async () => {
        const fetchResponse = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(payload)
        });

        if (!fetchResponse.ok) {
          const errorText = await fetchResponse.text();
          throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText} - ${errorText}`);
        }

        return await fetchResponse.json();
      });

      // Enhanced console logging for Perplexity
      console.log('🚨🚨🚨 PERPLEXITY COMPLETE RAW RESPONSE 🚨🚨🚨');
      console.log(JSON.stringify(response, null, 2));
      console.log('🚨🚨🚨 PERPLEXITY RAW RESPONSE END 🚨🚨🚨');
      
      // Log specific parts for easier debugging
      console.log('🌐 Perplexity Response Summary:', {
        model: response.model || 'sonar-pro',
        hasChoices: !!response.choices,
        choicesCount: response.choices?.length || 0,
        hasContent: !!response.choices?.[0]?.message?.content,
        contentLength: response.choices?.[0]?.message?.content?.length || 0,
        contentPreview: response.choices?.[0]?.message?.content?.substring(0, 200) + '...',
        usage: response.usage,
        hasCitations: !!response.citations,
        citationsCount: response.citations?.length || 0,
        citations: response.citations || [],
        hasSearchResults: !!response.search_results,
        searchResultsCount: response.search_results?.length || 0,
        searchResults: response.search_results || []
      });

      const transformedData = this.transformResponse(response);
      
      // Console log the transformed data
      console.log('✨ Perplexity Transformed Data:', JSON.stringify(transformedData, null, 2));
      
      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(response);

      console.log('✅ Perplexity completed:', {
        status: 'success',
        responseTime,
        cost,
        hasContent: !!transformedData.content,
        citationsCount: transformedData.citations?.length || 0,
        searchResultsCount: transformedData.searchResults?.length || 0
      });

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
      
      console.error('❌ Perplexity Request Error:', {
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

  validateRequest(request: PerplexityRequest): boolean {
    return !!(
      (request.prompt || request.input || request.messages) &&
      (typeof request.prompt === 'string' || 
       typeof request.input === 'string' || 
       Array.isArray(request.messages))
    );
  }

  transformResponse(rawResponse: any): any {
    const choice = rawResponse.choices?.[0];
    const message = choice?.message;

    // Extract structured citations from the API response
    const structuredCitations = this.extractStructuredCitations(rawResponse);

    // Extract URLs that appear in body text. These are intentionally kept
    // separate from the canonical `citations` list because text-scraped URLs
    // are lower confidence. (Numeric bracket markers like "[1]" are dropped
    // here — they produce false positives such as "[1] million dollars".)
    const textOnlyUrls = this.extractTextUrls(message?.content || '');

    // Canonical normalized citation list for downstream aggregation
    const normalizedCitations = PerplexityProvider.extractNormalizedCitations(rawResponse);

    return {
      content: message?.content || '',
      model: rawResponse.model || 'sonar-pro',
      usage: {
        prompt_tokens: rawResponse.usage?.prompt_tokens || 0,
        completion_tokens: rawResponse.usage?.completion_tokens || 0,
        total_tokens: rawResponse.usage?.total_tokens || 0,
        search_context_size: rawResponse.usage?.search_context_size || '',
        citation_tokens: rawResponse.usage?.citation_tokens || 0,
        num_search_queries: rawResponse.usage?.num_search_queries || 0,
        reasoning_tokens: rawResponse.usage?.reasoning_tokens || 0
      },
      finish_reason: choice?.finish_reason || 'unknown',
      citations: structuredCitations,
      textOnlyUrls,
      normalizedCitations,
      searchResults: rawResponse.search_results || [],
      structuredCitations: rawResponse.citations || [],
      webSearchEnabled: true,
      realTimeData: true,
      metadata: {
        id: rawResponse.id,
        object: rawResponse.object,
        created: rawResponse.created,
        provider: 'perplexity',
        hasCitations: !!rawResponse.citations,
        hasSearchResults: !!rawResponse.search_results,
        citationsCount: rawResponse.citations?.length || 0,
        searchResultsCount: rawResponse.search_results?.length || 0
      },
      rawResponse: rawResponse
    };
  }

  // Build the canonical NormalizedCitation list from a raw Perplexity response.
  // Iterates `response.citations` (structured URLs) and `response.search_results`
  // only — text-body URLs and `[\d+]` bracket markers are intentionally excluded.
  static extractNormalizedCitations(rawResponse: any): NormalizedCitation[] {
    const out: NormalizedCitation[] = [];
    const seen = new Set<string>();

    const push = (url: string | undefined, rawKind: string, title?: string) => {
      if (!url || typeof url !== 'string') return;
      const domain = parseDomain(url);
      if (!domain) return;
      if (seen.has(url)) return;
      seen.add(url);
      out.push({
        url,
        domain,
        title,
        sourceProvider: 'perplexity',
        rawKind,
      });
    };

    if (Array.isArray(rawResponse?.citations)) {
      rawResponse.citations.forEach((c: any) => {
        // Perplexity ships `citations` as either string URLs or objects.
        if (typeof c === 'string') {
          push(c, 'structured');
        } else if (c && typeof c === 'object') {
          push(c.url, 'structured', c.title);
        }
      });
    }

    if (Array.isArray(rawResponse?.search_results)) {
      rawResponse.search_results.forEach((r: any) => {
        push(r?.url, 'search-result', r?.title);
      });
    }

    return out;
  }

  private extractStructuredCitations(rawResponse: any): any[] {
    const citations: any[] = [];
    
    // Extract from structured citations array
    if (rawResponse.citations && Array.isArray(rawResponse.citations)) {
      rawResponse.citations.forEach((citation: string, index: number) => {
        citations.push({
          url: citation,
          text: citation,
          source: 'Perplexity Citation',
          index: index + 1,
          type: 'structured'
        });
      });
    }
    
    // Extract from search_results array
    if (rawResponse.search_results && Array.isArray(rawResponse.search_results)) {
      rawResponse.search_results.forEach((result: any, index: number) => {
        citations.push({
          url: result.url || '',
          text: result.title || result.url || '',
          source: 'Perplexity Search Result',
          index: index + 1,
          type: 'search_result',
          title: result.title || '',
          date: result.date || ''
        });
      });
    }
    
    return citations;
  }

  // Extract plain URLs that appear in the response body. These are low-confidence
  // and intentionally not folded into the canonical `citations` list — callers
  // get them separately via `textOnlyUrls` on the transformed response.
  //
  // Note: the previous version also harvested bracketed numeric markers like
  // `[1]` from body text. That behavior was removed because it produced false
  // positives on tokens such as "[1] million dollars" — such tokens are NOT
  // URLs and should not be treated as citations.
  private extractTextUrls(content: string): Array<{ url: string; text: string }> {
    if (!content) return [];
    const urls = content.match(/https?:\/\/[^\s)]+/g);
    if (!urls) return [];
    const seen = new Set<string>();
    const out: Array<{ url: string; text: string }> = [];
    urls.forEach(url => {
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ url, text: url });
    });
    return out;
  }

  protected calculateCost(response: any): number {
    // Perplexity Sonar pricing (approximate)
    // Sonar models: ~$0.005 per 1K tokens
    const totalTokens = response.usage?.total_tokens || 0;
    const costPer1KTokens = 0.005;
    return (totalTokens / 1000) * costPer1KTokens;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: PerplexityRequest = {
        prompt: 'What is the current date?',
        model: 'sonar-pro',
        max_tokens: 50
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 