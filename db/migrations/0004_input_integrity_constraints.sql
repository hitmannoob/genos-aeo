-- Enforce the same bounded-input contract at the database boundary. `not
-- valid` avoids breaking upgrades because of historical rows while still
-- applying each constraint to every new or updated row.

alter table brands
  add constraint brands_text_integrity check (
    length(btrim(domain)) between 1 and 253
    and length(btrim(company_name)) between 1 and 200
    and cardinality(products_and_services) <= 20
    and cardinality(keywords) <= 20
  ) not valid;

alter table brand_queries
  add constraint brand_queries_text_integrity check (
    length(btrim(query)) between 4 and 500
    and length(btrim(keyword)) between 1 and 160
  ) not valid;

alter table query_execution_requests
  add constraint query_execution_request_id_integrity check (
    length(btrim(client_request_id)) between 1 and 160
  ) not valid;

alter table reprocessing_job_items
  add constraint reprocessing_job_items_text_integrity check (
    length(btrim(query)) between 4 and 500
    and length(btrim(keyword)) between 1 and 160
  ) not valid;
