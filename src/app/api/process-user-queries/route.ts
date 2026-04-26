import { NextResponse } from 'next/server';

const DEPRECATION_RESPONSE = {
  success: false,
  error: 'This endpoint has been removed.',
  code: 'DEPRECATED_ENDPOINT',
  message: 'Use /api/user-query from the batch caller. That route now owns execution, billing, and persistence.',
};

export async function POST() {
  return NextResponse.json(DEPRECATION_RESPONSE, { status: 410 });
}

export async function GET() {
  return NextResponse.json(DEPRECATION_RESPONSE, { status: 410 });
}
