-- prune_threat_snapshots(p_cutoff, p_batch) — the retention sweep that can actually finish.
--
-- WHY: `encounter_threat_snapshots` is ~2.5 GB (1.86M rows, 61% of the database)
-- and its nightly `DELETE ... WHERE snapshot_at < cutoff` has never removed a row.
-- No index leads on snapshot_at for that predicate (the only ones are partial:
-- `idx_threat_snapshots_unbound` WHERE encounter_id IS NULL, and the plain
-- `idx_threat_snapshots_snapshot_at` of migration 20260923010000 was never built —
-- CONCURRENTLY cannot run inside the migration runner's transaction), so the
-- DELETE seq-scanned 2 GB, blew the bot client's 10s abort, and the catch only
-- warned.
--
-- THE FIX NEEDS NO NEW INDEX. Two index-friendly paths already cover every row:
--   1. UNBOUND rows (encounter_id IS NULL, ~57% of the table): the existing partial
--      index `idx_threat_snapshots_unbound (snapshot_at) WHERE encounter_id IS NULL`
--      serves `WHERE encounter_id IS NULL AND snapshot_at < cutoff ORDER BY
--      snapshot_at` as an ordered index scan (EXPLAIN, 2026-10-15: Index Scan using
--      idx_threat_snapshots_unbound, Index Cond snapshot_at < cutoff).
--   2. BOUND rows (~43%): drive off `encounters` (34k rows, ~11k older than the
--      cutoff) in started_at order (`encounters_started_idx`) and probe
--      `idx_threat_snapshots_encounter` once per old encounter — a nested loop,
--      oldest first, no heap scan of the snapshots table.
-- Both are chosen by the planner today; the function only phrases the query so
-- they are the cheapest option.
--
-- BOUNDED, RESUMABLE: it deletes AT MOST p_batch rows per call (clamped 1..10000)
-- and returns how many it removed, so a caller loops with a pause until 0. Each
-- call is a short transaction on a small instance: no multi-minute lock, no huge
-- WAL burst, and a crash loses one batch, not a night. Unbound rows go first; the
-- bound pass runs only when the unbound pass finds nothing.
--
-- GUARD: refuses a cutoff newer than 7 days. The bot already computes the cutoff
-- from the archive + fight-graph watermarks (index.js `_threatDeleteCutoff`) and
-- retention; this is the database's own floor so a bad argument cannot wipe the
-- window the live readers use. It RAISES rather than returning 0 — a silent no-op
-- looks exactly like "nothing to sweep".
--
-- SECURITY INVOKER (not DEFINER like thin_threat_snapshots): it needs nothing
-- beyond what service_role already has on the table, so it gets no extra power.
--
-- Does NOT shrink the table on disk: DELETE leaves dead space inside the file for
-- new inserts to reuse. Giving the disk back needs VACUUM FULL or pg_repack on
-- this table, off-hours (see docs/COSTS.md). Idempotent migration; no data change.
create or replace function public.prune_threat_snapshots(
  p_cutoff timestamptz,
  p_batch  integer default 2000
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch, 2000), 1), 10000);
  v_n     integer;
begin
  if p_cutoff is null then
    raise exception 'prune_threat_snapshots: p_cutoff is required';
  end if;
  if p_cutoff > now() - interval '7 days' then
    raise exception 'prune_threat_snapshots: refusing cutoff % (newer than 7 days)', p_cutoff;
  end if;

  -- 1. Unbound rows, oldest first, off the partial snapshot_at index.
  with victims as (
    select id
      from public.encounter_threat_snapshots
     where encounter_id is null
       and snapshot_at < p_cutoff
     order by snapshot_at
     limit v_batch
  ), d as (
    delete from public.encounter_threat_snapshots s
     using victims v
     where s.id = v.id
    returning 1
  )
  select count(*) into v_n from d;
  if v_n > 0 then
    return v_n;
  end if;

  -- 2. Bound rows: walk the old encounters oldest-first, probing the
  --    encounter_id index per encounter. snapshot_at is re-checked so a snapshot
  --    newer than the cutoff on an old encounter is never touched.
  with victims as (
    select x.id
      from (select e.id
              from public.encounters e
             where e.started_at < p_cutoff
             order by e.started_at) e
     cross join lateral (
            select s.id
              from public.encounter_threat_snapshots s
             where s.encounter_id = e.id
               and s.snapshot_at < p_cutoff
             limit v_batch) x
     limit v_batch
  ), d as (
    delete from public.encounter_threat_snapshots s
     using victims v
     where s.id = v.id
    returning 1
  )
  select count(*) into v_n from d;
  return v_n;
end;
$$;

revoke all on function public.prune_threat_snapshots(timestamptz, integer) from public;
revoke all on function public.prune_threat_snapshots(timestamptz, integer) from anon;
revoke all on function public.prune_threat_snapshots(timestamptz, integer) from authenticated;
grant execute on function public.prune_threat_snapshots(timestamptz, integer) to service_role;
