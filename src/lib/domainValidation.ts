import { isIP } from 'node:net';

const RESERVED_HOSTS = new Set(['localhost']);

const RESERVED_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.home',
  '.home.arpa',
  '.lan',
  '.corp',
  '.example',
  '.invalid',
  '.test',
];

const HOST_LABEL_REGEX = /^[a-z0-9-]+$/i;

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export function normalizePublicDomain(input: string): string {
  const rawValue = input.trim();
  if (!rawValue) {
    throw new DomainValidationError('Domain is required');
  }

  const candidateUrl = /^[a-z]+:\/\//i.test(rawValue)
    ? rawValue
    : `https://${rawValue}`;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    throw new DomainValidationError('Invalid domain');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new DomainValidationError('Only http and https domains are allowed');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new DomainValidationError('Domains with embedded credentials are not allowed');
  }

  let hostname = parsedUrl.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname.startsWith('www.')) {
    hostname = hostname.slice(4);
  }

  if (!hostname) {
    throw new DomainValidationError('Invalid domain');
  }

  if (RESERVED_HOSTS.has(hostname) || RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new DomainValidationError('Private or reserved hostnames are not allowed');
  }

  if (isIP(hostname) !== 0) {
    throw new DomainValidationError('IP addresses are not allowed');
  }

  if (!hostname.includes('.')) {
    throw new DomainValidationError('A public domain name is required');
  }

  for (const label of hostname.split('.')) {
    if (
      !label ||
      label.length > 63 ||
      !HOST_LABEL_REGEX.test(label) ||
      label.startsWith('-') ||
      label.endsWith('-')
    ) {
      throw new DomainValidationError('Invalid domain');
    }
  }

  return hostname;
}
