import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({
  path: [path.join(rootDir, '.env.local'), path.join(rootDir, '.env')],
  quiet: true,
});

if (process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true') {
  throw new Error('Set ALLOW_DATABASE_INTEGRATION_TESTS=true to run SQLite integration checks');
}

const target = path.resolve(rootDir, process.env.SQLITE_PATH?.trim() || './data/genos.sqlite3');
const database = new DatabaseSync(target, { timeout: 5_000, defensive: true });
database.exec('pragma foreign_keys = on');

const requiredTables = [
  'app_users',
  'brands',
  'brand_queries',
  'query_execution_requests',
  'query_runs',
  'provider_results',
  'citations',
  'credit_ledger',
  'reprocessing_jobs',
  'reprocessing_job_items',
  'rate_limit_buckets',
  'provider_response_cache',
  'schema_migrations',
];

function requireConstraintFailure(operation, label) {
  let rejected = false;
  try {
    operation();
  } catch {
    rejected = true;
  }
  if (!rejected) {
    throw new Error(`${label} was not rejected`);
  }
}

try {
  const integrity = database.prepare('pragma integrity_check').get();
  if (integrity?.integrity_check !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
  }

  const foreignKeyErrors = database.prepare('pragma foreign_key_check').all();
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Foreign-key violations found: ${JSON.stringify(foreignKeyErrors)}`);
  }

  const actualTables = new Set(
    database.prepare("select name from sqlite_master where type = 'table'").all()
      .map((row) => row.name)
  );
  for (const table of requiredTables) {
    if (!actualTables.has(table)) {
      throw new Error(`Missing required table: ${table}`);
    }
  }

  database.exec('begin immediate');
  try {
    const suffix = `${process.pid}-${Date.now()}`;
    const userId = database.prepare(`
      insert into app_users (firebase_uid, email, display_name)
      values (?, ?, ?)
      returning id
    `).get(`verify-user-${suffix}`, `verify-${suffix}@example.test`, 'Schema verification').id;

    const otherUserId = database.prepare(`
      insert into app_users (firebase_uid, email, display_name)
      values (?, ?, ?)
      returning id
    `).get(`verify-other-${suffix}`, `verify-other-${suffix}@example.test`, 'Other user').id;

    const brandId = database.prepare(`
      insert into brands (user_id, domain, company_name)
      values (?, ?, ?)
      returning id
    `).get(userId, `verify-${suffix}.example`, 'Verification Brand').id;

    const brandQueryId = database.prepare(`
      insert into brand_queries (brand_id, query, keyword, category)
      values (?, ?, ?, ?)
      returning id
    `).get(brandId, 'What verifies this SQLite schema?', 'verification', 'Awareness').id;

    const executionId = database.prepare(`
      insert into query_execution_requests (
        user_id, brand_id, client_request_id, request_fingerprint
      ) values (?, ?, ?, ?)
      returning id
    `).get(userId, brandId, `request-${suffix}`, 'fingerprint').id;

    const queryRunId = database.prepare(`
      insert into query_runs (
        user_id, brand_id, brand_query_id, execution_request_id,
        processing_session_id, processing_session_timestamp,
        query, keyword, category, raw_result
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      returning id
    `).get(
      userId,
      brandId,
      brandQueryId,
      executionId,
      `session-${suffix}`,
      new Date().toISOString(),
      'What verifies this SQLite schema?',
      'verification',
      'Awareness',
      '{}'
    ).id;

    const providerResultId = database.prepare(`
      insert into provider_results (query_run_id, provider_key, status)
      values (?, 'chatgptsearch', 'success')
      returning id
    `).get(queryRunId).id;

    database.prepare(`
      insert into citations (
        provider_result_id, query_run_id, brand_id, user_id,
        provider_key, url, domain
      ) values (?, ?, ?, ?, 'chatgptsearch', ?, ?)
    `).run(
      providerResultId,
      queryRunId,
      brandId,
      userId,
      'https://example.test/verification',
      'example.test'
    );

    database.prepare(`
      insert into credit_ledger (
        user_id, brand_id, query_run_id, execution_request_id,
        idempotency_key, entry_type, amount, balance_after, reason
      ) values (?, ?, ?, ?, ?, 'debit', -1, 999, 'verification')
    `).run(userId, brandId, queryRunId, executionId, `ledger-${suffix}`);

    const jobId = database.prepare(`
      insert into reprocessing_jobs (
        user_id, brand_id, processing_session_id,
        processing_session_timestamp, total_queries, credits_required
      ) values (?, ?, ?, ?, 1, 10)
      returning id
    `).get(userId, brandId, `job-session-${suffix}`, new Date().toISOString()).id;

    database.prepare(`
      insert into reprocessing_job_items (
        job_id, brand_id, user_id, brand_query_id,
        query, keyword, category, position
      ) values (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      jobId,
      brandId,
      userId,
      brandQueryId,
      'What verifies this SQLite schema?',
      'verification',
      'Awareness'
    );

    requireConstraintFailure(
      () => database.prepare(`
        insert into query_execution_requests (
          user_id, brand_id, client_request_id, request_fingerprint
        ) values (?, ?, ?, ?)
      `).run(otherUserId, brandId, `cross-tenant-${suffix}`, 'fingerprint'),
      'Cross-tenant query execution request'
    );

    requireConstraintFailure(
      () => database.prepare(`
        insert into reprocessing_jobs (
          user_id, brand_id, processing_session_id,
          processing_session_timestamp, total_queries, credits_required
        ) values (?, ?, ?, ?, 1, 10)
      `).run(userId, brandId, `duplicate-job-${suffix}`, new Date().toISOString()),
      'Second active reprocessing job'
    );

    const rollup = database.prepare(`
      select queries_processed
      from brand_provider_daily_rollup
      where brand_id = ? and provider_key = 'chatgptsearch'
    `).get(brandId);
    if (Number(rollup?.queries_processed ?? 0) !== 1) {
      throw new Error('Daily provider rollup did not return the inserted query run');
    }

    database.exec('rollback');
  } catch (error) {
    database.exec('rollback');
    throw error;
  }

  console.log(`SQLite schema verification passed: ${target}`);
} finally {
  database.close();
}
