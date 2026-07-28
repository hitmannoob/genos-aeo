import { NextRequest, NextResponse } from 'next/server';
import {
  ensureLocalAppUserProfile,
  getAppUserProfileByUserId,
  LOCAL_USER_ID,
} from '@/lib/db/appUsers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  void request;
  try {
    const profile = await getAppUserProfileByUserId(LOCAL_USER_ID);
    if (!profile) {
      return NextResponse.json({ error: 'Local profile not found' }, { status: 404 });
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
  void request;
  try {
    const profile = await ensureLocalAppUserProfile();

    return NextResponse.json({
      success: true,
      profile,
    });
  } catch (error) {
    logger.error('Failed to upsert Postgres user profile', error);
    return NextResponse.json({ error: 'Failed to upsert user profile' }, { status: 500 });
  }
}
