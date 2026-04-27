# Postgres Source Of Truth Plan

## Decision

Firebase should remain the authentication provider only. App-owned state moves to
Postgres:

- users and profile metadata
- brands and generated tracked queries
- credit balances and credit ledger
- query execution idempotency
- query runs, provider results, and citations
- reprocessing jobs
- rate limit counters
- provider response cache
- analytics projections

Firestore should be phased out for application data after backfill and parity
checks. During migration, avoid dual-writing the same entity from hot request
paths unless an outbox/retry path owns reconciliation.

## Minimal AWS Cost Target

Use the smallest managed Postgres option first. Do not add Redis, Kafka, RDS
Proxy, Aurora, read replicas, or Multi-AZ until usage proves they are needed.

Recommended starting shapes:

- If the AWS account is eligible for current RDS free-tier credits, start with
  Single-AZ RDS PostgreSQL on `db.t4g.micro` or `db.t3.micro` and minimal gp
  storage.
- If predictable fixed cost matters more than free-tier eligibility, use the
  smallest Lightsail managed PostgreSQL database.
- If the Next app stays on Vercel, prefer RDS PostgreSQL with strict SSL and a
  low server-side connection pool. Lightsail private databases are simplest
  when the app also runs inside Lightsail/AWS.
- If the app moves fully onto AWS, a small Lightsail instance/container plus
  Lightsail managed Postgres is the cheapest simple deployment shape.

## Why Postgres Solves The Current Risks

Credits, ledgers, idempotency, and query metadata become enforceable with SQL
transactions and unique constraints. Query results become independent rows
instead of array rewrites on one Firestore brand document. Analytics become
normal SQL rollups instead of fragile Firestore projections.

The most important invariant is:

```text
One successful charge -> one credit_ledger row -> optional one query_run -> many provider_results -> many citations
```

That relationship is enforceable with foreign keys and unique indexes.

## Migration Order

1. Add Postgres schema.
   Run `db/migrations/0001_initial_postgres_schema.sql` against a new empty
   database.

2. Add server-only Postgres connection code.
   Read `DATABASE_URL` from server env only. Do not expose it to the browser.

3. Move user profile creation to SQL.
   Firebase Auth continues to issue identity tokens. On sign-in, verify the
   Firebase token server-side and upsert `app_users.firebase_uid`.

4. Move credits and ledger to SQL.
   This is the first high-value runtime migration. Credit debits/refunds should
   happen in SQL transactions using row locks on `app_users`.

5. Move brands and tracked queries to SQL.
   `brands` owns company metadata. `brand_queries` owns each generated query.
   Firestore brand writes stop after this step.

6. Move query execution to SQL.
   `query_execution_requests` replaces the Firestore idempotency ledger.
   `query_runs`, `provider_results`, and `citations` replace
   `queryProcessingResults`, detailed result docs, and brand-level result blobs.

7. Move dashboard reads to SQL.
   Use direct SQL rollups from `query_runs`, `provider_results`, and
   `citations`. The `brand_provider_daily_rollup` view aggregates these on
   demand; add a materialized rollup only if measured latency requires it.

8. Backfill Firestore data.
   Import existing users, brands, queries, historical query results, and credit
   state. Keep legacy Firestore ids in `legacy_firestore_id` fields for
   traceability.

9. Flip read paths to SQL.
   Read SQL first. Only keep Firestore fallback during the verification window.

10. Remove Firestore app-data writes.
    After parity checks pass, Firestore rules should deny all app data except
    anything still required for temporary migration reads.

## Transaction Boundaries

Do not hold SQL transactions open while calling external AI providers.

For `/api/user-query`, the target flow is:

```text
1. Transaction: acquire idempotency row and reserve/debit credits.
2. Outside transaction: call providers.
3. Transaction: write query_run, provider_results, citations, ledger final state.
4. If all providers fail: transactionally refund or mark the debit reversed.
```

This avoids long DB locks while still making billing and stored results
consistent.

## Backfill Mapping

Firestore `users/{uid}` maps to `app_users`.

Firestore `v8userbrands/{brandId}` maps to `brands`.

Brand `queries[]` maps to `brand_queries`.

Append-only Firestore `v8userbrands/{brandId}/query_results/{resultId}` maps to
`query_runs` plus `provider_results`.

Extracted provider citations map to `citations`.

Firestore `v8_query_executions` maps to `query_execution_requests`.

Firestore `v8_reprocessing_jobs` maps to `reprocessing_jobs` and
`reprocessing_job_items`.

Firestore `v8_rate_limits` maps to `rate_limit_buckets`.

Firestore `v8_provider_response_cache` maps to `provider_response_cache`.

## Cutover Rule

One entity should have one write owner at a time. For example, once credits move
to SQL, Firestore credits become read-only legacy data and must not be updated
by app code.

If a future flow ever needs to commit DB state and notify an external system
atomically, reintroduce a transactional outbox table at that point — there is
no current consumer, so no outbox lives in the schema today.
