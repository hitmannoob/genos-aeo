import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { auth } from '@/firebase/firebase-admin';
import { getAppUserProfileByFirebaseUid } from '@/lib/db/appUsers';
import type { UserProfile } from '@/types/userProfile';

export interface AuthenticatedApiRequest {
  uid: string;
  token: string;
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

export function secretsMatch(candidate: string, expected: string): boolean {
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function configuredServiceSecret(value: string | undefined): string | null {
  const secret = value?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export async function verifyFirebaseRequestToken(
  request: NextRequest
): Promise<{ token: string; decodedToken: DecodedIdToken } | null> {
  const token = parseBearerToken(request);
  if (!token) return null;

  try {
    const decodedToken = await auth.verifyIdToken(token, true);
    return decodedToken?.uid ? { token, decodedToken } : null;
  } catch {
    return null;
  }
}

export async function authenticateApiRequest(
  request: NextRequest,
  options: AuthenticateApiRequestOptions = {}
): Promise<AuthenticatedApiRequest | null> {
  const verified = await verifyFirebaseRequestToken(request);
  if (!verified) return null;
  const { token, decodedToken } = verified;

  if (!options.requireProfile) {
    return {
      uid: decodedToken.uid,
      token,
    };
  }

  const profile = await getAppUserProfileByFirebaseUid(decodedToken.uid);
  if (!profile) return null;

  return {
    uid: decodedToken.uid,
    token,
    profile,
  };
}
