import { NextRequest, NextResponse } from 'next/server';
import {
  getAppUserProfileByFirebaseUid,
  upsertAppUserFromFirebaseToken,
} from '@/lib/db/appUsers';
import { verifyFirebaseRequestToken } from '@/lib/serverAuth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const decodedToken = (await verifyFirebaseRequestToken(request))?.decodedToken;
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
    logger.error('Failed to load Postgres user profile', error);
    return NextResponse.json({ error: 'Failed to load user profile' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const decodedToken = (await verifyFirebaseRequestToken(request))?.decodedToken;
    if (!decodedToken?.uid) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const profile = await upsertAppUserFromFirebaseToken(decodedToken);

    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error) {
    logger.error('Failed to upsert Postgres user profile', error);
    return NextResponse.json({ error: 'Failed to upsert user profile' }, { status: 500 });
  }
}
