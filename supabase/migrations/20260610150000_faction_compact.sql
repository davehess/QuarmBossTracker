-- Faction tracking v2 — COMPACT. Replaces the v1 append-only tables from
-- 20260610120000 (dropped below; they were hours old and effectively empty).
--
-- Design change per owner: don't keep per-event history. A mob that's
-- engaged in combat cons "scowls / threateningly" regardless of base
-- faction, so hostile cons are noise — the SIGNAL is a con that comes back
-- anything better than those two (faction visibly non-KOS; also the only
-- log-visible proof a Feign Death stuck). And per-hit rows were ~1 GB/yr of
-- growth for data whose useful shape is "counts + caps + last seen".
--
--   faction_standing — ONE row per (guild, character, faction), updated in
--     place via bump_faction_standing(): additive better/worse counters,
--     at-cap timestamps (pin the absolute min/max position), first/last hit.
--     Size ceiling ≈ characters × factions touched (~tens of k rows, ever).
--
--   faction_cons — ONE row per (guild, character, mob): the LATEST
--     non-hostile standing (rank ≥ 2, i.e. dubiously or better). The agent
--     never uploads scowls/threateningly; the bot filters them too.
--
-- Trade-offs accepted: no per-hit timeline; counters aren't replay-idempotent
-- (the agent's resume-from-byte-position prevents double-crawls in the normal
-- path, but a forced from-scratch re-crawl double-counts — counts are
-- directional color, caps + cons stay exact either way).

drop table if exists public.faction_hits;
drop table if exists public.faction_cons;

create table if not exists public.faction_standing (
  id             bigint generated always as identity primary key,
  guild_id       text        not null,
  character      text        not null,
  faction        text        not null,
  better_count   integer     not null default 0,
  worse_count    integer     not null default 0,
  capped_max_at  timestamptz,              -- "could not possibly get any better"
  capped_min_at  timestamptz,              -- "could not possibly get any worse"
  first_hit_at   timestamptz not null,
  last_hit_at    timestamptz not null,
  last_direction smallint,                 -- +1 / -1, from the newest hit
  updated_at     timestamptz not null default now(),
  unique (guild_id, character, faction)
);

create table if not exists public.faction_cons (
  id          bigint generated always as identity primary key,
  guild_id    text        not null,
  character   text        not null,
  mob         text        not null,
  standing    text        not null,        -- dubiously … ally (never scowls/threateningly)
  rank        smallint,                    -- 2 (dubiously) … 8 (ally)
  event_ts    timestamptz not null,        -- when this standing was last observed
  updated_at  timestamptz not null default now(),
  unique (guild_id, character, mob)
);

-- Additive rollup upsert. The bot aggregates each upload batch into one
-- entry per (character, faction) and calls this once; counters ADD instead
-- of overwrite (plain PostgREST upsert can't do that).
create or replace function public.bump_faction_standing(p_rows jsonb)
returns integer
language plpgsql
as $$
declare
  r jsonb;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.faction_standing as fs
      (guild_id, character, faction, better_count, worse_count,
       capped_max_at, capped_min_at, first_hit_at, last_hit_at, last_direction)
    values (
      r->>'guild_id',
      r->>'character',
      r->>'faction',
      coalesce((r->>'better')::int, 0),
      coalesce((r->>'worse')::int, 0),
      (r->>'capped_max_at')::timestamptz,
      (r->>'capped_min_at')::timestamptz,
      (r->>'first_hit_at')::timestamptz,
      (r->>'last_hit_at')::timestamptz,
      (r->>'last_direction')::smallint
    )
    on conflict (guild_id, character, faction) do update set
      better_count   = fs.better_count + excluded.better_count,
      worse_count    = fs.worse_count  + excluded.worse_count,
      -- GREATEST/LEAST skip NULLs in Postgres, so a never-capped row stays NULL
      capped_max_at  = greatest(fs.capped_max_at, excluded.capped_max_at),
      capped_min_at  = greatest(fs.capped_min_at, excluded.capped_min_at),
      first_hit_at   = least(fs.first_hit_at, excluded.first_hit_at),
      last_hit_at    = greatest(fs.last_hit_at, excluded.last_hit_at),
      last_direction = case when excluded.last_hit_at >= fs.last_hit_at
                            then excluded.last_direction else fs.last_direction end,
      updated_at     = now();
    n := n + 1;
  end loop;
  return n;
end
$$;

alter table public.faction_standing enable row level security;
alter table public.faction_cons     enable row level security;

drop policy if exists faction_standing_read on public.faction_standing;
create policy faction_standing_read on public.faction_standing
  for select to authenticated using (true);
drop policy if exists faction_cons_read on public.faction_cons;
create policy faction_cons_read on public.faction_cons
  for select to authenticated using (true);
