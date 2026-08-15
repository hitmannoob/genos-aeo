import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tempDirectory = '';
let appUsers: typeof import('@/lib/db/appUsers');
let brands: typeof import('@/lib/db/brands');
let credits: typeof import('@/lib/billing/serverCredits');
let executions: typeof import('@/lib/db/queryExecution');
let jobs: typeof import('@/lib/jobs/reprocessingJobs');
let rateLimit: typeof import('@/lib/rateLimit/rateLimit');
let cache: typeof import('@/lib/cache/providerResponseCache');
let dataSanity: typeof import('@/lib/dataSanityServer');

beforeAll(async () => {
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'genos-sqlite-test-'));
  process.env.SQLITE_PATH = path.join(tempDirectory, 'genos.sqlite3');
  process.env.SQLITE_BUSY_TIMEOUT_MS = '5000';

  const database = new DatabaseSync(process.env.SQLITE_PATH);
  database.exec('pragma foreign_keys = on');
  database.exec(
    fs.readFileSync(
      path.resolve('db/migrations/0001_initial_sqlite_schema.sql'),
      'utf8'
    )
  );
  database.close();

  appUsers = await import('@/lib/db/appUsers');
  brands = await import('@/lib/db/brands');
  credits = await import('@/lib/billing/serverCredits');
  executions = await import('@/lib/db/queryExecution');
  jobs = await import('@/lib/jobs/reprocessingJobs');
  rateLimit = await import('@/lib/rateLimit/rateLimit');
  cache = await import('@/lib/cache/providerResponseCache');
  dataSanity = await import('@/lib/dataSanityServer');
});

afterAll(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe('SQLite persistence', () => {
  it('preserves Firebase tenants, credits, idempotency, jobs, rate limits, and cache behavior', async () => {
    const firebaseUid = 'firebase-sqlite-user';
    const profile = await appUsers.upsertAppUserFromFirebaseToken({
      uid: firebaseUid,
      email: 'sqlite-user@example.test',
      name: 'SQLite User',
      picture: 'https://example.test/avatar.png',
    } as unknown as Parameters<typeof appUsers.upsertAppUserFromFirebaseToken>[0]);
    expect(profile.uid).toBe(firebaseUid);
    expect(profile.credits).toBe(1000);

    const created = await brands.createBrandWithCreditsSql({
      brandId: 'sqlite-brand-public-id',
      firebaseUid,
      brandData: {
        domain: 'sqlite-brand.example',
        website: 'https://sqlite-brand.example',
        companyName: 'SQLite Brand',
        shortDescription: 'SQLite integration test brand',
        productsAndServices: ['SQLite analytics'],
        keywords: ['analytics'],
        setupComplete: true,
        currentStep: 3,
        queries: [
          {
            query: 'Which analytics tools use SQLite?',
            keyword: 'analytics',
            category: 'Awareness',
            selected: true,
          },
        ],
      },
    });
    expect(created).toEqual({
      success: true,
      creditsAfter: 900,
      brandId: 'sqlite-brand-public-id',
    });

    await brands.addKeywordToBrandSql(
      'sqlite-brand-public-id',
      firebaseUid,
      'visibility'
    );
    await brands.addQueryToBrandSql({
      brandId: 'sqlite-brand-public-id',
      firebaseUid,
      rawQuery: 'How do brands measure answer-engine visibility?',
      category: 'Interest',
      keyword: 'visibility',
    });

    const storedBrand = await brands.getBrandSql(
      'sqlite-brand-public-id',
      firebaseUid
    );
    expect(storedBrand?.keywords).toEqual(['analytics', 'visibility']);
    expect(storedBrand?.queries).toHaveLength(2);

    const firstDebit = await credits.deductUserCreditsServer(firebaseUid, 10, {
      idempotencyKey: 'sqlite-debit-1',
      reason: 'SQLite test debit',
    });
    const replayedDebit = await credits.deductUserCreditsServer(firebaseUid, 10, {
      idempotencyKey: 'sqlite-debit-1',
      reason: 'SQLite test debit',
    });
    expect(firstDebit.after).toBe(890);
    expect(replayedDebit).toEqual(firstDebit);

    await credits.refundUserCreditsServer(firebaseUid, 10, {
      idempotencyKey: 'sqlite-refund-1',
      reason: 'SQLite test refund',
    });
    expect(await credits.getUserCreditBalanceServer(firebaseUid)).toBe(900);

    const executionArgs = {
      userId: firebaseUid,
      brandId: 'sqlite-brand-public-id',
      clientRequestId: 'sqlite-request-1',
      requestFingerprintSource: {
        query: 'How do brands measure answer-engine visibility?',
        persistResult: false,
        brandId: 'sqlite-brand-public-id',
      },
    };
    const acquired = await executions.acquireQueryExecution<{ success: boolean }>(executionArgs);
    expect(acquired.status).toBe('acquired');

    await executions.completeQueryExecution({
      userId: firebaseUid,
      brandId: 'sqlite-brand-public-id',
      clientRequestId: 'sqlite-request-1',
      replayResponse: { success: true },
    });
    const replayed = await executions.acquireQueryExecution<{ success: boolean }>(executionArgs);
    expect(replayed).toMatchObject({
      status: 'replay',
      response: { success: true },
    });

    const rateLimitKey = `sqlite-rate-limit-${Date.now()}`;
    expect((await rateLimit.consumeRateLimit({ bucketId: rateLimitKey, limit: 2, windowMs: 60_000 })).allowed).toBe(true);
    expect((await rateLimit.consumeRateLimit({ bucketId: rateLimitKey, limit: 2, windowMs: 60_000 })).allowed).toBe(true);
    expect((await rateLimit.consumeRateLimit({ bucketId: rateLimitKey, limit: 2, windowMs: 60_000 })).allowed).toBe(false);

    const cacheKey = cache.buildProviderResponseCacheKey({
      prompt: 'SQLite cache test',
      providers: ['chatgptsearch'],
    });
    await cache.setCachedProviderResponse(cacheKey, {
      requestId: 'sqlite-cache-request',
      results: [],
      totalCost: 0,
      completedAt: new Date(),
    });
    expect(await cache.getCachedProviderResponse(cacheKey)).toMatchObject({
      requestId: 'sqlite-cache-request',
      totalCost: 0,
    });

    const jobCreation = await jobs.createReprocessingJob({
      userId: firebaseUid,
      brandId: 'sqlite-brand-public-id',
      brandName: 'SQLite Brand',
      brandDomain: 'sqlite-brand.example',
      queries: [
        {
          query: 'How do brands measure answer-engine visibility?',
          keyword: 'visibility',
          category: 'Interest',
        },
      ],
      creditsRequired: 10,
    });
    expect(jobCreation.reusedExistingJob).toBe(false);
    const acquiredJob = await jobs.acquireReprocessingJobRunner(jobCreation.job.id);
    expect(acquiredJob.acquired).toBe(true);

    const queryId = jobCreation.job.queries[0].queryId;
    await jobs.completeReprocessingJob({
      jobId: jobCreation.job.id,
      status: 'completed',
      successfulCount: 1,
      failedCount: 0,
      attemptedCount: 1,
      creditsUsed: 10,
      currentIndex: 1,
      completedQueryIds: [queryId],
      failedQueryIds: [],
      errors: [],
    });
    expect((await jobs.getReprocessingJob(jobCreation.job.id))?.status).toBe('completed');

    const sanity = await dataSanity.runDataSanityChecks({
      brandId: 'sqlite-brand-public-id',
      userId: firebaseUid,
      maxBrands: 10,
      maxIssues: 100,
      maxLedgerDocs: 100,
      includeProviderResults: true,
      includeLedger: true,
    });
    expect(sanity.summary.brandsScanned).toBe(1);
    expect(sanity.summary.errors).toBe(0);
  });
});
