-- Adoption metrics views (/admin/adoption — the PM funnel Hitya asked for,
-- 2026-08-18). Two tiny pre-aggregations so the page reads hundreds of rows,
-- not the whole contributions table, and the db-read ratchet stays honest.
-- security_invoker so the base tables' RLS applies to whoever queries.

create or replace view adoption_uploader_days as
  select uploaded_by_discord_id as discord_id,
         date_trunc('day', created_at) as day,
         count(*) as uploads
  from contributions
  where uploaded_by_discord_id is not null
  group by 1, 2;
alter view adoption_uploader_days set (security_invoker = on);

create or replace view encounter_upload_counts as
  select e.id as encounter_id, e.started_at, e.classification,
         count(distinct c.uploaded_by_discord_id) as uploaders
  from encounters e
  left join contributions c
    on c.encounter_id = e.id and c.uploaded_by_discord_id is not null
  group by 1, 2, 3;
alter view encounter_upload_counts set (security_invoker = on);
