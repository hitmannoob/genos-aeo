import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({
  path: [path.join(rootDir, '.env.local'), path.join(rootDir, '.env')],
  quiet: true,
});

function requireSafeDatabaseUrl() {
  if (process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true') {
    throw new Error('Set ALLOW_DATABASE_INTEGRATION_TESTS=true to acknowledge the transaction-only database checks.');
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('DATABASE_URL is not configured');

  const parsed = new URL(rawUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error('Database verification is restricted to localhost');
  }

  return rawUrl;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectDatabaseError(client, label, expectedCode, operation) {
  const savepoint = `verify_${label.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
  await client.query(`savepoint ${savepoint}`);

  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    if (error && typeof error === 'object' && error.code === expectedCode) return;
    throw error;
  }

  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`${label} did not fail with PostgreSQL error ${expectedCode}`);
}

async function insertUser(client, suffix, label) {
  const result = await client.query(
    `
      insert into app_users (firebase_uid, email, display_name)
      values ($1, $2, $3)
      returning id
    `,
    [`verify-${label}-${suffix}`, `verify-${label}-${suffix}@example.test`, `Verifier ${label}`]
  );
  return result.rows[0].id;
}

async function insertBrand(client, userId, suffix, label) {
  const result = await client.query(
    `
      insert into brands (user_id, domain, website, company_name)
      values ($1, $2, $3, $4)
      returning id
    `,
    [
      userId,
      `${label}-${suffix}.example`,
      `https://${label}-${suffix}.example`,
      `Verifier ${label}`,
    ]
  );
  return result.rows[0].id;
}

async function main() {
  const databaseUrl = requireSafeDatabaseUrl();
  const client = new Client({ connectionString: databaseUrl, ssl: false });
  const suffix = randomUUID();

  await client.connect();
  await client.query('begin');

  try {
    const migrationFiles = (await fs.readdir(path.join(rootDir, 'db', 'migrations')))
      .filter((file) => file.endsWith('.sql'));
    const migrationState = await client.query(
      'select count(*)::integer as count, count(*) filter (where checksum is null)::integer as missing_checksums from schema_migrations'
    );
    assert(
      migrationState.rows[0].count === migrationFiles.length,
      'Not every migration file is recorded in schema_migrations'
    );
    assert(migrationState.rows[0].missing_checksums === 0, 'A migration checksum is missing');

    const invalidConstraints = await client.query(
      `
        select count(*)::integer as count
        from pg_constraint
        where connamespace = 'public'::regnamespace and not convalidated
      `
    );
    assert(invalidConstraints.rows[0].count === 0, 'The public schema has unvalidated constraints');

    const userA = await insertUser(client, suffix, 'a');
    const userB = await insertUser(client, suffix, 'b');
    const brandA = await insertBrand(client, userA, suffix, 'alpha');
    const brandB = await insertBrand(client, userB, suffix, 'beta');

    await expectDatabaseError(client, 'cross_tenant_execution_brand', '23503', () =>
      client.query(
        `
          insert into query_execution_requests (
            user_id, brand_id, client_request_id, request_fingerprint
          ) values ($1, $2, $3, $4)
        `,
        [userB, brandA, `cross-tenant-${suffix}`, suffix]
      )
    );
    const executionA = await client.query(
      `
        insert into query_execution_requests (
          user_id, brand_id, client_request_id, request_fingerprint
        ) values ($1, $2, $3, $4)
        returning id
      `,
      [userA, brandA, `execution-a-${suffix}`, suffix]
    );
    const executionB = await client.query(
      `
        insert into query_execution_requests (
          user_id, brand_id, client_request_id, request_fingerprint
        ) values ($1, $2, $3, $4)
        returning id
      `,
      [userB, brandB, `execution-b-${suffix}`, suffix]
    );

    await expectDatabaseError(client, 'case_insensitive_brand_domain', '23505', () =>
      client.query(
        'insert into brands (user_id, domain, company_name) values ($1, upper($2), $3)',
        [userA, `alpha-${suffix}.example`, 'Duplicate Alpha']
      )
    );

    const queryOne = await client.query(
      `
        insert into brand_queries (brand_id, query, keyword, category)
        values ($1, $2, $3, 'Awareness')
        returning id, tracked_identity
      `,
      [brandA, 'Which alpha platform is best?', 'alpha platform']
    );
    const queryTwo = await client.query(
      `
        insert into brand_queries (brand_id, query, keyword, category)
        values ($1, $2, $3, 'Awareness')
        returning id, tracked_identity
      `,
      [brandA, 'Which alpha platforms are best?', 'alpha platforms']
    );
    const queryB = await client.query(
      `
        insert into brand_queries (brand_id, query, keyword, category)
        values ($1, $2, $3, 'Awareness')
        returning id
      `,
      [brandB, 'Which beta platform is best?', 'beta platform']
    );
    assert(
      queryOne.rows[0].tracked_identity !== queryTwo.rows[0].tracked_identity,
      'Distinct tracked queries produced the same identity'
    );
    await expectDatabaseError(client, 'duplicate_tracked_query', '23505', () =>
      client.query(
        `
          insert into brand_queries (brand_id, query, keyword, category)
          values ($1, $2, $3, 'Awareness')
        `,
        [brandA, 'Which alpha platform is best?', 'alpha platform']
      )
    );

    await expectDatabaseError(client, 'cross_tenant_query_run', '23503', () =>
      client.query(
        `
          insert into query_runs (
            user_id, brand_id, processing_session_id,
            processing_session_timestamp, query, keyword, category
          ) values ($1, $2, $3, now(), $4, $5, 'Awareness')
        `,
        [userB, brandA, `cross-tenant-${suffix}`, 'Cross tenant query', 'cross tenant']
      )
    );
    await expectDatabaseError(client, 'cross_brand_tracked_query', '23503', () =>
      client.query(
        `
          insert into query_runs (
            user_id, brand_id, brand_query_id, processing_session_id,
            processing_session_timestamp, query, keyword, category
          ) values ($1, $2, $3, $4, now(), $5, $6, 'Awareness')
        `,
        [
          userA,
          brandA,
          queryB.rows[0].id,
          `cross-brand-query-${suffix}`,
          'Cross brand tracked query',
          'cross brand',
        ]
      )
    );
    await expectDatabaseError(client, 'cross_tenant_execution_run', '23503', () =>
      client.query(
        `
          insert into query_runs (
            user_id, brand_id, brand_query_id, execution_request_id,
            processing_session_id, processing_session_timestamp,
            query, keyword, category
          ) values ($1, $2, $3, $4, $5, now(), $6, $7, 'Awareness')
        `,
        [
          userA,
          brandA,
          queryOne.rows[0].id,
          executionB.rows[0].id,
          `cross-execution-${suffix}`,
          'Cross execution request',
          'cross execution',
        ]
      )
    );

    const runOne = await client.query(
      `
        insert into query_runs (
          user_id, brand_id, brand_query_id, execution_request_id, processing_session_id,
          processing_session_timestamp, query, keyword, category
        ) values ($1, $2, $3, $4, $5, now(), $6, $7, 'Awareness')
        returning id
      `,
      [
        userA,
        brandA,
        queryOne.rows[0].id,
        executionA.rows[0].id,
        `session-one-${suffix}`,
        'Which alpha platform is best?',
        'alpha platform',
      ]
    );
    const runTwo = await client.query(
      `
        insert into query_runs (
          user_id, brand_id, brand_query_id, processing_session_id,
          processing_session_timestamp, query, keyword, category
        ) values ($1, $2, $3, $4, now(), $5, $6, 'Awareness')
        returning id
      `,
      [
        userA,
        brandA,
        queryTwo.rows[0].id,
        `session-two-${suffix}`,
        'Which alpha platforms are best?',
        'alpha platforms',
      ]
    );

    const provider = await client.query(
      `
        insert into provider_results (query_run_id, provider_key, status, cost)
        values ($1, 'perplexity', 'success', 1.25)
        returning id
      `,
      [runOne.rows[0].id]
    );

    await expectDatabaseError(client, 'citation_provider_run_mismatch', '23503', () =>
      client.query(
        `
          insert into citations (
            provider_result_id, query_run_id, brand_id, user_id,
            provider_key, url, domain
          ) values ($1, $2, $3, $4, 'perplexity', $5, $6)
        `,
        [
          provider.rows[0].id,
          runTwo.rows[0].id,
          brandA,
          userA,
          'https://source.example/mismatch',
          'source.example',
        ]
      )
    );
    await expectDatabaseError(client, 'citation_tenant_mismatch', '23503', () =>
      client.query(
        `
          insert into citations (
            provider_result_id, query_run_id, brand_id, user_id,
            provider_key, url, domain
          ) values ($1, $2, $3, $4, 'perplexity', $5, $6)
        `,
        [
          provider.rows[0].id,
          runOne.rows[0].id,
          brandA,
          userB,
          'https://source.example/tenant',
          'source.example',
        ]
      )
    );
    await expectDatabaseError(client, 'citation_provider_key_mismatch', '23503', () =>
      client.query(
        `
          insert into citations (
            provider_result_id, query_run_id, brand_id, user_id,
            provider_key, url, domain
          ) values ($1, $2, $3, $4, 'chatgptsearch', $5, $6)
        `,
        [
          provider.rows[0].id,
          runOne.rows[0].id,
          brandA,
          userA,
          'https://source.example/provider-key',
          'source.example',
        ]
      )
    );

    await expectDatabaseError(client, 'credit_execution_tenant_mismatch', '23503', () =>
      client.query(
        `
          insert into credit_ledger (
            user_id, execution_request_id, idempotency_key,
            entry_type, amount, balance_after, reason
          ) values ($1, $2, $3, 'debit', -1, 999, 'verification')
        `,
        [userB, executionA.rows[0].id, `credit-execution-${suffix}`]
      )
    );
    await expectDatabaseError(client, 'credit_brand_tenant_mismatch', '23503', () =>
      client.query(
        `
          insert into credit_ledger (
            user_id, brand_id, idempotency_key,
            entry_type, amount, balance_after, reason
          ) values ($1, $2, $3, 'debit', -1, 999, 'verification')
        `,
        [userB, brandA, `credit-brand-${suffix}`]
      )
    );

    for (const position of [1, 2]) {
      await client.query(
        `
          insert into citations (
            provider_result_id, query_run_id, brand_id, user_id,
            provider_key, url, domain, position, is_domain_citation
          ) values ($1, $2, $3, $4, 'perplexity', $5, $6, $7, true)
        `,
        [
          provider.rows[0].id,
          runOne.rows[0].id,
          brandA,
          userA,
          `https://source.example/${position}`,
          'source.example',
          position,
        ]
      );
    }

    const rollup = await client.query(
      `
        select citations::integer, domain_citations::integer, total_provider_cost::numeric
        from brand_provider_daily_rollup
        where brand_id = $1 and provider_key = 'perplexity'
      `,
      [brandA]
    );
    assert(rollup.rowCount === 1, 'The provider rollup did not return one row');
    assert(rollup.rows[0].citations === 2, 'The provider rollup citation count is incorrect');
    assert(rollup.rows[0].domain_citations === 2, 'The domain citation count is incorrect');
    assert(Number(rollup.rows[0].total_provider_cost) === 1.25, 'Provider cost was multiplied by citations');

    const job = await client.query(
      `
        insert into reprocessing_jobs (
          user_id, brand_id, processing_session_id,
          processing_session_timestamp, total_queries, credits_required
        ) values ($1, $2, $3, now(), 1, 10)
        returning id
      `,
      [userA, brandA, `job-${suffix}`]
    );
    await client.query(
      `
        insert into reprocessing_job_items (
          job_id, brand_id, user_id, brand_query_id,
          query, keyword, category, position
        ) values ($1, $2, $3, $4, $5, $6, 'Awareness', 0)
      `,
      [
        job.rows[0].id,
        brandA,
        userA,
        queryOne.rows[0].id,
        'Which alpha platform is best?',
        'alpha platform',
      ]
    );
    await expectDatabaseError(client, 'job_item_tenant_mismatch', '23503', () =>
      client.query(
        `
          insert into reprocessing_job_items (
            job_id, brand_id, user_id, query,
            keyword, category, position
          ) values ($1, $2, $3, $4, $5, 'Awareness', 1)
        `,
        [job.rows[0].id, brandA, userB, 'Mismatched job item', 'mismatch']
      )
    );
    await expectDatabaseError(client, 'one_active_job_per_brand', '23505', () =>
      client.query(
        `
          insert into reprocessing_jobs (
            user_id, brand_id, processing_session_id,
            processing_session_timestamp, total_queries, credits_required
          ) values ($1, $2, $3, now(), 1, 10)
        `,
        [userA, brandA, `job-duplicate-${suffix}`]
      )
    );
    await expectDatabaseError(client, 'job_count_integrity', '23514', () =>
      client.query(
        `
          insert into reprocessing_jobs (
            user_id, brand_id, status, processing_session_id,
            processing_session_timestamp, total_queries, attempted_count,
            successful_count, completed_at
          ) values ($1, $2, 'completed', $3, now(), 1, 2, 2, now())
        `,
        [userA, brandA, `job-invalid-count-${suffix}`]
      )
    );

    const disposableBrand = await insertBrand(client, userA, suffix, 'disposable');
    const disposableExecution = await client.query(
      `
        insert into query_execution_requests (
          user_id, brand_id, client_request_id, request_fingerprint
        ) values ($1, $2, $3, $4)
        returning id
      `,
      [userA, disposableBrand, `disposable-${suffix}`, suffix]
    );
    const disposableLedger = await client.query(
      `
        insert into credit_ledger (
          user_id, brand_id, execution_request_id, idempotency_key,
          entry_type, amount, balance_after, reason
        ) values ($1, $2, $3, $4, 'debit', -1, 999, 'verification')
        returning id
      `,
      [
        userA,
        disposableBrand,
        disposableExecution.rows[0].id,
        `disposable-credit-${suffix}`,
      ]
    );
    await client.query('delete from brands where id = $1', [disposableBrand]);
    const deletedBrandLinks = await client.query(
      `
        select
          (select brand_id from query_execution_requests where id = $1) as execution_brand_id,
          (select brand_id from credit_ledger where id = $2) as ledger_brand_id
      `,
      [disposableExecution.rows[0].id, disposableLedger.rows[0].id]
    );
    assert(
      deletedBrandLinks.rows[0].execution_brand_id === null,
      'Deleting a brand did not clear the execution request brand link'
    );
    assert(
      deletedBrandLinks.rows[0].ledger_brand_id === null,
      'Deleting a brand did not clear the credit ledger brand link'
    );

    console.log('Postgres schema verification passed.');
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
