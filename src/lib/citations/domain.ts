export const GOOGLE_GROUNDING_REDIRECT_DOMAIN = 'vertexaisearch.cloud.google.com';

function parseHttpDomain(value: string | undefined): string | null {
  if (!value || typeof value !== 'string') return null;

  try {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function parseDomainLabel(value: string | undefined): string | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || /\s/.test(candidate)) return null;

  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || (parsed.pathname !== '/' && parsed.pathname !== '')
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }

    const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return domain.includes('.') ? domain : null;
  } catch {
    return null;
  }
}

export function isGoogleGroundingRedirect(url: string | undefined): boolean {
  return parseHttpDomain(url) === GOOGLE_GROUNDING_REDIRECT_DOMAIN;
}

/**
 * Google Search grounding can return an opaque Vertex redirect URL while its
 * title carries the actual source domain. Keep the redirect URL for compliant
 * click-through attribution, but use the source domain for display, grouping,
 * and brand-domain analysis.
 */
export function resolveCitationDomain(citation: {
  url?: string;
  domain?: string;
  title?: string;
  text?: string;
}): string | null {
  const urlDomain = parseHttpDomain(citation.url);
  if (!urlDomain) return null;
  if (urlDomain !== GOOGLE_GROUNDING_REDIRECT_DOMAIN) return urlDomain;

  for (const candidate of [citation.domain, citation.title, citation.text]) {
    const sourceDomain = parseDomainLabel(candidate);
    if (sourceDomain && sourceDomain !== GOOGLE_GROUNDING_REDIRECT_DOMAIN) {
      return sourceDomain;
    }
  }

  return null;
}
