import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getDisabledResponse() {
  return NextResponse.json(
    {
      success: false,
      code: 'SCHEDULED_PROCESSING_DISABLED',
      error: 'Scheduled processing is temporarily disabled.',
    },
    { status: 410 }
  );
}

export async function GET() {
  return getDisabledResponse();
}

export async function POST() {
  return getDisabledResponse();
}
