-- Repair ambiguous tracked-query identities and strengthen cross-table tenant
-- integrity. Constraints are NOT VALID so legacy rows can be audited without
-- blocking deployment; PostgreSQL still enforces them for new writes.

drop index if exists brand_queries_identity_unique;
alter table brand_queries drop column tracked_identity;
alter table brand_queries
  add column tracked_identity text generated always as (
    md5(
      length(query)::text || ':' || query ||
      length(keyword)::text || ':' || keyword ||
      length(category)::text || ':' || category
    )
  ) stored;
create unique index brand_queries_identity_unique
  on brand_queries (brand_id, tracked_identity);

drop index if exists query_runs_session_identity_unique;
alter table query_runs drop column tracked_identity;
alter table query_runs
  add column tracked_identity text generated always as (
    md5(
      length(query)::text || ':' || query ||
      length(keyword)::text || ':' || keyword ||
      length(category)::text || ':' || category
    )
  ) stored;
create unique index query_runs_session_identity_unique
  on query_runs (
    coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
    processing_session_id,
    tracked_identity
  );

create unique index if not exists brands_id_user_unique on brands (id, user_id);
create unique index if not exists provider_results_id_run_unique
  on provider_results (id, query_run_id);

alter table query_runs
  add constraint query_runs_brand_user_fk
  foreign key (brand_id, user_id) references brands(id, user_id)
  on delete cascade not valid;

alter table reprocessing_jobs
  add constraint reprocessing_jobs_brand_user_fk
  foreign key (brand_id, user_id) references brands(id, user_id)
  on delete cascade not valid;

alter table citations
  add constraint citations_brand_user_fk
  foreign key (brand_id, user_id) references brands(id, user_id)
  on delete cascade not valid,
  add constraint citations_provider_run_fk
  foreign key (provider_result_id, query_run_id)
  references provider_results(id, query_run_id)
  on delete cascade not valid;

alter table app_users
  add constraint app_users_text_integrity check (
    length(btrim(firebase_uid)) between 1 and 200
    and length(btrim(email)) between 3 and 320
    and length(btrim(display_name)) between 1 and 200
  ) not valid;

alter table query_runs
  add constraint query_runs_value_integrity check (
    length(btrim(processing_session_id)) between 1 and 200
    and length(btrim(query)) between 4 and 500
    and length(btrim(keyword)) between 1 and 160
    and total_provider_cost >= 0
    and (credits_after is null or credits_after >= 0)
  ) not valid;

alter table provider_results
  add constraint provider_results_value_integrity check (
    response_time_ms is null or response_time_ms >= 0
  ) not valid,
  add constraint provider_results_cost_integrity check (cost >= 0) not valid;

alter table citations
  add constraint citations_value_integrity check (
    length(btrim(url)) between 1 and 2048
    and length(btrim(domain)) between 1 and 253
    and (position is null or position >= 1)
  ) not valid;

-- Pre-aggregate citations before joining them to provider results. The old
-- view repeated each provider's cost once per citation.
create or replace view brand_provider_daily_rollup as
with citation_counts as (
  select
    provider_result_id,
    count(*) as citations,
    count(*) filter (where is_domain_citation) as domain_citations
  from citations
  group by provider_result_id
)
select
  qr.brand_id,
  date_trunc('day', qr.created_at)::date as metric_date,
  pr.provider_key,
  count(distinct qr.id) as queries_processed,
  count(*) filter (where pr.status = 'success') as successful_provider_results,
  sum(coalesce(c.citations, 0))::bigint as citations,
  sum(coalesce(c.domain_citations, 0))::bigint as domain_citations,
  avg(pr.response_time_ms) filter (where pr.response_time_ms is not null) as average_response_time_ms,
  sum(pr.cost) as total_provider_cost
from query_runs qr
join provider_results pr on pr.query_run_id = qr.id
left join citation_counts c on c.provider_result_id = pr.id
where qr.brand_id is not null
group by qr.brand_id, date_trunc('day', qr.created_at)::date, pr.provider_key;
