-- Drop tables that were defined in the initial schema but never wired up.
-- brand_daily_metrics: pre-aggregated analytics rollup; nothing populates it
-- and the brand_provider_daily_rollup view computes the same data on demand.
-- outbox_events: transactional outbox; no producers or consumers exist.
-- Re-add when there is a real consumer rather than carrying empty scaffolding.

drop table if exists brand_daily_metrics;
drop table if exists outbox_events;
