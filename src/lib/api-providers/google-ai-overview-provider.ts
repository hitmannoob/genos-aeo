import { BaseAPIProvider } from './base-provider';
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

    console.log('🚨🚨🚨 GOOGLE AI OVERVIEW EXECUTE CALLED 🚨🚨🚨');
    console.log('Request:', JSON.stringify(request, null, 2));
    console.log('🚨🚨🚨 GOOGLE AI OVERVIEW EXECUTE START 🚨🚨🚨');

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
      // TODO: wire these to the authenticated user's profile (locale /
      // market preferences) so we pick the right region automatically.
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
        people_also_ask_click_depth: request.people_also_ask_click_depth ?? 4
      }];

      console.log('🔍 Google AI Overview Request Payload:', JSON.stringify(payload, null, 2));

      const response = await this.retryRequest(async () => {
        const fetchResponse = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        if (!fetchResponse.ok) {
          throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
        }

        const jsonResponse = await fetchResponse.json();
        
        // EXPLICIT RAW RESPONSE LOGGING
        console.log('🚨🚨🚨 DATAFORSEO RAW RESPONSE START 🚨🚨🚨');
        console.log(JSON.stringify(jsonResponse, null, 2));
        console.log('🚨🚨🚨 DATAFORSEO RAW RESPONSE END 🚨🚨🚨');
        
        return jsonResponse;
      });

      // Console log the complete raw response
      console.log('🌐 Google AI Overview Complete Raw Response:', JSON.stringify(response, null, 2));
      
      // Log specific parts for easier debugging
      console.log('📊 Google AI Overview Response Summary:', {
        status: response.status_code,
        statusMessage: response.status_message,
        tasksCount: response.tasks?.length || 0,
        hasResults: !!(response.tasks?.[0]?.result),
        resultsCount: response.tasks?.[0]?.result?.length || 0,
        cost: response.cost || 0
      });

      // Log the raw items array to see what's available
      const items = response.tasks?.[0]?.result?.[0]?.items || [];
      console.log('🔍 Raw Items Array:', JSON.stringify(items, null, 2));
      console.log('📝 Item Types Found:', items.map((item: any) => item.type));

      const transformedData = this.transformResponse(response);
      
      // Console log the transformed data
      console.log('✨ Google AI Overview Transformed Data:', JSON.stringify(transformedData, null, 2));
      
      // Log the content field specifically
      console.log('📄 Content Field Value:', {
        hasContent: !!transformedData.content,
        contentLength: transformedData.content?.length || 0,
        contentPreview: transformedData.content?.substring(0, 200) || 'No content',
        aiOverview: transformedData.aiOverview,
        hasAIOverview: transformedData.hasAIOverview
      });
      
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
      
      // Console log Google AI Overview errors
      console.error('❌ Google AI Overview Request Error:', {
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
    let aiOverview = null;
    let aiOverviewReferences = [];
    
    // Look for AI Overview content - type: "ai_overview" with markdown property
    const aiOverviewItems = items.filter((item: any) => item.type === 'ai_overview');
    if (aiOverviewItems.length > 0) {
      const aiOverviewItem = aiOverviewItems[0];
      if (aiOverviewItem.markdown) {
        aiOverview = aiOverviewItem.markdown;
        console.log('✅ Found AI Overview with markdown content:', aiOverview.substring(0, 200) + '...');
      } else if (aiOverviewItem.text) {
        aiOverview = aiOverviewItem.text;
        console.log('✅ Found AI Overview with text content:', aiOverview.substring(0, 200) + '...');
      } else {
        aiOverview = "AI Overview Present";
        console.log('✅ Found AI Overview item but no markdown/text content');
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
      console.log(`✅ Found ${aiOverviewReferences.length} AI Overview references:`, aiOverviewReferences);
    }
    
    // Simple AI Overview detection - check for "ai_overview" in item_types
    const rawResponseString = JSON.stringify(rawResponse);
    const hasAIOverviewInItemTypes = rawResponseString.includes('"item_types"') && 
                                     rawResponseString.includes('"ai_overview"');
    
    // Enhanced detection - check for actual AI Overview items
    const hasAIOverviewItems = aiOverviewItems.length > 0;
    const hasAIOverviewRefs = aiOverviewReferenceItems.length > 0;
    
    // Final determination
    const hasAIOverview = hasAIOverviewItems || hasAIOverviewInItemTypes;
    
    if (hasAIOverview) {
      console.log('✅ AI Overview detected:', {
        hasItems: hasAIOverviewItems,
        hasReferences: hasAIOverviewRefs,
        contentLength: aiOverview?.length || 0,
        referencesCount: aiOverviewReferences.length
      });
    } else {
      console.log('❌ No AI Overview detected');
    }
    
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
      
      // Raw response for browser console debugging
      rawDataForSEOResponse: rawResponse,
      
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
      
      // Raw response for debugging
      rawResponse: rawResponse
    };
  }

  // Build the canonical NormalizedCitation list from a raw DataForSEO AI Overview
  // response.
  //
  // Decision (2026-04): this includes both `ai_overview_reference` items
  // (genuine AI Overview citations) AND `organic` result URLs. The existing
  // citation-counting code downstream already treats organic results as
  // citations, so including them here keeps the migration behavior-compatible.
  // The `rawKind` field ('ai-overview-reference' vs 'organic-result') lets
  // later consumers filter organics out if/when product wants stricter counts.
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
      } else if (item.type === 'organic') {
        push(item.url, 'organic-result', item.title);
      }
    });

    return out;
  }

  protected calculateCost(response: any): number {
    // DataForSEO pricing - typically around $0.0001 per request
    // The actual cost is usually provided in the response
    return response.cost || 0.0001;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: GoogleAIOverviewRequest = {
        keyword: 'test search query',
        location_code: 2840,
        language_code: 'en',
        device: 'desktop'
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 