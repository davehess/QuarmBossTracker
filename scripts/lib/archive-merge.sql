-- Merge a restored production snapshot into the local archive.
--
-- Runs inside the LOCAL Supabase database. `snap` is a foreign schema pointing
-- at a scratch database holding tonight's dump; `public` is the local archive
-- that must never lose a row.
--
-- Two behaviours, chosen per table by an explicit allowlist:
--
--   ARCHIVE  insert new rows, update changed ones, NEVER delete. Production
--            prunes these on a retention timer (buff_casts at 7 days,
--            raid_roster at 1 hour, threat snapshots at 30, who at 60,
--            target_observations at 1 day) — a row missing from the snapshot
--            means "aged out upstream", not "no longer true", so the local copy
--            keeps it forever.
--
--   MIRROR   everything else. Insert, update, AND delete rows absent from the
--            snapshot — because for these a production delete is a CORRECTION.
--            character_inventory / character_gear / character_spellbook /
--            character_aas are deleted and re-inserted on every upload, so
--            archiving them would show a character carrying items they no
--            longer own. ui_socials_index, common_macros and mimic_link_codes
--            are the same shape.
--
-- The allowlist is deliberately explicit and deliberately the SMALLER list: a
-- table nobody has classified gets MIRROR, which can only ever make the local
-- copy match production. Getting it wrong the other way silently accumulates
-- stale rows that look real.
--
-- ⚠ TABLE ORDER IS LOAD-BEARING, AND ALPHABETICAL ORDER IS WRONG. This file
-- merged `order by c.relname` from 2026-08-12 until 2026-09-23, which put
-- `charm_sessions` ahead of `encounters`, the table it references. The moment a
-- charm session pointed at an encounter newer than the archive's copy, the
-- insert failed its foreign key — and because the whole merge is ONE statement,
-- one FK violation rolls back every table and writes no merge_log row at all.
-- It failed that way silently for 17 consecutive nights (the archive froze at
-- 2026-09-06 while the cron kept reporting OK, because the wrapper only prints
-- `merge exit=` and the later steps still succeeded).
--
-- So the passes run in opposite directions, and both directions are required:
--
--   INSERT  parents first  — a child row cannot reference a parent the archive
--                            has not received yet.
--   DELETE  children first — a mirror parent whose row is gone upstream still
--                            has local children until their own turn, so
--                            dropping the parent first is the same violation
--                            with the arrow reversed.
--
-- Alphabetical order got the delete direction right by luck about half the time
-- (`bosses_local` happens to sort before `eqemu_npc_types`) and the insert
-- direction wrong. Ordering by the real FK graph is what survives the next
-- foreign key somebody adds.
--
-- Idempotent: re-running merges the same snapshot to the same result.

create schema if not exists archive_meta;
create table if not exists archive_meta.merge_log (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  table_name  text not null,
  mode        text not null,
  rows_before bigint,
  rows_after  bigint,
  rows_kept   bigint          -- archive only: rows we hold that the snapshot lost
);

-- The two passes must agree on what a table's primary key is, so they ask the
-- same function rather than each carrying a copy of the catalog query.
create or replace function archive_meta.pk_columns(p_table text)
returns text[] language sql stable as $fn$
  select array_agg(a.attname order by k.ord)
    from pg_constraint con
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
   where con.conrelid = ('public.' || quote_ident(p_table))::regclass
     and con.contype = 'p';
$fn$;

-- Snapshot row `s` is the same row as archive row `d`.
-- ⚠ `=`, NEVER `IS NOT DISTINCT FROM`. This file used the latter until
-- 2026-09-23 and it is a performance cliff, not a style choice: DISTINCT FROM
-- has no hashable operator, so every join and anti-join here — the mirror
-- delete, the update, the rows_kept count, all across a postgres_fdw foreign
-- table — degrades to a Nested Loop. Measured on 200k rows over a loopback
-- fdw: `=` 224 ms (Hash Anti Join); DISTINCT FROM still running at the 60 s
-- cap, and it grows quadratically. The archive's big tables are ~1.2M rows.
-- Tower fixed this by hand on 2026-09-06, which is likely why that night's
-- merge could finish at all. Nothing is lost by it: these are primary-key
-- columns, and a primary key cannot be NULL.
create or replace function archive_meta.pk_match(p_cols text[])
returns text language sql immutable as $fn$
  select string_agg(format('s.%1$I = d.%1$I', c), ' and ')
    from unnest(p_cols) c;
$fn$;

do $merge$
declare
  archive_tables text[] := array[
    -- pruned by the bot's midnight retention sweeps
    'buff_casts', 'encounter_threat_snapshots', 'target_observations',
    'who_observations', 'raid_roster',
    -- append-only event history: never deleted upstream, only ever grows
    'encounters', 'encounter_players', 'encounter_events',
    'encounter_combat_rollup', 'encounter_threat_rank', 'contributions',
    'chat_messages', 'tells', 'fun_events', 'looted_items', 'loot_observations',
    'roll_sets', 'roll_set_overrides', 'pvp_kills', 'pvp_assists',
    'pvp_boss_kills', 'trigger_timing_feedback', 'zeal_tag_observations',
    'page_views', 'audit_log'
  ];
  merge_order   text[];            -- parents first, children after
  before_counts bigint[] := '{}';  -- row counts taken BEFORE any delete, by ordinal
  tbl           text;
  i             int;
  pk_cols       text[];
  shared_cols   text[];
  col_list      text;
  update_set    text;
  is_archive    boolean;
  before_n      bigint;
  after_n       bigint;
  kept_n        bigint;
begin
  -- Rank every table that exists on BOTH sides so its FK parents come first.
  -- `depth` is the LONGEST path from any root, which is a valid topological
  -- rank on a DAG; the `depth < 32` guard is what makes an FK cycle terminate
  -- rather than loop forever. Inside a cycle the order is arbitrary — no single
  -- pass can satisfy a cycle, and we have none today.
  with recursive shared as (
    select c.relname::text as tbl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_class c2
                     join pg_namespace n2 on n2.oid = c2.relnamespace
                    where n2.nspname = 'snap' and c2.relname = c.relname)
  ),
  fk_edges as (
    select cl.relname::text as child, pl.relname::text as parent
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class pl on pl.oid = con.confrelid
      join pg_namespace cn on cn.oid = cl.relnamespace
      join pg_namespace pn on pn.oid = pl.relnamespace
     where con.contype = 'f'
       and cn.nspname = 'public' and pn.nspname = 'public'
       and cl.relname <> pl.relname   -- self-reference: no table order can help
  ),
  -- Walked through EVERY public table, not just the shared ones, so a chain
  -- that passes through a table absent from the snapshot still ranks correctly.
  walk (tbl, depth) as (
    select c.relname::text, 0
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
    union
    select e.child, w.depth + 1
      from walk w
      join fk_edges e on e.parent = w.tbl
     where w.depth < 32
  )
  select array_agg(r.tbl order by r.depth, r.tbl)
    into merge_order
    from (select w.tbl, max(w.depth) as depth from walk w group by w.tbl) r
   where r.tbl in (select s.tbl from shared s);

  if merge_order is null then
    raise notice 'nothing to merge — no table exists in both public and snap';
    return;
  end if;

  -- PASS 1 — mirror deletes, CHILDREN FIRST (see the header). Row counts are
  -- taken here, before anything is removed, so merge_log's rows_before still
  -- means "what the archive held when this run started".
  for i in reverse array_length(merge_order, 1) .. 1 loop
    tbl := merge_order[i];
    pk_cols := archive_meta.pk_columns(tbl);
    if pk_cols is null then continue; end if;   -- reported once, in pass 2

    execute format('select count(*) from public.%I', tbl) into before_n;
    before_counts[i] := before_n;

    -- Archive tables skip this entirely — that omission IS the feature.
    if not (tbl = any (archive_tables)) then
      execute format(
        'delete from public.%1$I d where not exists (select 1 from snap.%1$I s where %2$s)',
        tbl, archive_meta.pk_match(pk_cols));
    end if;
  end loop;

  -- PASS 2 — insert + update, PARENTS FIRST.
  for i in 1 .. array_length(merge_order, 1) loop
    tbl := merge_order[i];

    -- Primary key: the conflict target. No PK means we cannot merge safely, so
    -- the table is skipped loudly rather than duplicated on every run.
    pk_cols := archive_meta.pk_columns(tbl);
    if pk_cols is null then
      raise notice 'SKIP % — no primary key, cannot merge without duplicating', tbl;
      continue;
    end if;

    -- Only columns present on BOTH sides, so a schema that has moved on locally
    -- or upstream degrades to a partial merge instead of erroring out.
    -- Generated columns are excluded: they cannot be inserted into or updated,
    -- and Postgres rejects the statement outright if you name one.
    select array_agg(quote_ident(column_name) order by ordinal_position)
      into shared_cols
    from information_schema.columns lc
    where lc.table_schema = 'public' and lc.table_name = tbl
      and lc.is_generated = 'NEVER'
      and exists (select 1 from information_schema.columns sc
                  where sc.table_schema = 'snap' and sc.table_name = tbl
                    and sc.column_name = lc.column_name);

    col_list := array_to_string(shared_cols, ', ');
    select string_agg(format('%1$s = s.%1$s', c), ', ')
      into update_set
    from unnest(shared_cols) c
    where c <> all (select quote_ident(x) from unnest(pk_cols) x);

    is_archive := tbl = any (archive_tables);
    before_n   := before_counts[i];

    -- ⚠ TWO STATEMENTS, NOT ONE `INSERT … ON CONFLICT (pk) DO UPDATE`.
    -- Postgres allows exactly one conflict target, and 17 of the 25 archive
    -- tables carry a SECOND unique index beside the primary key
    -- (`who_obs_dedup`, `chat_messages_dedup`, `tells_dedup`,
    -- `encounter_threat_snapshots_unique`, …). An archive that keeps a row
    -- production later pruned and re-created under a fresh surrogate id then
    -- holds the old id while the snapshot offers the new one: no primary-key
    -- conflict, so `ON CONFLICT (id)` never fires, and the dedup index raises
    -- instead — taking the whole merge down with it. That is the
    -- `who_obs_dedup` failure of 2026-09-23, latent since 2026-08-12 and
    -- invisible only because the FK bug aborted the run first.
    --
    -- So: update matched rows by primary key, then insert the rest with a
    -- BARE `on conflict do nothing`, which covers EVERY unique constraint
    -- rather than one nominated index. A skipped row is one the archive
    -- already holds under a different id — the same observation, not a loss.
    -- Mirror tables cannot reach that case at all: pass 1 has already removed
    -- anything the snapshot lacks, and two rows sharing a dedup key could
    -- never have coexisted upstream.
    if update_set is not null then
      execute format('update public.%1$I d set %2$s from snap.%1$I s where %3$s',
                     tbl, update_set, archive_meta.pk_match(pk_cols));
    end if;

    -- `overriding system value` is required for a GENERATED ALWAYS AS IDENTITY
    -- column and is a no-op on every other table (measured, not assumed).
    execute format('insert into public.%1$I (%2$s) overriding system value
                    select %2$s from snap.%1$I on conflict do nothing',
                   tbl, col_list);

    execute format('select count(*) from public.%I', tbl) into after_n;
    if is_archive then
      execute format('select count(*) from public.%1$I d where not exists
                      (select 1 from snap.%1$I s where %2$s)',
                     tbl, archive_meta.pk_match(pk_cols)) into kept_n;
    else
      kept_n := 0;
    end if;

    insert into archive_meta.merge_log (table_name, mode, rows_before, rows_after, rows_kept)
    values (tbl, case when is_archive then 'archive' else 'mirror' end,
            before_n, after_n, kept_n);
  end loop;
end
$merge$;
