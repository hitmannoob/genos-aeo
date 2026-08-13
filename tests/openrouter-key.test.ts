import { describe, expect, it } from 'vitest';
import {
  isPlausibleOpenRouterKey,
  normalizeOpenRouterKey,
} from '@/lib/openRouterKey';

describe('OpenRouter key handling', () => {
  it('normalizes surrounding whitespace without changing the credential', () => {
    expect(normalizeOpenRouterKey('  sk-or-v1-local-example-key  '))
      .toBe('sk-or-v1-local-example-key');
  });

  it('accepts a plausible browser-provided key', () => {
    expect(isPlausibleOpenRouterKey('sk-or-v1-local-example-key')).toBe(true);
  });

  it('rejects empty, short, or whitespace-containing values', () => {
    expect(isPlausibleOpenRouterKey('')).toBe(false);
    expect(isPlausibleOpenRouterKey('too-short')).toBe(false);
    expect(isPlausibleOpenRouterKey('sk-or-v1-key with spaces')).toBe(false);
  });
});
