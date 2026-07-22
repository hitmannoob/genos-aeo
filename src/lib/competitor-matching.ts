// Core competitor matching logic for brand analytics

export interface Competitor {
  name: string;
  domain?: string;
  aliases?: string[];
}

export interface MatchResult {
  competitor: Competitor;
  matchType: 'name' | 'domain' | 'alias';
  matchedValue: string;
}

/**
 * Normalize a string for comparison (lowercase, trim, remove www)
 */
function normalize(str: string): string {
  return str.toLowerCase().replace(/^www\./, '').trim();
}

/**
 * Escape all regex metacharacters in a string so it can be safely embedded in a RegExp.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive whole-word-ish match with custom boundaries (non-alphanumeric).
 *
 * Using a custom boundary `[^a-z0-9]` (rather than `\b`) avoids inconsistencies in
 * JS regex word-boundary behaviour around names containing non-word characters
 * like "3M", ".NET", "C++", "O'Reilly", or "AT&T". This keeps "Apple" from
 * matching inside "pineapple" while still allowing "Apple" to match in
 * "Apple is great." or "The Apple," etc.
 */
export function matchesWord(text: string, needle: string): boolean {
  if (!text || !needle) return false;
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegex(needle.toLowerCase())}($|[^a-z0-9])`,
    'i'
  );
  return pattern.test(text);
}

/**
 * Strip protocol / www / trailing path from a domain-ish string and lowercase it.
 */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim();
}

export function isSameOrSubdomain(candidate: string, parentDomain: string): boolean {
  const normalizedCandidate = normalizeDomain(candidate).split(':')[0];
  const normalizedParent = normalizeDomain(parentDomain).split(':')[0];
  if (!normalizedCandidate || !normalizedParent) return false;
  return normalizedCandidate === normalizedParent
    || normalizedCandidate.endsWith(`.${normalizedParent}`);
}

/**
 * Classify a hostname as a configured competitor without substring matches.
 * A normalized competitor name must equal a complete hostname label, so
 * "Apple" matches apple.com and shop.apple.com but not pineapple.com.
 */
export function isCompetitorDomainName(
  domain: string,
  competitorNames: string[]
): boolean {
  const hostname = normalizeDomain(domain).split(':')[0];
  if (!hostname) return false;

  const labels = hostname
    .split('.')
    .map((label) => label.replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean);

  return competitorNames.some((name) => {
    const token = normalize(name).replace(/[^a-z0-9]+/g, '');
    return token.length >= 3 && labels.includes(token);
  });
}

function textContainsDomain(text: string, domain: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return false;

  const domainCandidates = text.match(/(?:[a-z0-9-]+\.)+[a-z0-9-]+/gi) ?? [];
  return domainCandidates.some((candidate) => {
    const normalizedCandidate = normalizeDomain(candidate);
    return isSameOrSubdomain(normalizedCandidate, normalizedDomain);
  });
}

/**
 * Attempt to match competitors in a given text (query)
 * @param text The text to search for competitor mentions
 * @param competitors List of competitors
 */
export function matchCompetitorsInText(
  text: string,
  competitors: Competitor[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const normalizedText = normalize(text);

  for (const competitor of competitors) {
    // Direct name match (case-insensitive, with non-alphanumeric boundaries so
    // "Apple" does not match inside "pineapple").
    if (matchesWord(normalizedText, normalize(competitor.name))) {
      results.push({
        competitor,
        matchType: 'name',
        matchedValue: competitor.name,
      });
      continue;
    }
    // Domain match — strip protocol/www/path first, then use matchesWord.
    // matchesWord's non-alphanumeric boundaries correctly allow a bare domain
    // like "example.com" to match inside a URL like "https://example.com/path"
    // (the surrounding `/` and `:` are non-alphanumeric), while preventing
    // "apple.com" from matching inside "pineapple.com" or
    // "apple.com.phishing.net".
    if (competitor.domain) {
      const normalizedDomain = normalizeDomain(competitor.domain);
      if (normalizedDomain && textContainsDomain(normalizedText, normalizedDomain)) {
        results.push({
          competitor,
          matchType: 'domain',
          matchedValue: competitor.domain,
        });
        continue;
      }
    }
    // Alias match (same word-boundary semantics as name match).
    if (competitor.aliases) {
      for (const alias of competitor.aliases) {
        if (matchesWord(normalizedText, normalize(alias))) {
          results.push({
            competitor,
            matchType: 'alias',
            matchedValue: alias,
          });
          break;
        }
      }
    }
  }
  return results;
}
