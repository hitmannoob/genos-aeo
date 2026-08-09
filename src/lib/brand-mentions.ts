import { matchCompetitorsInText, matchesWord, type Competitor } from '@/lib/competitor-matching';
import { resolveCitationDomain } from '@/lib/citations/domain';

interface Citation {
  url: string;
  text: string;
  domain?: string;
  source?: string;
}

interface BrandAnalysisResult {
  provider: 'chatgpt' | 'google' | 'perplexity';
  brandMentioned: boolean;
  domainCited: boolean;
  citationCount: number;
  citations: Citation[];
  brandMentionCount: number;
  domainCitationCount: number;
  competitorMentioned: boolean;
  competitorCited: boolean;
  competitorMentionCount: number;
  competitorCitationCount: number;
}

export interface BrandMentionAnalysis {
  brandName: string;
  brandDomain: string;
  competitors: string[];
  results: {
    chatgpt?: BrandAnalysisResult;
    google?: BrandAnalysisResult;
    perplexity?: BrandAnalysisResult;
  };
  totals: {
    totalCitations: number;
    totalBrandMentions: number;
    totalDomainCitations: number;
    totalCompetitorMentions: number;
    totalCompetitorCitations: number;
    providersWithBrandMention: number;
    providersWithDomainCitation: number;
    providersWithCompetitorMention: number;
    providersWithCompetitorCitation: number;
  };
}

function getHostname(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function normalizeDomainString(domain: string): string {
  if (!domain) return '';
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase()
    .trim();
}

// Apex or any subdomain. The leading-dot check on endsWith prevents
// "fake-acme.com" from matching "acme.com" while still allowing
// "help.acme.com" / "blog.acme.com" to count.
function hostMatches(url: string, domain: string): boolean {
  const host = getHostname(url);
  const normalizedDomain = normalizeDomainString(domain);
  if (!host || !normalizedDomain) return false;
  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
}

function citationMatchesDomain(citation: Citation, domain: string): boolean {
  const citationDomain = resolveCitationDomain(citation);
  const normalizedDomain = normalizeDomainString(domain);
  if (!citationDomain || !normalizedDomain) return false;
  return citationDomain === normalizedDomain || citationDomain.endsWith(`.${normalizedDomain}`);
}

// Brand vs. competitor detection uses the same matcher so SOV is symmetric.
function isBrandMentioned(text: string, brandName: string, brandDomain?: string): boolean {
  if (!text || !brandName) return false;
  const entity: Competitor = { name: brandName, domain: brandDomain };
  return matchCompetitorsInText(text, [entity]).length > 0;
}

// Extract URLs from the response text and check each one against the brand
// domain via hostMatches, so the boolean uses the same apex-or-subdomain
// definition as the citation-array count.
function isDomainCited(text: string, brandDomain: string): boolean {
  if (!text || !brandDomain) return false;
  const urls = text.match(/https?:\/\/[^\s<>"'`)\]]+/gi) || [];
  return urls.some((url) => hostMatches(url, brandDomain));
}

function countBrandMentions(text: string, brandName: string, brandDomain?: string): number {
  if (!text || !brandName) return 0;
  const entity: Competitor = { name: brandName, domain: brandDomain };
  return matchCompetitorsInText(text, [entity]).length;
}

// Strict hostname equality so "apple.com" doesn't match "pineapple.com".
function countDomainCitations(citations: Citation[], brandDomain: string): number {
  if (!brandDomain) return 0;
  return citations.filter(citation => citationMatchesDomain(citation, brandDomain)).length;
}

function areCompetitorsMentioned(text: string, competitors: string[]): boolean {
  if (!text || !competitors.length) return false;
  const competitorObjects: Competitor[] = competitors.map(name => ({ name }));
  const matches = matchCompetitorsInText(text, competitorObjects);
  return matches.length > 0;
}

function areCompetitorsCited(citations: Citation[], competitors: string[]): boolean {
  if (!citations || !competitors.length) return false;
  return citations.some(citation =>
    competitors.some(competitor => {
      if (!competitor) return false;
      const normalizedCompetitor = normalizeDomainString(competitor);
      const hostHit = normalizedCompetitor
        ? citationMatchesDomain(citation, normalizedCompetitor)
        : false;
      const textHit = matchesWord(citation.text || '', competitor);
      return hostHit || textHit;
    })
  );
}

function countCompetitorMentions(text: string, competitors: string[]): number {
  if (!text || !competitors.length) return 0;
  const competitorObjects: Competitor[] = competitors.map(name => ({ name }));
  const matches = matchCompetitorsInText(text, competitorObjects);
  return matches.length;
}

function countCompetitorCitations(citations: Citation[], competitors: string[]): number {
  if (!citations || !competitors.length) return 0;
  return citations.filter(citation =>
    competitors.some(competitor => {
      if (!competitor) return false;
      const normalizedCompetitor = normalizeDomainString(competitor);
      const hostHit = normalizedCompetitor
        ? citationMatchesDomain(citation, normalizedCompetitor)
        : false;
      const textHit = matchesWord(citation.text || '', competitor);
      return hostHit || textHit;
    })
  ).length;
}

export function analyzeBrandMentions(
  brandName: string,
  brandDomain: string,
  queryResults: {
    chatgpt?: { response: string; citations?: Citation[] };
    googleAI?: { aiOverview?: string; citations?: Citation[] };
    perplexity?: { response: string; citations?: Citation[] };
  },
  competitors: string[] = []
): BrandMentionAnalysis {
  const results: BrandMentionAnalysis['results'] = {};

  if (queryResults.chatgpt?.response) {
    const citations = queryResults.chatgpt.citations || [];
    const brandMentioned = isBrandMentioned(queryResults.chatgpt.response, brandName, brandDomain);
    const domainCited = isDomainCited(queryResults.chatgpt.response, brandDomain);
    const brandMentionCount = countBrandMentions(queryResults.chatgpt.response, brandName, brandDomain);
    const domainCitationCount = countDomainCitations(citations, brandDomain);

    const competitorMentioned = areCompetitorsMentioned(queryResults.chatgpt.response, competitors);
    const competitorCited = areCompetitorsCited(citations, competitors);
    const competitorMentionCount = countCompetitorMentions(queryResults.chatgpt.response, competitors);
    const competitorCitationCount = countCompetitorCitations(citations, competitors);

    results.chatgpt = {
      provider: 'chatgpt',
      brandMentioned,
      domainCited,
      citationCount: citations.length,
      citations,
      brandMentionCount,
      domainCitationCount,
      competitorMentioned,
      competitorCited,
      competitorMentionCount,
      competitorCitationCount
    };
  }

  if (queryResults.googleAI) {
    const aiOverviewText = queryResults.googleAI.aiOverview || '';
    const citations = queryResults.googleAI.citations || [];
    const brandMentioned = isBrandMentioned(aiOverviewText, brandName, brandDomain);
    const domainCited = isDomainCited(aiOverviewText, brandDomain);
    const brandMentionCount = countBrandMentions(aiOverviewText, brandName, brandDomain);
    const domainCitationCount = countDomainCitations(citations, brandDomain);

    const competitorMentioned = areCompetitorsMentioned(aiOverviewText, competitors);
    const competitorCited = areCompetitorsCited(citations, competitors);
    const competitorMentionCount = countCompetitorMentions(aiOverviewText, competitors);
    const competitorCitationCount = countCompetitorCitations(citations, competitors);

    results.google = {
      provider: 'google',
      brandMentioned,
      domainCited,
      citationCount: citations.length,
      citations,
      brandMentionCount,
      domainCitationCount,
      competitorMentioned,
      competitorCited,
      competitorMentionCount,
      competitorCitationCount
    };
  }

  if (queryResults.perplexity?.response) {
    const citations = queryResults.perplexity.citations || [];
    const brandMentioned = isBrandMentioned(queryResults.perplexity.response, brandName, brandDomain);
    const domainCited = isDomainCited(queryResults.perplexity.response, brandDomain);
    const brandMentionCount = countBrandMentions(queryResults.perplexity.response, brandName, brandDomain);
    const domainCitationCount = countDomainCitations(citations, brandDomain);

    const competitorMentioned = areCompetitorsMentioned(queryResults.perplexity.response, competitors);
    const competitorCited = areCompetitorsCited(citations, competitors);
    const competitorMentionCount = countCompetitorMentions(queryResults.perplexity.response, competitors);
    const competitorCitationCount = countCompetitorCitations(citations, competitors);

    results.perplexity = {
      provider: 'perplexity',
      brandMentioned,
      domainCited,
      citationCount: citations.length,
      citations,
      brandMentionCount,
      domainCitationCount,
      competitorMentioned,
      competitorCited,
      competitorMentionCount,
      competitorCitationCount
    };
  }

  const allResults = Object.values(results).filter(Boolean) as BrandAnalysisResult[];
  const totals = {
    totalCitations: allResults.reduce((sum, result) => sum + result.citationCount, 0),
    totalBrandMentions: allResults.reduce((sum, result) => sum + result.brandMentionCount, 0),
    totalDomainCitations: allResults.reduce((sum, result) => sum + result.domainCitationCount, 0),
    totalCompetitorMentions: allResults.reduce((sum, result) => sum + result.competitorMentionCount, 0),
    totalCompetitorCitations: allResults.reduce((sum, result) => sum + result.competitorCitationCount, 0),
    providersWithBrandMention: allResults.filter(result => result.brandMentioned).length,
    providersWithDomainCitation: allResults.filter(result => result.domainCited).length,
    providersWithCompetitorMention: allResults.filter(result => result.competitorMentioned).length,
    providersWithCompetitorCitation: allResults.filter(result => result.competitorCited).length
  };

  return {
    brandName,
    brandDomain,
    competitors,
    results,
    totals
  };
}
