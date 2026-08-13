import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rateLimit/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true })),
}));

import { OpenRouterProvider } from '@/lib/api-providers/openrouter-provider';
import {
  GOOGLE_GROUNDING_REDIRECT_DOMAIN,
  resolveCitationDomain,
} from '@/lib/citations/domain';
import { getStoredCitations } from '@/lib/queryResultUtils';

const providerConfig = {
  apiKey: 'test-openrouter-key',
  timeout: 1_000,
  retryAttempts: 1,
};

class TestOpenRouterProvider extends OpenRouterProvider {
  protected override async checkRateLimit(): Promise<boolean> {
    return true;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenRouter provider routing', () => {
  it('uses Perplexity Sonar native search without a server-tool payload', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        id: 'perplexity-response',
        model: 'perplexity/sonar-pro',
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'A sourced response.',
            annotations: [{
              type: 'url_citation',
              url_citation: {
                url: 'https://example.com/source',
                title: 'Example source',
              },
            }],
          },
        }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const provider = new TestOpenRouterProvider(
      'perplexity',
      'perplexity/sonar-pro',
      providerConfig,
    );

    const result = await provider.execute({ prompt: 'Find current sources.', webSearch: true });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(request.tools).toBeUndefined();
    expect(result.status).toBe('success');
    expect(result.data?.normalizedCitations).toEqual([
      expect.objectContaining({ url: 'https://example.com/source', domain: 'example.com' }),
    ]);
  });

  it('sends the web-search server tool to Google', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        choices: [{ message: { content: 'A grounded response.', annotations: [] } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const provider = new TestOpenRouterProvider(
      'google-ai-overview',
      'google/gemini-3.1-flash-lite',
      providerConfig,
    );

    await provider.execute({ prompt: 'Find current sources.', webSearch: true });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(request.tools).toEqual([
      expect.objectContaining({ type: 'openrouter:web_search' }),
    ]);
  });
});

describe('Google grounding citation domains', () => {
  const redirectUrl = `https://${GOOGLE_GROUNDING_REDIRECT_DOMAIN}/grounding-api-redirect/source-token`;

  it('uses the source label as the domain while retaining the redirect URL', () => {
    const provider = new OpenRouterProvider(
      'google-ai-overview',
      'google/gemini-3.1-flash-lite',
      providerConfig,
    );
    const transformed = provider.transformResponse({
      choices: [{
        message: {
          content: 'A grounded response.',
          annotations: [{
            type: 'url_citation',
            url_citation: { url: redirectUrl, title: 'nykaa.com' },
          }],
        },
      }],
    });

    expect(transformed.normalizedCitations).toEqual([
      expect.objectContaining({
        url: redirectUrl,
        domain: 'nykaa.com',
        sourceProvider: 'google-ai-overview',
      }),
    ]);
  });

  it('repairs stored redirect citations from their source label', () => {
    const citations = getStoredCitations({
      response: 'A grounded response.',
      timestamp: '2026-08-09T00:00:00.000Z',
      citationData: [{
        url: redirectUrl,
        text: 'nykaa.com',
        source: 'google-ai-overview',
        type: 'url_citation',
      }],
    });

    expect(citations).toEqual([{
      url: redirectUrl,
      text: 'nykaa.com',
      domain: 'nykaa.com',
      source: 'google-ai-overview',
      type: 'url_citation',
    }]);
  });

  it('does not treat an article title as a source domain', () => {
    expect(resolveCitationDomain({
      url: redirectUrl,
      title: 'The best natural body care products in India',
    })).toBeNull();
  });
});
