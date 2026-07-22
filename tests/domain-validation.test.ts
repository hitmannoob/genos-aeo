import { describe, expect, it } from 'vitest';
import { DomainValidationError, normalizePublicDomain } from '@/lib/domainValidation';

describe('normalizePublicDomain', () => {
  it.each([
    ['Example.COM', 'example.com'],
    ['https://www.example.com/path?q=1', 'example.com'],
    ['https://sub.example.co.uk.', 'sub.example.co.uk'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePublicDomain(input)).toBe(expected);
  });

  it.each([
    '',
    'localhost',
    'service.internal',
    '127.0.0.1',
    '[::1]',
    'ftp://example.com',
    'https://user:password@example.com',
    '-bad.example.com',
  ])('rejects non-public input %s', (input) => {
    expect(() => normalizePublicDomain(input)).toThrow(DomainValidationError);
  });
});
