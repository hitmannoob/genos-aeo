import 'server-only';

import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { LookupAddress } from 'node:dns';
import { z } from 'zod';
import {
  DomainValidationError,
  normalizePublicDomain,
} from './domainValidation';

const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 10_000;

export const DomainMetadataSchema = z.object({
  title: z.string().describe('Website title'),
  description: z.string().describe('Meta description'),
  image: z.string().optional().describe('Open Graph image URL'),
  siteName: z.string().optional().describe('Site name from Open Graph'),
  url: z.string().describe('Final page URL after validated redirects'),
});

export type DomainMetadata = z.infer<typeof DomainMetadataSchema>;

export interface DomainMetadataInput {
  domain: string;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  const bytes = parts.map((part) => Number(part));
  if (bytes.some((part, index) => (
    !Number.isInteger(part)
    || part < 0
    || part > 255
    || String(part) !== parts[index]
  ))) {
    return null;
  }

  return bytes;
}

function parseIpv6(address: string): number[] | null {
  let normalized = address.toLowerCase().split('%')[0];

  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4Bytes = parseIpv4(normalized.slice(lastColon + 1));
    if (lastColon < 0 || !ipv4Bytes) return null;

    const high = ((ipv4Bytes[0] << 8) | ipv4Bytes[1]).toString(16);
    const low = ((ipv4Bytes[2] << 8) | ipv4Bytes[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }

  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function matchesCidr(bytes: number[], network: number[], prefixLength: number): boolean {
  const wholeBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;

  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== network[index]) return false;
  }

  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[wholeBytes] & mask) === (network[wholeBytes] & mask);
}

function isPrivateOrReservedIpv4(bytes: number[]): boolean {
  const [a, b, c] = bytes;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
}

function isPrivateOrReservedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isPrivateOrReservedIpv4(ipv4);

  const ipv6 = parseIpv6(address);
  if (!ipv6) return true;

  const mappedIpv4Prefix = [...Array(10).fill(0), 0xff, 0xff];
  if (matchesCidr(ipv6, mappedIpv4Prefix, 96)) {
    return isPrivateOrReservedIpv4(ipv6.slice(12));
  }

  const blockedNetworks: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['::', 96],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ];

  return blockedNetworks.some(([network, prefix]) => {
    const networkBytes = parseIpv6(network);
    return networkBytes ? matchesCidr(ipv6, networkBytes, prefix) : true;
  });
}

async function resolvePublicAddress(hostname: string): Promise<LookupAddress> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error('The domain did not resolve to an IP address');
  }

  if (addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
    throw new DomainValidationError('Domains resolving to private or reserved networks are not allowed');
  }

  return addresses[0];
}

function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  };

  const decodeCodePoint = (raw: string, radix: number, original: string): string => {
    const codePoint = Number.parseInt(raw, radix);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : original;
  };

  return value
    .replace(/&#(\d+);/g, (match, code: string) => decodeCodePoint(code, 10, match))
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => decodeCodePoint(code, 16, match))
    .replace(/&([a-z]+);/gi, (match, entity: string) => entities[entity.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? '');
  }

  return attributes;
}

function extractMetaTags(html: string, pageUrl: URL): Partial<DomainMetadata> {
  const metadata: Partial<DomainMetadata> = {};
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) metadata.title = decodeHtml(titleMatch[1]).slice(0, 300);

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = (attributes.property || attributes.name || '').toLowerCase();
    const content = attributes.content;
    if (!content) continue;

    if (key === 'description' && !metadata.description) {
      metadata.description = content.slice(0, 1_000);
    } else if (key === 'og:title' && !metadata.title) {
      metadata.title = content.slice(0, 300);
    } else if (key === 'og:description' && !metadata.description) {
      metadata.description = content.slice(0, 1_000);
    } else if (key === 'og:site_name' && !metadata.siteName) {
      metadata.siteName = content.slice(0, 300);
    } else if (key === 'og:image' && !metadata.image) {
      try {
        const imageUrl = new URL(content, pageUrl);
        if (['http:', 'https:'].includes(imageUrl.protocol)) metadata.image = imageUrl.toString();
      } catch {
        // Ignore malformed optional image URLs.
      }
    }
  }

  return metadata;
}

async function fetchHtml(url: URL, redirectCount = 0): Promise<{ html: string; finalUrl: URL }> {
  if (url.protocol !== 'https:') {
    throw new DomainValidationError('Website metadata may only be fetched over HTTPS');
  }
  if (url.username || url.password) {
    throw new DomainValidationError('URLs with embedded credentials are not allowed');
  }

  // Validate the hostname without replacing it; redirect targets such as
  // www.example.com must retain their exact host for TLS and routing.
  normalizePublicDomain(url.hostname);
  const pinnedAddress = await resolvePublicAddress(url.hostname);

  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Genos-Metadata/1.0; +https://github.com/)',
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'Accept-Encoding': 'identity',
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, pinnedAddress.address, pinnedAddress.family);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('Website redirected too many times'));
          return;
        }

        let target: URL;
        try {
          target = new URL(location, url);
        } catch {
          reject(new Error('Website returned an invalid redirect URL'));
          return;
        }

        void fetchHtml(target, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Website returned HTTP ${status}`));
        return;
      }

      const contentType = response.headers['content-type']?.toLowerCase() ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        response.resume();
        reject(new Error('Website did not return HTML content'));
        return;
      }

      const declaredLength = Number(response.headers['content-length'] ?? 0);
      if (declaredLength > MAX_HTML_BYTES) {
        response.resume();
        reject(new Error('Website HTML is too large to inspect safely'));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      response.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_HTML_BYTES) {
          response.destroy(new Error('Website HTML is too large to inspect safely'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          html: Buffer.concat(chunks).toString('utf8'),
          finalUrl: url,
        });
      });
      response.on('error', reject);
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Website metadata request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function getDomainMetadata(input: DomainMetadataInput): Promise<DomainMetadata> {
  const domain = normalizePublicDomain(input.domain);
  const { html, finalUrl } = await fetchHtml(new URL(`https://${domain}`));
  const metadata = extractMetaTags(html, finalUrl);

  const fallbackName = domain.split('.')[0];
  return DomainMetadataSchema.parse({
    title: metadata.title || fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1),
    description: metadata.description || '',
    image: metadata.image,
    siteName: metadata.siteName,
    url: finalUrl.toString(),
  });
}
