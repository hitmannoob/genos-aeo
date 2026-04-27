import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/firebase/firebase-admin';
import {
  getAppUserProfileByFirebaseUid,
  upsertAppUserFromFirebaseToken,
} from '@/lib/db/appUsers';

export const dynamic = 'force-dynamic';

async function verifyBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const [scheme, token] = authorization?.split(' ') || [];

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return auth.verifyIdToken(token);
}

export async function GET(request: NextRequest) {
  try {
    const decodedToken = await verifyBearerToken(request);
    if (!decodedToken?.uid) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const profile = await getAppUserProfileByFirebaseUid(decodedToken.uid);
    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error) {
    console.error('❌ Failed to load Postgres user profile:', error);
    return NextResponse.json({ error: 'Failed to load user profile' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const decodedToken = await verifyBearerToken(request);
    if (!decodedToken?.uid) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const profile = await upsertAppUserFromFirebaseToken(decodedToken);

    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error) {
    console.error('❌ Failed to upsert Postgres user profile:', error);
    return NextResponse.json({ error: 'Failed to upsert user profile' }, { status: 500 });
  }
}
