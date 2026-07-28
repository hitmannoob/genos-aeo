import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  getAppUserProfileByUserId,
  LOCAL_USER_ID,
} from '@/lib/db/appUsers';
import { OPENROUTER_KEY_HEADER } from '@/lib/openRouterKey';
import type { UserProfile } from '@/types/userProfile';

export interface AuthenticatedApiRequest {
  uid: string;
  token: string;
  openRouterApiKey: string | null;
  profile?: UserProfile;
}

interface AuthenticateApiRequestOptions {
  requireProfile?: boolean;
}

export function parseBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization')?.trim();
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

export function getOpenRouterApiKey(request: NextRequest): string | null {
  const key = request.headers.get(OPENROUTER_KEY_HEADER)?.trim();
  return key || null;
}

export function secretsMatch(candidate: string, expected: string): boolean {
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function configuredServiceSecret(value: string | undefined): string | null {
  const secret = value?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export async function authenticateApiRequest(
  request: NextRequest,
  options: AuthenticateApiRequestOptions = {}
): Promise<AuthenticatedApiRequest | null> {
  const openRouterApiKey = getOpenRouterApiKey(request);

  if (!options.requireProfile) {
    return {
      uid: LOCAL_USER_ID,
      token: '',
      openRouterApiKey,
    };
  }

  const profile = await getAppUserProfileByUserId(LOCAL_USER_ID);
  if (!profile) return null;

  return {
    uid: LOCAL_USER_ID,
    token: '',
    openRouterApiKey,
    profile,
  };
}
