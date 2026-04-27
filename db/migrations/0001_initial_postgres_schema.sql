-- Postgres source-of-truth schema for GenOS app data.
--
-- Firebase Auth can remain the identity provider. App-owned state moves here:
-- users, brands, credits, query execution, provider results, citations,
-- idempotency, rate limits, cache, jobs, and analytics projections.

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table app_users (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text not null unique,
  email text not null,
  display_name text not null,
  photo_url text,
  credit_balance integer not null default 1000 check (credit_balance >= 0),
  is_new_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index app_users_email_lower_unique on app_users (lower(email));

create trigger app_users_set_updated_at
before update on app_users
for each row execute function set_updated_at();

create table brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  legacy_firestore_id text unique,
  domain text not null,
  website text,
  company_name text not null,
  short_description text,
  products_and_services text[] not null default '{}',
  keywords text[] not null default '{}',
  setup_complete boolean not null default false,
  current_step integer not null default 1 check (current_step >= 1),
  ai_analysis jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index brands_user_domain_unique on brands (user_id, lower(domain));
create index brands_user_id_idx on brands (user_id);

create trigger brands_set_updated_at
before update on brands
for each row execute function set_updated_at();

create table brand_queries (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  query text not null,
  keyword text not null default 'unknown',
  category text not null default 'unknown',
  contains_brand boolean not null default false,
  selected boolean not null default true,
  position integer,
  tracked_identity text generated always as (
    md5(query || '::' || keyword || '::' || category)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_queries_category_check check (
    category in ('Awareness', 'Interest', 'Consideration', 'Purchase', 'unknown')
  )
);

create unique index brand_queries_identity_unique on brand_queries (brand_id, tracked_identity);
create index brand_queries_brand_selected_idx on brand_queries (brand_id, selected);

create trigger brand_queries_set_updated_at
before update on brand_queries
for each row execute function set_updated_at();

create table query_execution_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  client_request_id text not null,
  request_fingerprint text not null,
  status text not null default 'processing',
  processing_session_id text,
  processing_session_timestamp timestamptz,
  query_preview text,
  attempt_count integer not null default 1 check (attempt_count >= 1),
  lease_expires_at timestamptz,
  replay_response jsonb,
  last_error jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint query_execution_status_check check (
    status in ('processing', 'completed', 'failed')
  )
);

create unique index query_execution_idempotency_unique
on query_execution_requests (user_id, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), client_request_id);

create index query_execution_active_idx
on query_execution_requests (status, lease_expires_at)
where status = 'processing';

create trigger query_execution_requests_set_updated_at
before update on query_execution_requests
for each row execute function set_updated_at();

create table query_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  brand_query_id uuid references brand_queries(id) on delete set null,
  execution_request_id uuid references query_execution_requests(id) on delete set null,
  processing_session_id text not null,
  processing_session_timestamp timestamptz not null,
  query text not null,
  keyword text not null default 'unknown',
  category text not null default 'unknown',
  tracked_identity text generated always as (
    md5(query || '::' || keyword || '::' || category)
  ) stored,
  source text not null default 'user-query',
  status text not null default 'completed',
  credit_cost integer not null default 0 check (credit_cost >= 0),
  credits_after integer,
  total_provider_cost numeric(12, 6) not null default 0,
  legacy_firestore_result_id text,
  raw_result jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint query_runs_status_check check (
    status in ('queued', 'processing', 'completed', 'partial', 'failed', 'cancelled')
  )
);

create unique index query_runs_session_identity_unique
on query_runs (
  coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
  processing_session_id,
  tracked_identity
);

create index query_runs_user_created_idx on query_runs (user_id, created_at desc);
create index query_runs_brand_created_idx on query_runs (brand_id, created_at desc);
create index query_runs_brand_query_idx on query_runs (brand_query_id);

create trigger query_runs_set_updated_at
before update on query_runs
for each row execute function set_updated_at();

create table provider_results (
  id uuid primary key default gen_random_uuid(),
  query_run_id uuid not null references query_runs(id) on delete cascade,
  provider_key text not null,
  status text not null,
  response_text text,
  error_message text,
  response_time_ms integer,
  cost numeric(12, 6) not null default 0,
  token_count jsonb,
  provider_metadata jsonb not null default '{}'::jsonb,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_results_provider_check check (
    provider_key in ('chatgptsearch', 'google-ai-overview', 'google-gemini', 'perplexity')
  ),
  constraint provider_results_status_check check (
    status in ('success', 'error', 'timeout', 'skipped')
  )
);

create unique index provider_results_query_provider_unique
on provider_results (query_run_id, provider_key);

create index provider_results_provider_created_idx
on provider_results (provider_key, created_at desc);

create trigger provider_results_set_updated_at
before update on provider_results
for each row execute function set_updated_at();

create table citations (
  id uuid primary key default gen_random_uuid(),
  provider_result_id uuid not null references provider_results(id) on delete cascade,
  query_run_id uuid not null references query_runs(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  provider_key text not null,
  url text not null,
  domain text not null,
  title text,
  citation_text text,
  source text,
  raw_kind text,
  position integer,
  is_brand_mention boolean not null default false,
  is_domain_citation boolean not null default false,
  raw_citation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index citations_brand_created_idx on citations (brand_id, created_at desc);
create index citations_brand_domain_idx on citations (brand_id, domain);
create index citations_query_run_idx on citations (query_run_id);
create index citations_provider_idx on citations (provider_key);

create table credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  query_run_id uuid references query_runs(id) on delete set null,
  execution_request_id uuid references query_execution_requests(id) on delete set null,
  idempotency_key text not null,
  entry_type text not null,
  amount integer not null check (amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint credit_ledger_type_check check (
    entry_type in ('debit', 'credit', 'refund', 'adjustment')
  )
);

create unique index credit_ledger_idempotency_unique
on credit_ledger (user_id, idempotency_key);

create index credit_ledger_user_created_idx
on credit_ledger (user_id, created_at desc);

create table reprocessing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  status text not null default 'queued',
  processing_session_id text not null,
  processing_session_timestamp timestamptz not null,
  total_queries integer not null check (total_queries >= 0),
  successful_count integer not null default 0 check (successful_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  attempted_count integer not null default 0 check (attempted_count >= 0),
  credits_required integer not null default 0 check (credits_required >= 0),
  credits_used integer not null default 0 check (credits_used >= 0),
  current_index integer not null default 0 check (current_index >= 0),
  cancellation_requested boolean not null default false,
  runner_lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reprocessing_jobs_status_check check (
    status in ('queued', 'processing', 'completed', 'failed', 'cancelled')
  )
);

create index reprocessing_jobs_brand_status_idx on reprocessing_jobs (brand_id, status);
create index reprocessing_jobs_user_created_idx on reprocessing_jobs (user_id, created_at desc);

create trigger reprocessing_jobs_set_updated_at
before update on reprocessing_jobs
for each row execute function set_updated_at();

create table reprocessing_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references reprocessing_jobs(id) on delete cascade,
  brand_query_id uuid references brand_queries(id) on delete set null,
  query_run_id uuid references query_runs(id) on delete set null,
  query text not null,
  keyword text not null default 'unknown',
  category text not null default 'unknown',
  position integer not null,
  status text not null default 'queued',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reprocessing_job_items_status_check check (
    status in ('queued', 'processing', 'completed', 'failed', 'skipped')
  )
);

create unique index reprocessing_job_items_position_unique
on reprocessing_job_items (job_id, position);

create index reprocessing_job_items_job_status_idx
on reprocessing_job_items (job_id, status);

create trigger reprocessing_job_items_set_updated_at
before update on reprocessing_job_items
for each row execute function set_updated_at();

create table rate_limit_buckets (
  bucket_id text primary key,
  count integer not null default 0 check (count >= 0),
  limit_count integer not null check (limit_count > 0),
  window_ms integer not null check (window_ms > 0),
  window_start_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index rate_limit_buckets_expires_idx on rate_limit_buckets (expires_at);

create table provider_response_cache (
  cache_key text primary key,
  purpose text not null default 'default',
  prompt_hash text not null,
  providers text[] not null,
  result jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index provider_response_cache_expires_idx on provider_response_cache (expires_at);

create trigger provider_response_cache_set_updated_at
before update on provider_response_cache
for each row execute function set_updated_at();

create table brand_daily_metrics (
  brand_id uuid not null references brands(id) on delete cascade,
  metric_date date not null,
  provider_key text not null default 'all',
  queries_processed integer not null default 0,
  successful_provider_results integer not null default 0,
  brand_mentions integer not null default 0,
  citations integer not null default 0,
  domain_citations integer not null default 0,
  total_response_time_ms bigint not null default 0,
  total_provider_cost numeric(12, 6) not null default 0,
  calculated_at timestamptz not null default now(),
  primary key (brand_id, metric_date, provider_key)
);

create index brand_daily_metrics_brand_date_idx
on brand_daily_metrics (brand_id, metric_date desc);

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbox_events_status_check check (
    status in ('pending', 'processing', 'processed', 'failed')
  )
);

create index outbox_events_pending_idx
on outbox_events (status, next_attempt_at)
where status in ('pending', 'failed');

create trigger outbox_events_set_updated_at
before update on outbox_events
for each row execute function set_updated_at();

create or replace view brand_provider_daily_rollup as
select
  qr.brand_id,
  date_trunc('day', qr.created_at)::date as metric_date,
  pr.provider_key,
  count(distinct qr.id) as queries_processed,
  count(*) filter (where pr.status = 'success') as successful_provider_results,
  count(c.id) as citations,
  count(c.id) filter (where c.is_domain_citation) as domain_citations,
  avg(pr.response_time_ms) filter (where pr.response_time_ms is not null) as average_response_time_ms,
  sum(pr.cost) as total_provider_cost
from query_runs qr
join provider_results pr on pr.query_run_id = qr.id
left join citations c on c.provider_result_id = pr.id
where qr.brand_id is not null
group by qr.brand_id, date_trunc('day', qr.created_at)::date, pr.provider_key;
