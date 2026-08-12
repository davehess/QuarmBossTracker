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
--            target_observations at 90) — a row missing from the snapshot means
--            "aged out upstream", not "no longer true", so the local copy keeps
--            it forever.
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
  t            record;
  pk_cols      text[];
  shared_cols  text[];
  col_list     text;
  update_set   text;
  is_archive   boolean;
  before_n     bigint;
  after_n      bigint;
  kept_n       bigint;
begin
  for t in
    select c.relname as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
                  where n2.nspname = 'snap' and c2.relname = c.relname)
    order by c.relname
  loop
    -- Primary key: the conflict target. No PK means we cannot merge safely, so
    -- the table is skipped loudly rather than duplicated on every run.
    select array_agg(a.attname order by k.ord)
      into pk_cols
    from pg_constraint con
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
    where con.conrelid = ('public.' || quote_ident(t.tbl))::regclass
      and con.contype = 'p';

    if pk_cols is null then
      raise notice 'SKIP % — no primary key, cannot merge without duplicating', t.tbl;
      continue;
    end if;

    -- Only columns present on BOTH sides, so a schema that has moved on locally
    -- or upstream degrades to a partial merge instead of erroring out.
    select array_agg(quote_ident(column_name) order by ordinal_position)
      into shared_cols
    from information_schema.columns lc
    where lc.table_schema = 'public' and lc.table_name = t.tbl
      and exists (select 1 from information_schema.columns sc
                  where sc.table_schema = 'snap' and sc.table_name = t.tbl
                    and sc.column_name = lc.column_name);

    col_list := array_to_string(shared_cols, ', ');
    select string_agg(format('%1$s = excluded.%1$s', c), ', ')
      into update_set
    from unnest(shared_cols) c
    where c <> all (select quote_ident(x) from unnest(pk_cols) x);

    is_archive := t.tbl = any (archive_tables);
    execute format('select count(*) from public.%I', t.tbl) into before_n;

    -- MIRROR only: drop rows the snapshot no longer has. Archive tables skip
    -- this entirely — that omission IS the feature.
    if not is_archive then
      execute format(
        'delete from public.%1$I d where not exists (select 1 from snap.%1$I s where %2$s)',
        t.tbl,
        (select string_agg(format('s.%1$I is not distinct from d.%1$I', c), ' and ')
           from unnest(pk_cols) c));
    end if;

    if update_set is null then         -- table is nothing but its primary key
      execute format('insert into public.%1$I (%2$s) select %2$s from snap.%1$I
                      on conflict (%3$s) do nothing',
                     t.tbl, col_list, array_to_string(pk_cols, ', '));
    else
      execute format('insert into public.%1$I (%2$s) select %2$s from snap.%1$I
                      on conflict (%3$s) do update set %4$s',
                     t.tbl, col_list, array_to_string(pk_cols, ', '), update_set);
    end if;

    execute format('select count(*) from public.%I', t.tbl) into after_n;
    if is_archive then
      execute format('select count(*) from public.%1$I d where not exists
                      (select 1 from snap.%1$I s where %2$s)', t.tbl,
        (select string_agg(format('s.%1$I is not distinct from d.%1$I', c), ' and ')
           from unnest(pk_cols) c)) into kept_n;
    else
      kept_n := 0;
    end if;

    insert into archive_meta.merge_log (table_name, mode, rows_before, rows_after, rows_kept)
    values (t.tbl, case when is_archive then 'archive' else 'mirror' end,
            before_n, after_n, kept_n);
  end loop;
end
$merge$;
