import { NextRequest } from 'next/server';
import { auth } from '@/firebase/firebase-admin';
import { getAppUserProfileByFirebaseUid } from '@/lib/db/appUsers';

export interface AuthenticatedApiRequest {
  uid: string;
  token: string;
  profile?: any;
}

interface AuthenticateApiRequestOptions {
  requireProfile?: boolean;
}

export async function authenticateApiRequest(
  request: NextRequest,
  options: AuthenticateApiRequestOptions = {}
): Promise<AuthenticatedApiRequest | null> {
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization) {
      return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }

    const decodedToken = await auth.verifyIdToken(token);
    if (!decodedToken?.uid) {
      return null;
    }

    if (!options.requireProfile) {
      return {
        uid: decodedToken.uid,
        token,
      };
    }

    const profile = await getAppUserProfileByFirebaseUid(decodedToken.uid);
    if (!profile) {
      return null;
    }

    return {
      uid: decodedToken.uid,
      token,
      profile,
    };
  } catch (error) {
    console.error('❌ authenticateApiRequest failed:', error);
    return null;
  }
}
