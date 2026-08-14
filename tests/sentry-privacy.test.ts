import { describe, expect, it } from 'vitest';
import { redactSensitiveRequestHeaders } from '@/lib/sentryPrivacy';

describe('Sentry request header privacy', () => {
  it('filters credentials case-insensitively and preserves diagnostic headers', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer firebase-token',
          'X-OpenRouter-Api-Key': 'sk-or-v1-secret',
          Cookie: 'session=secret',
          Accept: 'application/json',
        },
      },
    };

    expect(redactSensitiveRequestHeaders(event).request?.headers).toEqual({
      Authorization: '[Filtered]',
      'X-OpenRouter-Api-Key': '[Filtered]',
      Cookie: '[Filtered]',
      Accept: 'application/json',
    });
  });
});
