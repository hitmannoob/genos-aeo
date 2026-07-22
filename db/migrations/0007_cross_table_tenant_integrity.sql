-- Close the remaining cross-table ownership gaps. A UUID foreign key proves
-- that a row exists; these composite keys also prove that linked rows belong
-- to the same user and brand. This migration intentionally validates existing
-- data and fails rather than silently preserving cross-tenant relationships.

create unique index brand_queries_id_brand_unique
  on brand_queries (id, brand_id);
create unique index query_execution_requests_id_user_unique
  on query_execution_requests (id, user_id);
create unique index query_runs_id_user_unique
  on query_runs (id, user_id);
create unique index query_runs_id_brand_user_unique
  on query_runs (id, brand_id, user_id);
create unique index provider_results_id_run_provider_unique
  on provider_results (id, query_run_id, provider_key);
create unique index reprocessing_jobs_id_brand_user_unique
  on reprocessing_jobs (id, brand_id, user_id);

alter table query_execution_requests
  add constraint query_execution_requests_brand_user_fk
  foreign key (brand_id, user_id) references brands(id, user_id)
  not valid;

alter table query_runs
  add constraint query_runs_brand_query_fk
  foreign key (brand_query_id, brand_id) references brand_queries(id, brand_id)
  not valid,
  add constraint query_runs_execution_user_fk
  foreign key (execution_request_id, user_id)
  references query_execution_requests(id, user_id)
  not valid;

alter table citations
  add constraint citations_run_user_fk
  foreign key (query_run_id, user_id) references query_runs(id, user_id)
  on delete cascade not valid,
  add constraint citations_run_brand_user_fk
  foreign key (query_run_id, brand_id, user_id)
  references query_runs(id, brand_id, user_id)
  on delete cascade not valid,
  add constraint citations_provider_run_key_fk
  foreign key (provider_result_id, query_run_id, provider_key)
  references provider_results(id, query_run_id, provider_key)
  on delete cascade not valid;

alter table credit_ledger
  add constraint credit_ledger_brand_user_fk
  foreign key (brand_id, user_id) references brands(id, user_id)
  not valid,
  add constraint credit_ledger_run_user_fk
  foreign key (query_run_id, user_id) references query_runs(id, user_id)
  not valid,
  add constraint credit_ledger_run_brand_user_fk
  foreign key (query_run_id, brand_id, user_id)
  references query_runs(id, brand_id, user_id)
  not valid,
  add constraint credit_ledger_execution_user_fk
  foreign key (execution_request_id, user_id)
  references query_execution_requests(id, user_id)
  not valid;

alter table reprocessing_job_items
  add column brand_id uuid,
  add column user_id uuid;

update reprocessing_job_items item
set brand_id = job.brand_id,
    user_id = job.user_id
from reprocessing_jobs job
where job.id = item.job_id;

alter table reprocessing_job_items
  alter column brand_id set not null,
  alter column user_id set not null,
  add constraint reprocessing_job_items_job_tenant_fk
  foreign key (job_id, brand_id, user_id)
  references reprocessing_jobs(id, brand_id, user_id)
  on delete cascade not valid,
  add constraint reprocessing_job_items_brand_query_fk
  foreign key (brand_query_id, brand_id)
  references brand_queries(id, brand_id)
  not valid,
  add constraint reprocessing_job_items_query_run_fk
  foreign key (query_run_id, brand_id, user_id)
  references query_runs(id, brand_id, user_id)
  not valid;

alter table query_execution_requests
  validate constraint query_execution_requests_brand_user_fk;

alter table query_runs
  validate constraint query_runs_brand_query_fk,
  validate constraint query_runs_execution_user_fk;

alter table citations
  validate constraint citations_run_user_fk,
  validate constraint citations_run_brand_user_fk,
  validate constraint citations_provider_run_key_fk;

alter table credit_ledger
  validate constraint credit_ledger_brand_user_fk,
  validate constraint credit_ledger_run_user_fk,
  validate constraint credit_ledger_run_brand_user_fk,
  validate constraint credit_ledger_execution_user_fk;

alter table reprocessing_job_items
  validate constraint reprocessing_job_items_job_tenant_fk,
  validate constraint reprocessing_job_items_brand_query_fk,
  validate constraint reprocessing_job_items_query_run_fk;
