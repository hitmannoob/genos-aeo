import type { Citation } from './types';

export interface PerplexityData {
  response: string;
  citationsData?: string;
  searchResultsData?: string;
  structuredCitationsData?: string;
  citationsList?: any[];
  searchResults?: any[];
  structuredCitations?: any[];
  citationsCount?: number;
  searchResultsCount?: number;
  structuredCitationsCount?: number;
  realTimeData?: boolean;
  timestamp?: string;
  responseTime?: number;
}

export function extractPerplexityCitations(text: string, perplexityData?: PerplexityData): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();

  if (perplexityData?.citationsData && perplexityData.citationsData.trim()) {
    const citationUrls = perplexityData.citationsData.split('|||').filter(Boolean);
    citationUrls.forEach((citation: string, index: number) => {
      if (citation && citation.trim()) {
        const normalizedUrl = citation.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: normalizedUrl,
            source: 'Perplexity Citation',
            index: index + 1,
            type: 'structured'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }

  if (perplexityData?.searchResultsData && perplexityData.searchResultsData.trim()) {
    const searchResults = perplexityData.searchResultsData.split('###').filter(Boolean);
    searchResults.forEach((result: string, index: number) => {
      const [title, url] = result.split('|||');
      if (url && url.trim()) {
        const normalizedUrl = url.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: title || url,
            source: 'Perplexity Search Result',
            index: index + 1,
            type: 'search_result',
            title: title || ''
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }

  if (perplexityData?.structuredCitationsData && perplexityData.structuredCitationsData.trim()) {
    const structuredCitations = perplexityData.structuredCitationsData.split('|||').filter(Boolean);
    structuredCitations.forEach((citation: string, index: number) => {
      if (citation && citation.trim()) {
        const normalizedUrl = citation.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: normalizedUrl,
            source: 'Perplexity Structured Citation',
            index: index + 1,
            type: 'structured'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }

  if (perplexityData?.citationsList && Array.isArray(perplexityData.citationsList)) {
    perplexityData.citationsList.forEach((citation: any, index: number) => {
      if (citation.url && citation.url.trim()) {
        const normalizedUrl = citation.url.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: citation.text || citation.title || normalizedUrl,
            source: citation.source || 'Perplexity Citation',
            index: index + 1,
            type: 'legacy'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }

  if (text && citations.length === 0) {
    const googleSearchPattern = /https:\/\/www\.google\.com\/search\?[^\s<>"{}|\\^`[\]]+/g;
    const googleSearchUrls = text.match(googleSearchPattern) || [];
    googleSearchUrls.forEach((url, index) => {
      if (url && url.trim() && !seen.has(url)) {
        citations.push({
          text: 'Google Search',
          url: url.trim(),
          source: 'Google Search',
          index: index + 1,
          type: 'text_extraction'
        });
        seen.add(url);
      }
    });

    const markdownLinks = text.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
    markdownLinks.forEach((link, index) => {
      const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match && !seen.has(match[2])) {
        citations.push({
          text: match[1],
          url: match[2],
          index: index + 1,
          type: 'markdown_link'
        });
        seen.add(match[2]);
      }
    });

    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const urls = text.match(urlRegex) || [];
    urls.forEach((url, index) => {
      if (!seen.has(url)) {
        citations.push({
          text: url,
          url,
          index: index + 1,
          type: 'plain_url'
        });
        seen.add(url);
      }
    });

    const domainPattern = /\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/g;
    let domainMatch;
    while ((domainMatch = domainPattern.exec(text)) !== null) {
      const domain = domainMatch[1];
      const url = `https://${domain}`;
      if (!seen.has(url)) {
        citations.push({
          text: domain,
          url,
          type: 'domain_reference'
        });
        seen.add(url);
      }
    }
  }

  // First citation is intentionally dropped — Perplexity duplicates the lead source.
  const filteredCitations = citations.length > 0 ? citations.slice(1) : citations;

  return filteredCitations;
}
