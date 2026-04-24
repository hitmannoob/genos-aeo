// Core competitor matching logic for brand analytics
import fuzzysort from 'fuzzysort';

export interface Competitor {
  name: string;
  domain?: string;
  aliases?: string[];
}

export interface MatchResult {
  competitor: Competitor;
  matchType: 'name' | 'domain' | 'alias' | 'fuzzy';
  matchedValue: string;
  score?: number;
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

/**
 * Attempt to match competitors in a given text (query)
 * @param text The text to search for competitor mentions
 * @param competitors List of competitors
 * @param fuzzyThreshold Fuzzysort score threshold (lower is better)
 */
export function matchCompetitorsInText(
  text: string,
  competitors: Competitor[],
  fuzzyThreshold = -50
): MatchResult[] {
  const results: MatchResult[] = [];
  const normalizedText = normalize(text);

  for (const competitor of competitors) {
    let matched = false;

    // Direct name match (case-insensitive, with non-alphanumeric boundaries so
    // "Apple" does not match inside "pineapple").
    if (matchesWord(normalizedText, normalize(competitor.name))) {
      results.push({
        competitor,
        matchType: 'name',
        matchedValue: competitor.name,
      });
      matched = true;
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
      if (normalizedDomain && matchesWord(normalizedText, normalizedDomain)) {
        results.push({
          competitor,
          matchType: 'domain',
          matchedValue: competitor.domain,
        });
        matched = true;
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
          matched = true;
          break;
        }
      }
    }
    // Only run fuzzy matching if no earlier match type hit — otherwise an
    // alias match would be double-counted as a fuzzy hit against the same
    // alias string.
    // TODO: threshold is very permissive; tune or remove fuzzy entirely
    if (!matched) {
      const candidates = [competitor.name, ...(competitor.aliases || [])];
      const fuzzy = fuzzysort.go(normalizedText, candidates, { threshold: fuzzyThreshold });
      if (fuzzy.total > 0) {
        for (const res of fuzzy) {
          results.push({
            competitor,
            matchType: 'fuzzy',
            matchedValue: res.target,
            score: res.score,
          });
        }
      }
    }
  }
  return results;
}
