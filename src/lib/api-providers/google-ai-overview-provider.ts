import { BaseAPIProvider, ProviderHttpError } from './base-provider';
import { APIResponse, ProviderConfig, GoogleAIOverviewRequest, NormalizedCitation, parseDomain } from './types';

export class GoogleAIOverviewProvider extends BaseAPIProvider {
  private apiUrl: string;
  private authHeader: string;

  constructor(config: ProviderConfig & { 
    username?: string; 
    password?: string;
    authHeader?: string;
  }) {
    super('google-ai-overview', 'seo', config);
    this.apiUrl = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
    
    // Use provided auth header or create from username/password.
    // No hardcoded fallback: misconfiguration must fail loudly.
    if (config.authHeader) {
      this.authHeader = config.authHeader;
    } else if (config.username && config.password) {
      const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      this.authHeader = `Basic ${credentials}`;
    } else {
      throw new Error('GoogleAIOverviewProvider: authHeader or (username + password) must be provided');
    }
  }

  async execute(request: GoogleAIOverviewRequest & { _userId?: string }): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `google-ai-overview-${Date.now()}`;

    try {
      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      if (!(await this.checkRateLimit(request._userId))) {
        throw new Error('Rate limit exceeded for google-ai-overview provider');
      }

      // Defaults are applied here with explicit documentation. Callers may
      // override any field via the request object (wired through
      // ProviderManager from APIRequest.metadata).
      const payload = [{
        keyword: request.keyword,
        // Default DataForSEO location_code 2840 = United States.
        location_code: request.location_code ?? 2840,
        // Default language is English.
        language_code: request.language_code ?? 'en',
        // Default device is desktop (AI Overview coverage is widest here).
        device: request.device ?? 'desktop',
        // Default OS is Windows (most common desktop SERP profile).
        os: request.os ?? 'windows',
        depth: request.depth ?? 10,
        group_organic_results: request.group_organic_results ?? true,
        load_async_ai_overview: request.load_async_ai_overview ?? true,
        // People Also Ask expansion is a separately billed enrichment. Only
        // request it when a caller explicitly needs those expanded answers.
        ...(request.people_also_ask_click_depth !== undefined && {
          people_also_ask_click_depth: request.people_also_ask_click_depth,
        }),
      }];

      const response = await this.retryRequest(async () => {
        const fetchResponse = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.timeout),
        });

        if (!fetchResponse.ok) {
          throw new ProviderHttpError(fetchResponse.status);
        }

        const body = await fetchResponse.json();
        const topStatus = Number(body?.status_code);
        const task = body?.tasks?.[0];
        const taskStatus = Number(task?.status_code);
        if (topStatus !== 20_000 || taskStatus !== 20_000 || !Array.isArray(task?.result)) {
          throw new Error('DataForSEO returned an unsuccessful task response');
        }
        return body;
      });

      const transformedData = this.transformResponse(response);
      
      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(response);

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

  validateRequest(request: GoogleAIOverviewRequest): boolean {
    return !!(
      request.keyword &&
      typeof request.keyword === 'string' &&
      request.keyword.trim().length > 0
    );
  }

  transformResponse(rawResponse: any): any {
    const task = rawResponse.tasks?.[0];
    const result = task?.result?.[0];
    const items = result?.items || [];
    
    // Filter different types of results from the items array
    const organicResults = items.filter((item: any) => item.type === 'organic');
    const peopleAlsoAskResults = items.filter((item: any) => item.type === 'people_also_ask_element');
    const relatedSearchResults = items.filter((item: any) => item.type === 'related_searches');
    const videoResults = items.filter((item: any) => item.type === 'video');
    const peopleAlsoSearchResults = items.filter((item: any) => item.type === 'people_also_search');
    
    // Extract AI Overview content and references
    let aiOverview: string | null = null;
    let aiOverviewReferences: Array<{
      domain: string;
      url: string;
      title: string;
      text: string;
    }> = [];
    
    // Look for AI Overview content - type: "ai_overview" with markdown property
    const aiOverviewItems = items.filter((item: any) => item.type === 'ai_overview');
    if (aiOverviewItems.length > 0) {
      const aiOverviewItem = aiOverviewItems[0];
      if (aiOverviewItem.markdown) {
        aiOverview = aiOverviewItem.markdown;
      } else if (aiOverviewItem.text) {
        aiOverview = aiOverviewItem.text;
      }
    }
    
    // Look for AI Overview references - type: "ai_overview_reference" with domain and URL
    const aiOverviewReferenceItems = items.filter((item: any) => item.type === 'ai_overview_reference');
    if (aiOverviewReferenceItems.length > 0) {
      aiOverviewReferences = aiOverviewReferenceItems.map((item: any) => ({
        domain: item.domain || '',
        url: item.url || '',
        title: item.title || item.domain || '',
        text: item.text || item.title || item.domain || ''
      }));
    }
    
    // Simple AI Overview detection - check for "ai_overview" in item_types
    const hasAIOverviewInItemTypes = Array.isArray(result?.item_types)
      && result.item_types.includes('ai_overview');
    
    // Enhanced detection - check for actual AI Overview items
    const hasAIOverviewItems = aiOverviewItems.length > 0;
    // Final determination
    const hasAIOverview = hasAIOverviewItems || hasAIOverviewInItemTypes;
    
    return {
      status: rawResponse.status_code,
      statusMessage: rawResponse.status_message,
      keyword: task?.data?.keyword,
      location: task?.data?.location_name,
      language: task?.data?.language_name,
      device: task?.data?.device,

      // Content field for Provider Manager compatibility
      content: aiOverview || '',

      // Enhanced AI Overview data
      aiOverview: aiOverview,
      aiOverviewItems: aiOverviewItems,
      aiOverviewReferences: aiOverviewReferences,
      hasAIOverview: hasAIOverview,

      // Canonical normalized citation list for downstream aggregation
      normalizedCitations: GoogleAIOverviewProvider.extractNormalizedCitations(rawResponse),
      
      // Organic search results
      organicResults: organicResults,
      organicResultsCount: organicResults.length,
      
      // People Also Ask
      peopleAlsoAsk: peopleAlsoAskResults,
      peopleAlsoAskCount: peopleAlsoAskResults.length,
      
      // Related searches
      relatedSearches: relatedSearchResults,
      relatedSearchesCount: relatedSearchResults.length,
      
      // Video results
      videoResults: videoResults,
      videoResultsCount: videoResults.length,
      
      // People Also Search
      peopleAlsoSearch: peopleAlsoSearchResults,
      peopleAlsoSearchCount: peopleAlsoSearchResults.length,
      
      // SERP features
      serpFeatures: result?.features || [],
      
      // Summary counts
      totalItems: items.length,
      itemTypes: Array.from(new Set(items.map((item: any) => item.type))),
      
      // Metadata
      metadata: {
        searchEngineUrl: result?.se_domain,
        checkUrl: result?.check_url,
        datetime: result?.datetime,
        spellingChanges: result?.spell,
        totalResults: result?.total_count,
        timesTaken: result?.time_taken_displayed
      },
    };
  }

  // Build the canonical NormalizedCitation list from a raw DataForSEO AI Overview
  // response.
  //
  // Only AI Overview references are citations. Organic search results remain
  // available in `organicResults`, but counting them as AI citations inflates
  // the dashboard's visibility and citation metrics.
  static extractNormalizedCitations(rawResponse: any): NormalizedCitation[] {
    const items = rawResponse?.tasks?.[0]?.result?.[0]?.items || [];
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
        sourceProvider: 'google-ai-overview',
        rawKind,
      });
    };

    items.forEach((item: any) => {
      if (!item || typeof item !== 'object') return;
      if (item.type === 'ai_overview_reference') {
        push(item.url, 'ai-overview-reference', item.title || item.domain);
      }
    });

    return out;
  }

  protected calculateCost(response: any): number {
    const taskCosts = Array.isArray(response?.tasks)
      ? response.tasks.map((task: any) => Number(task?.cost ?? 0))
      : [];
    if (taskCosts.length > 0 && taskCosts.every((cost: number) => Number.isFinite(cost) && cost >= 0)) {
      return taskCosts.reduce((sum: number, cost: number) => sum + cost, 0);
    }
    const reportedCost = Number(response?.cost ?? 0);
    return Number.isFinite(reportedCost) && reportedCost >= 0 ? reportedCost : 0;
  }

}
