import 'server-only';

import { isPlausibleOpenRouterKey, normalizeOpenRouterKey } from '@/lib/openRouterKey';

const OPENROUTER_KEY_INFO_URL = 'https://openrouter.ai/api/v1/key';
const OPENROUTER_KEY_VALIDATION_TIMEOUT_MS = 10_000;

interface OpenRouterKeyInfoResponse {
  data?: {
    expires_at?: string | null;
    is_management_key?: boolean;
    is_provisioning_key?: boolean;
  };
}

export type OpenRouterCredentialValidation =
  | { status: 'valid' }
  | { status: 'invalid'; message: string }
  | { status: 'unavailable'; message: string; retryAfterSeconds?: number };

export function getConfiguredOpenRouterCredential(): string | undefined {
  const key = normalizeOpenRouterKey(process.env.OPENROUTER_API_KEY || '');
  return isPlausibleOpenRouterKey(key) ? key : undefined;
}

export async function validateOpenRouterCredential(
  apiKey: string,
): Promise<OpenRouterCredentialValidation> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_KEY_INFO_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'Genos',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(OPENROUTER_KEY_VALIDATION_TIMEOUT_MS),
    });
  } catch {
    return {
      status: 'unavailable',
      message: 'OpenRouter could not be reached. Please try again.',
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: 'invalid',
      message: 'OpenRouter rejected this API key.',
    };
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      status: 'unavailable',
      message: 'OpenRouter is rate limiting key checks. Please try again shortly.',
      ...(Number.isFinite(retryAfter) && retryAfter > 0
        ? { retryAfterSeconds: Math.ceil(retryAfter) }
        : {}),
    };
  }

  if (!response.ok) {
    return {
      status: 'unavailable',
      message: 'OpenRouter could not verify this API key. Please try again.',
    };
  }

  const payload = await response.json().catch(() => null) as OpenRouterKeyInfoResponse | null;
  if (!payload?.data) {
    return {
      status: 'unavailable',
      message: 'OpenRouter returned an invalid key-check response. Please try again.',
    };
  }

  if (payload.data.is_management_key || payload.data.is_provisioning_key) {
    return {
      status: 'invalid',
      message: 'Use a standard OpenRouter API key, not a management or provisioning key.',
    };
  }

  if (payload.data.expires_at) {
    const expiresAtMs = Date.parse(payload.data.expires_at);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      return {
        status: 'invalid',
        message: 'This OpenRouter API key has expired.',
      };
    }
  }

  return { status: 'valid' };
}
