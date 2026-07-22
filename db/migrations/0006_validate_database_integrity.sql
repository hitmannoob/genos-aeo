-- Complete the integrity rollout started by migrations 0003-0005. Those
-- migrations used NOT VALID so the constraints could be installed without a
-- long validation scan in the same deployment. This migration intentionally
-- fails if historical data violates an invariant; repair that data before
-- retrying rather than leaving cross-tenant or malformed rows untrusted.

alter table app_users
  validate constraint app_users_text_integrity;

alter table brands
  validate constraint brands_text_integrity;

alter table brand_queries
  validate constraint brand_queries_text_integrity;

alter table query_execution_requests
  validate constraint query_execution_request_id_integrity;

alter table query_runs
  validate constraint query_runs_brand_user_fk,
  validate constraint query_runs_value_integrity;

alter table provider_results
  validate constraint provider_results_cost_integrity,
  validate constraint provider_results_value_integrity;

alter table citations
  validate constraint citations_brand_user_fk,
  validate constraint citations_provider_run_fk,
  validate constraint citations_value_integrity;

alter table reprocessing_jobs
  validate constraint reprocessing_jobs_brand_user_fk,
  validate constraint reprocessing_jobs_count_integrity;

alter table reprocessing_job_items
  validate constraint reprocessing_job_items_text_integrity;
