import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { firestore } from '@/firebase/firebase-admin';
import {
  persistOneQueryResult,
  refreshLifetimeSnapshot,
} from '@/firebase/firestore/persistQueryResult';

// Scheduled-run endpoint.
// Hit this periodically (Firebase Scheduler / vercel.json cron / GitHub Actions).
// Finds brands whose most recent query processing is older than the interval
// and re-runs each brand's queries by calling /api/user-query in cron-auth mode.
//
// Auth: Authorization: Bearer <CRON_SECRET>
// Optional query params:
//   intervalDays (default 7)  — "due" if maxProcessedDate + intervalDays <= now
//   brandId                   — limit to a single brand
//   maxBrands                 — safety cap per invocation (default 50)
//
// Notes:
//  - Each query goes through /api/user-query which deducts 10 credits from the
//    brand owner. Owners out of credits will see per-query failures in logs.
//  - Execution is serial to stay within Cloud Function / serverless timeouts.
//    Brands not reached this run are picked up on the next scheduled trigger.

const DEFAULT_INTERVAL_DAYS = 7;
const DEFAULT_MAX_BRANDS = 50;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server' },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const intervalDays = Number(searchParams.get('intervalDays') ?? DEFAULT_INTERVAL_DAYS);
  const maxBrands = Number(searchParams.get('maxBrands') ?? DEFAULT_MAX_BRANDS);
  const brandIdFilter = searchParams.get('brandId') ?? undefined;

  const now = Date.now();
  const thresholdMs = intervalDays * 24 * 60 * 60 * 1000;

  // Load candidate brands
  const brandsRef = firestore.collection('v8userbrands');
  const brandsSnap = brandIdFilter
    ? await brandsRef.where('__name__', '==', brandIdFilter).get()
    : await brandsRef.get();

  type DueBrand = {
    id: string;
    userId: string;
    companyName: string;
    brandDomain: string;
    queries: Array<{ query: string; keyword?: string; category?: string; context?: string }>;
    priorResults: any[];
    lastProcessedAt: number | null;
  };
  const dueBrands: DueBrand[] = [];

  for (const doc of brandsSnap.docs) {
    const brand = doc.data();
    const userId: string | undefined = brand?.userId;
    const queries: any[] = Array.isArray(brand?.queries) ? brand.queries : [];
    if (!userId || queries.length === 0) continue;

    const results: any[] = Array.isArray(brand?.queryProcessingResults)
      ? brand.queryProcessingResults
      : [];
    let lastProcessedAt: number | null = null;
    for (const r of results) {
      const d = r?.date ? new Date(r.date).getTime() : NaN;
      if (!Number.isNaN(d) && (lastProcessedAt === null || d > lastProcessedAt)) {
        lastProcessedAt = d;
      }
    }

    const isDue = lastProcessedAt === null || now - lastProcessedAt >= thresholdMs;
    if (!isDue) continue;

    dueBrands.push({
      id: doc.id,
      userId,
      companyName: brand?.companyName ?? 'Unknown',
      brandDomain: brand?.domain ?? '',
      queries: queries.filter(q => q && typeof q.query === 'string'),
      priorResults: results,
      lastProcessedAt,
    });
    if (dueBrands.length >= maxBrands) break;
  }

  if (dueBrands.length === 0) {
    return NextResponse.json({
      success: true,
      processedBrands: 0,
      totalQueries: 0,
      skippedBrands: brandsSnap.size,
      durationMs: Date.now() - startedAt,
      message: 'No brands due for processing',
    });
  }

  // Resolve base URL for internal calls
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get('x-forwarded-host')
      ? `https://${request.headers.get('x-forwarded-host')}`
      : request.nextUrl.origin;

  const perBrandSummary: Array<{
    brandId: string;
    userId: string;
    companyName: string;
    totalQueries: number;
    succeeded: number;
    failed: number;
    lifetimeSnapshotRefreshed: boolean;
    errors: string[];
  }> = [];

  let totalQueries = 0;

  for (const brand of dueBrands) {
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    // One processing session per brand per cron run — matches the
    // ProcessQueriesButton semantics so session-id dedupe in
    // updateBrandWithQueryResults works correctly.
    const processingSessionId = `cron_session_${randomUUID()}`;
    const processingSessionTimestamp = new Date().toISOString();

    // Seed with the brand's existing queryProcessingResults so the accumulator
    // fed into updateBrandWithQueryResults is complete. The called
    // updateBrandWithQueryResults dedupes by processingSessionId, so passing
    // prior results alongside the fresh ones in a new session won't clobber
    // existing sessions or inflate counts.
    let allResults: any[] = [...brand.priorResults];

    for (const q of brand.queries) {
      totalQueries++;
      try {
        const resp = await fetch(`${baseUrl}/api/user-query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cronSecret}`,
            'X-Cron-User-Id': brand.userId,
          },
          body: JSON.stringify({
            query: q.query,
            context: (q as any).context || 'Scheduled reprocessing',
          }),
        });

        if (!resp.ok) {
          failed++;
          const text = await resp.text().catch(() => '');
          errors.push(`[${resp.status}] ${text.slice(0, 200)}`);
          continue;
        }

        const userQueryResponse = await resp.json();

        // Persist across detailed_query_results, brand doc, per-session
        // analytics. Accumulator flows forward so each save sees the full
        // picture.
        try {
          const { updatedAllResults } = await persistOneQueryResult({
            brandId: brand.id,
            userId: brand.userId,
            companyName: brand.companyName,
            brandDomain: brand.brandDomain,
            query: {
              query: q.query,
              keyword: (q as any).keyword,
              category: (q as any).category,
            },
            processingSessionId,
            processingSessionTimestamp,
            userQueryResponse,
            allPriorResults: allResults,
          });
          allResults = updatedAllResults;
          succeeded++;
        } catch (persistError) {
          failed++;
          errors.push(`persist: ${(persistError as Error).message ?? String(persistError)}`);
        }
      } catch (e) {
        failed++;
        errors.push((e as Error).message ?? String(e));
      }
    }

    // Refresh the lifetime snapshot once per brand, after every query has
    // been persisted. Manual runs do this via ProcessQueriesButton.onComplete;
    // this closes the gap for scheduled runs.
    let lifetimeSnapshotRefreshed = false;
    if (succeeded > 0) {
      const { success, error } = await refreshLifetimeSnapshot(brand.id, brand.userId);
      lifetimeSnapshotRefreshed = success;
      if (error) {
        errors.push(`lifetime-snapshot: ${(error as Error).message ?? String(error)}`);
      }
    }

    perBrandSummary.push({
      brandId: brand.id,
      userId: brand.userId,
      companyName: brand.companyName,
      totalQueries: brand.queries.length,
      succeeded,
      failed,
      lifetimeSnapshotRefreshed,
      errors: errors.slice(0, 5),
    });
  }

  return NextResponse.json({
    success: true,
    processedBrands: perBrandSummary.length,
    totalQueries,
    intervalDays,
    durationMs: Date.now() - startedAt,
    brands: perBrandSummary,
  });
}

// GET: read-only preview — which brands would be processed right now?
// Same auth as POST. Useful for debugging schedule config.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server' },
      { status: 503 }
    );
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const intervalDays = Number(searchParams.get('intervalDays') ?? DEFAULT_INTERVAL_DAYS);
  const now = Date.now();
  const thresholdMs = intervalDays * 24 * 60 * 60 * 1000;

  const brandsSnap = await firestore.collection('v8userbrands').get();
  const due: Array<{
    brandId: string;
    userId: string;
    companyName: string;
    queryCount: number;
    lastProcessedAt: string | null;
    daysSinceLastRun: number | null;
  }> = [];

  for (const doc of brandsSnap.docs) {
    const brand = doc.data();
    const userId: string | undefined = brand?.userId;
    const queries: any[] = Array.isArray(brand?.queries) ? brand.queries : [];
    if (!userId || queries.length === 0) continue;

    const results: any[] = Array.isArray(brand?.queryProcessingResults)
      ? brand.queryProcessingResults
      : [];
    let lastProcessedAt: number | null = null;
    for (const r of results) {
      const d = r?.date ? new Date(r.date).getTime() : NaN;
      if (!Number.isNaN(d) && (lastProcessedAt === null || d > lastProcessedAt)) {
        lastProcessedAt = d;
      }
    }

    const isDue = lastProcessedAt === null || now - lastProcessedAt >= thresholdMs;
    if (!isDue) continue;

    due.push({
      brandId: doc.id,
      userId,
      companyName: brand?.companyName ?? 'Unknown',
      queryCount: queries.length,
      lastProcessedAt: lastProcessedAt ? new Date(lastProcessedAt).toISOString() : null,
      daysSinceLastRun:
        lastProcessedAt === null
          ? null
          : Math.floor((now - lastProcessedAt) / (24 * 60 * 60 * 1000)),
    });
  }

  return NextResponse.json({
    success: true,
    intervalDays,
    dueBrandCount: due.length,
    totalBrandCount: brandsSnap.size,
    brands: due,
  });
}
