export function extractGoogleAIOverviewCitations(text: string, googleAIData?: any): { url: string; text: string; source?: string }[] {
  if (!text && !googleAIData) return [];

  const citations: { url: string; text: string; source?: string }[] = [];
  const seen = new Set<string>();

  const normalizeUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.origin + urlObj.pathname;
    } catch {
      return url.trim();
    }
  };

  const googleSearchPattern = /https:\/\/www\.google\.com\/search\?[^\s<>"{}|\\^`[\]]+/g;
  const googleSearchUrls = (text || '').match(googleSearchPattern) || [];
  googleSearchUrls.forEach(url => {
    if (url && url.trim() && !seen.has(url)) {
      citations.push({
        text: 'Google Search',
        url: url.trim(),
        source: 'Google Search'
      });
      seen.add(url);
    }
  });

  const malformedSourcePattern = /\(source=([^"]+)"\s+target="_blank"[^>]*>([^)]+)\)/g;
  let match;
  while ((match = malformedSourcePattern.exec(text || '')) !== null) {
    const domain = match[2];
    if (domain && domain.trim()) {
      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      const normalizedUrl = normalizeUrl(url);
      if (!seen.has(normalizedUrl)) {
        const isGoogleSearch = url.includes('google.com/search?');
        citations.push({
          text: isGoogleSearch ? 'Google Search' : domain,
          url,
          source: isGoogleSearch ? 'Google Search' : 'Google AI Overview'
        });
        seen.add(normalizedUrl);
      }
    }
  }

  const numberedCitationPattern = /\[\[(\d+)\]\]\(([^)]+)\)/g;
  while ((match = numberedCitationPattern.exec(text || '')) !== null) {
    const citationNumber = match[1];
    const url = match[2];
    if (url && url.trim()) {
      const normalizedUrl = normalizeUrl(url);
      if (!seen.has(normalizedUrl)) {
        const isGoogleSearch = url.includes('google.com/search?');

        if (isGoogleSearch) {
          citations.push({ text: 'Google Search', url: url.trim(), source: 'Google Search' });
        } else {
          let displayText = url;
          try {
            const urlObj = new URL(url);
            displayText = urlObj.hostname.replace('www.', '');
          } catch {
            displayText = url;
          }
          citations.push({ text: `Citation ${citationNumber}: ${displayText}`, url: url.trim(), source: 'Google AI Overview' });
        }
        seen.add(normalizedUrl);
      }
    }
  }

  const markdownLinks = (text || '').match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
  markdownLinks.forEach(link => {
    const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (match && match[2] && match[2].trim()) {
      const normalizedUrl = normalizeUrl(match[2]);
      if (!seen.has(normalizedUrl)) {
        if (!match[1].match(/^\d+$/)) {
          const isGoogleSearch = match[2].includes('google.com/search?');
          citations.push({
            text: isGoogleSearch ? 'Google Search' : (match[1] || match[2]),
            url: match[2].trim(),
            source: isGoogleSearch ? 'Google Search' : 'Google AI Overview'
          });
          seen.add(normalizedUrl);
        }
      }
    }
  });

  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const urls = (text || '').match(urlRegex) || [];
  urls.forEach(url => {
    let cleanUrl = url.replace(/esv=[^&\s]+&[^&\s]*/g, '').replace(/&+/g, '&').replace(/[&?]$/, '');
    if (cleanUrl && cleanUrl.trim()) {
      const normalizedUrl = normalizeUrl(cleanUrl);
      if (!seen.has(normalizedUrl)) {
        const isGoogleSearch = cleanUrl.includes('google.com/search?');

        if (isGoogleSearch) {
          citations.push({ text: 'Google Search', url: cleanUrl.trim(), source: 'Google Search' });
        } else {
          let displayText = cleanUrl;
          try {
            const urlObj = new URL(cleanUrl);
            displayText = urlObj.hostname.replace('www.', '');
          } catch {
            displayText = cleanUrl;
          }
          citations.push({ text: displayText, url: cleanUrl.trim(), source: 'Google AI Overview' });
        }
        seen.add(normalizedUrl);
      }
    }
  });

  const domainPattern = /\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/g;
  let domainMatch;
  while ((domainMatch = domainPattern.exec(text || '')) !== null) {
    const domain = domainMatch[1];
    const url = `https://${domain}`;
    if (!seen.has(url)) {
      citations.push({ text: domain, url, source: 'Google AI Overview' });
      seen.add(url);
    }
  }

  if (googleAIData?.aiOverviewReferences && Array.isArray(googleAIData.aiOverviewReferences)) {
    googleAIData.aiOverviewReferences.forEach((ref: any) => {
      if (ref.url && ref.url.trim()) {
        const normalizedUrl = normalizeUrl(ref.url);
        if (!seen.has(normalizedUrl)) {
          citations.push({
            text: ref.title || ref.domain || ref.text || ref.url,
            url: ref.url.trim(),
            source: 'AI Overview Reference'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }

  return citations;
}
