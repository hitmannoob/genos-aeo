-- SQLite source-of-truth schema for a single-host Genos deployment.
-- Firebase remains the identity provider; all application-owned state lives
-- in this file-backed database.

create table app_users (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  firebase_uid text not null unique check (length(trim(firebase_uid)) between 1 and 200),
  email text not null check (length(trim(email)) between 3 and 320),
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  photo_url text,
  credit_balance integer not null default 1000 check (credit_balance >= 0),
  is_new_user integer not null default 0 check (is_new_user in (0, 1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at text
) strict;

create unique index app_users_email_lower_unique on app_users (lower(email));

create table brands (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  user_id text not null references app_users(id) on delete cascade,
  legacy_firestore_id text unique,
  domain text not null check (length(trim(domain)) between 1 and 253),
  website text,
  company_name text not null check (length(trim(company_name)) between 1 and 200),
  short_description text,
  products_and_services text not null default '[]'
    check (json_valid(products_and_services) and json_array_length(products_and_services) <= 20),
  keywords text not null default '[]'
    check (json_valid(keywords) and json_array_length(keywords) <= 20),
  setup_complete integer not null default 0 check (setup_complete in (0, 1)),
  current_step integer not null default 1 check (current_step >= 1),
  ai_analysis text check (ai_analysis is null or json_valid(ai_analysis)),
  raw_metadata text not null default '{}' check (json_valid(raw_metadata)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (id, user_id)
) strict;

create unique index brands_user_domain_unique on brands (user_id, lower(domain));
create index brands_user_id_idx on brands (user_id);

create table brand_queries (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  brand_id text not null references brands(id) on delete cascade,
  query text not null check (length(trim(query)) between 4 and 500),
  keyword text not null default 'unknown' check (length(trim(keyword)) between 1 and 160),
  category text not null default 'unknown'
    check (category in ('Awareness', 'Interest', 'Consideration', 'Purchase', 'unknown')),
  contains_brand integer not null default 0 check (contains_brand in (0, 1)),
  selected integer not null default 1 check (selected in (0, 1)),
  position integer,
  tracked_identity text generated always as (
    cast(length(query) as text) || ':' || query ||
    cast(length(keyword) as text) || ':' || keyword ||
    cast(length(category) as text) || ':' || category
  ) stored,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (id, brand_id)
) strict;

create unique index brand_queries_identity_unique on brand_queries (brand_id, tracked_identity);
create index brand_queries_brand_selected_idx on brand_queries (brand_id, selected);

create table query_execution_requests (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  user_id text not null references app_users(id) on delete cascade,
  brand_id text,
  client_request_id text not null check (length(trim(client_request_id)) between 1 and 160),
  request_fingerprint text not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  processing_session_id text,
  processing_session_timestamp text,
  query_preview text,
  attempt_count integer not null default 1 check (attempt_count >= 1),
  lease_expires_at text,
  replay_response text check (replay_response is null or json_valid(replay_response)),
  last_error text check (last_error is null or json_valid(last_error)),
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at text,
  failed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  foreign key (brand_id, user_id) references brands(id, user_id),
  unique (id, user_id)
) strict;

create unique index query_execution_idempotency_unique
  on query_execution_requests (
    user_id,
    coalesce(brand_id, '00000000-0000-0000-0000-000000000000'),
    client_request_id
  );
create index query_execution_active_idx on query_execution_requests (status, lease_expires_at)
  where status = 'processing';

create table query_runs (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  user_id text not null references app_users(id) on delete cascade,
  brand_id text,
  brand_query_id text,
  execution_request_id text,
  processing_session_id text not null check (length(trim(processing_session_id)) between 1 and 200),
  processing_session_timestamp text not null,
  query text not null check (length(trim(query)) between 4 and 500),
  keyword text not null default 'unknown' check (length(trim(keyword)) between 1 and 160),
  category text not null default 'unknown',
  tracked_identity text generated always as (
    cast(length(query) as text) || ':' || query ||
    cast(length(keyword) as text) || ':' || keyword ||
    cast(length(category) as text) || ':' || category
  ) stored,
  source text not null default 'user-query',
  status text not null default 'completed'
    check (status in ('queued', 'processing', 'completed', 'partial', 'failed', 'cancelled')),
  credit_cost integer not null default 0 check (credit_cost >= 0),
  credits_after integer check (credits_after is null or credits_after >= 0),
  total_provider_cost real not null default 0 check (total_provider_cost >= 0),
  legacy_firestore_result_id text,
  raw_result text not null default '{}' check (json_valid(raw_result)),
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  foreign key (brand_id, user_id) references brands(id, user_id) on delete cascade,
  foreign key (brand_query_id, brand_id) references brand_queries(id, brand_id),
  foreign key (execution_request_id, user_id) references query_execution_requests(id, user_id),
  unique (id, user_id),
  unique (id, brand_id, user_id)
) strict;

create unique index query_runs_session_identity_unique
  on query_runs (
    coalesce(brand_id, '00000000-0000-0000-0000-000000000000'),
    processing_session_id,
    tracked_identity
  );
create index query_runs_user_created_idx on query_runs (user_id, created_at desc);
create index query_runs_brand_created_idx on query_runs (brand_id, created_at desc);
create index query_runs_brand_query_idx on query_runs (brand_query_id);

create table provider_results (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  query_run_id text not null references query_runs(id) on delete cascade,
  provider_key text not null
    check (provider_key in ('chatgptsearch', 'google-ai-overview', 'google-gemini', 'perplexity')),
  status text not null check (status in ('success', 'error', 'timeout', 'skipped')),
  response_text text,
  error_message text,
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  cost real not null default 0 check (cost >= 0),
  token_count text check (token_count is null or json_valid(token_count)),
  provider_metadata text not null default '{}' check (json_valid(provider_metadata)),
  raw_response text not null default '{}' check (json_valid(raw_response)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (query_run_id, provider_key),
  unique (id, query_run_id),
  unique (id, query_run_id, provider_key)
) strict;

create index provider_results_provider_created_idx on provider_results (provider_key, created_at desc);

create table citations (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  provider_result_id text not null,
  query_run_id text not null,
  brand_id text,
  user_id text not null references app_users(id) on delete cascade,
  provider_key text not null,
  url text not null check (length(trim(url)) between 1 and 2048),
  domain text not null check (length(trim(domain)) between 1 and 253),
  title text,
  citation_text text,
  source text,
  raw_kind text,
  position integer check (position is null or position >= 1),
  is_brand_mention integer not null default 0 check (is_brand_mention in (0, 1)),
  is_domain_citation integer not null default 0 check (is_domain_citation in (0, 1)),
  raw_citation text not null default '{}' check (json_valid(raw_citation)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  foreign key (brand_id, user_id) references brands(id, user_id) on delete cascade,
  foreign key (query_run_id, user_id) references query_runs(id, user_id) on delete cascade,
  foreign key (query_run_id, brand_id, user_id) references query_runs(id, brand_id, user_id) on delete cascade,
  foreign key (provider_result_id, query_run_id, provider_key)
    references provider_results(id, query_run_id, provider_key) on delete cascade
) strict;

create index citations_brand_created_idx on citations (brand_id, created_at desc);
create index citations_brand_domain_idx on citations (brand_id, domain);
create index citations_query_run_idx on citations (query_run_id);
create index citations_provider_idx on citations (provider_key);

create table credit_ledger (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  user_id text not null references app_users(id) on delete cascade,
  brand_id text,
  query_run_id text,
  execution_request_id text,
  idempotency_key text not null,
  entry_type text not null check (entry_type in ('debit', 'credit', 'refund', 'adjustment')),
  amount integer not null check (amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  metadata text not null default '{}' check (json_valid(metadata)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  foreign key (brand_id, user_id) references brands(id, user_id),
  foreign key (query_run_id, user_id) references query_runs(id, user_id),
  foreign key (query_run_id, brand_id, user_id) references query_runs(id, brand_id, user_id),
  foreign key (execution_request_id, user_id) references query_execution_requests(id, user_id),
  unique (user_id, idempotency_key)
) strict;

create index credit_ledger_user_created_idx on credit_ledger (user_id, created_at desc);

create table reprocessing_jobs (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  user_id text not null references app_users(id) on delete cascade,
  brand_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  processing_session_id text not null,
  processing_session_timestamp text not null,
  total_queries integer not null check (total_queries >= 0),
  successful_count integer not null default 0 check (successful_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  attempted_count integer not null default 0 check (attempted_count >= 0),
  credits_required integer not null default 0 check (credits_required >= 0),
  credits_used integer not null default 0 check (credits_used >= 0),
  current_index integer not null default 0 check (current_index >= 0),
  cancellation_requested integer not null default 0 check (cancellation_requested in (0, 1)),
  runner_lease_expires_at text,
  last_heartbeat_at text,
  started_at text,
  completed_at text,
  cancelled_at text,
  failed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check (
    successful_count + failed_count <= attempted_count and
    attempted_count <= total_queries and
    current_index <= total_queries and
    credits_used <= credits_required
  ),
  foreign key (brand_id, user_id) references brands(id, user_id) on delete cascade,
  unique (id, brand_id, user_id)
) strict;

create index reprocessing_jobs_brand_status_idx on reprocessing_jobs (brand_id, status);
create index reprocessing_jobs_user_created_idx on reprocessing_jobs (user_id, created_at desc);
create unique index reprocessing_jobs_one_active_per_brand on reprocessing_jobs (brand_id)
  where status in ('queued', 'processing');

create table reprocessing_job_items (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  job_id text not null,
  brand_id text not null,
  user_id text not null,
  brand_query_id text,
  query_run_id text,
  query text not null check (length(trim(query)) between 4 and 500),
  keyword text not null default 'unknown' check (length(trim(keyword)) between 1 and 160),
  category text not null default 'unknown',
  position integer not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'skipped')),
  error_message text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  foreign key (job_id, brand_id, user_id)
    references reprocessing_jobs(id, brand_id, user_id) on delete cascade,
  foreign key (brand_query_id, brand_id) references brand_queries(id, brand_id),
  foreign key (query_run_id, brand_id, user_id) references query_runs(id, brand_id, user_id),
  unique (job_id, position)
) strict;

create index reprocessing_job_items_job_status_idx on reprocessing_job_items (job_id, status);

create table rate_limit_buckets (
  bucket_id text primary key,
  count integer not null default 0 check (count >= 0),
  limit_count integer not null check (limit_count > 0),
  window_ms integer not null check (window_ms > 0),
  window_start_at text not null,
  expires_at text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) strict;

create index rate_limit_buckets_expires_idx on rate_limit_buckets (expires_at);

create table provider_response_cache (
  cache_key text primary key,
  purpose text not null default 'default',
  prompt_hash text not null,
  providers text not null check (json_valid(providers)),
  result text not null check (json_valid(result)),
  expires_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) strict;

create index provider_response_cache_expires_idx on provider_response_cache (expires_at);

create view brand_provider_daily_rollup as
with citation_counts as (
  select
    provider_result_id,
    count(*) as citations,
    count(*) filter (where is_domain_citation = 1) as domain_citations
  from citations
  group by provider_result_id
)
select
  qr.brand_id,
  substr(qr.created_at, 1, 10) as metric_date,
  pr.provider_key,
  count(distinct qr.id) as queries_processed,
  count(*) filter (where pr.status = 'success') as successful_provider_results,
  sum(coalesce(c.citations, 0)) as citations,
  sum(coalesce(c.domain_citations, 0)) as domain_citations,
  avg(pr.response_time_ms) filter (where pr.response_time_ms is not null) as average_response_time_ms,
  sum(pr.cost) as total_provider_cost
from query_runs qr
join provider_results pr on pr.query_run_id = qr.id
left join citation_counts c on c.provider_result_id = pr.id
where qr.brand_id is not null
group by qr.brand_id, substr(qr.created_at, 1, 10), pr.provider_key;

create trigger app_users_set_updated_at after update on app_users
when new.updated_at = old.updated_at begin
  update app_users set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger brands_set_updated_at after update on brands
when new.updated_at = old.updated_at begin
  update brands set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger brand_queries_set_updated_at after update on brand_queries
when new.updated_at = old.updated_at begin
  update brand_queries set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger query_execution_requests_set_updated_at after update on query_execution_requests
when new.updated_at = old.updated_at begin
  update query_execution_requests set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger query_runs_set_updated_at after update on query_runs
when new.updated_at = old.updated_at begin
  update query_runs set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger provider_results_set_updated_at after update on provider_results
when new.updated_at = old.updated_at begin
  update provider_results set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger reprocessing_jobs_set_updated_at after update on reprocessing_jobs
when new.updated_at = old.updated_at begin
  update reprocessing_jobs set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger reprocessing_job_items_set_updated_at after update on reprocessing_job_items
when new.updated_at = old.updated_at begin
  update reprocessing_job_items set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
create trigger provider_response_cache_set_updated_at after update on provider_response_cache
when new.updated_at = old.updated_at begin
  update provider_response_cache set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where cache_key = new.cache_key;
end;
