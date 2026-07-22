-- Preserve one resumable active job per brand. Older duplicate active rows are
-- retained for audit purposes but made terminal before adding the invariant.
with ranked_active_jobs as (
  select
    id,
    row_number() over (
      partition by brand_id
      order by created_at desc, id desc
    ) as active_rank
  from reprocessing_jobs
  where status in ('queued', 'processing')
)
update reprocessing_jobs
set status = 'failed',
    failed_at = coalesce(failed_at, now()),
    runner_lease_expires_at = null
where id in (
  select id
  from ranked_active_jobs
  where active_rank > 1
);

create unique index reprocessing_jobs_one_active_per_brand
on reprocessing_jobs (brand_id)
where status in ('queued', 'processing');

alter table reprocessing_jobs
  add constraint reprocessing_jobs_count_integrity check (
    successful_count + failed_count <= attempted_count
    and attempted_count <= total_queries
    and current_index <= total_queries
    and credits_used <= credits_required
  ) not valid;
