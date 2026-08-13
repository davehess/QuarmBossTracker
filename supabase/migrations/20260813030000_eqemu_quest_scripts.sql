-- Mob scripts, mirrored per zone (2026-08-13, Hitya: "can our DB copy also
-- include the zone lists and in those zone lists the scripts for the mobs").
--
-- The zone list itself was already here (eqemu_zone, 192 rows). The SCRIPTS
-- were not, and could never arrive through the existing sync: they are not in
-- any SQL dump. They are .lua FILES in a separate repo —
-- github.com/SecretsOTheP/quests, GPL-3.0, ~3.7 MB, one directory per zone
-- short name, one file per NPC, plus an encounters/ subdirectory for raid
-- bosses.
--
-- WHY THIS IS WORTH A TABLE. crash_reason-style: the thing we keep guessing at
-- is written down upstream. ssratemple/encounters/Emperor.lua carries the
-- literal emote strings ("A hissing echos in your ears...") and the real timer
-- durations (spawnemp 120s, blood 240s, curse2 312s, curse 1113s) for a fight
-- whose triggers we hand-guessed. Our single worst documented trigger failure
-- is the INVENTED pattern — text that appears nowhere in the game — and this is
-- the corpus that makes that mechanically checkable.
--
-- Provenance check before trusting it: Emperor.lua references spells 808 and
-- 2069; eqemu_spells has 808 = 'Avatar Power' and 2069 = 'Curse of Sshraezha'.
-- Same upstream as the DB dump we already mirror.
-- ⚠ Still UPSTREAM scripts, not a live-server dump — Quarm may run local edits.
-- Treat as the best available reference, never as proof of live behaviour.
--
-- Licence: GPL-3.0, which expressly permits redistribution. This is NOT the
-- docs/pq-companion situation (that repo is unlicensed → study and reimplement,
-- never copy). Do not conflate the two.
create table if not exists public.eqemu_quest_scripts (
  path         text primary key,                  -- 'ssratemple/encounters/Emperor.lua'
  zone_short   text not null,                     -- joins eqemu_zone.short_name
  npc_name     text,                              -- 'Emperor' — filename, underscores → spaces
  is_encounter boolean not null default false,    -- lives under encounters/
  body         text not null,
  bytes        integer not null default 0,
  sha          text,                              -- git blob sha; skips unchanged files
  synced_at    timestamptz not null default now()
);

create index if not exists eqemu_quest_scripts_zone_idx
  on public.eqemu_quest_scripts (zone_short);
create index if not exists eqemu_quest_scripts_npc_idx
  on public.eqemu_quest_scripts (lower(npc_name));
-- The audit query is `body ilike '%some emote%'` across ~1500 files, so it wants
-- trigram rather than tsvector — the search strings are fragments of prose, not
-- words, and often contain punctuation.
create extension if not exists pg_trgm;
create index if not exists eqemu_quest_scripts_body_trgm
  on public.eqemu_quest_scripts using gin (body gin_trgm_ops);

alter table public.eqemu_quest_scripts enable row level security;
do $$ begin
  -- Tier 1 catalog: readable by anon + authenticated, same as every other
  -- eqemu_* mirror. The bot writes with service_role and bypasses RLS.
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='eqemu_quest_scripts'
                   and policyname='eqemu_quest_scripts_read') then
    create policy eqemu_quest_scripts_read on public.eqemu_quest_scripts
      for select to anon, authenticated using (true);
  end if;
end $$;

-- Zone attributes we never mirrored. Found by diffing our eqemu_zone against
-- what pq-companion surfaces from the same upstream table (2026-08-13): they
-- show these on a zone page and we could not, because the sync never picked the
-- columns. Cheap to carry, and `expansion` alone has been doing too much work.
alter table public.eqemu_zone add column if not exists cast_outdoor        smallint;
alter table public.eqemu_zone add column if not exists hotzone             smallint;
alter table public.eqemu_zone add column if not exists can_levitate        smallint;
alter table public.eqemu_zone add column if not exists can_bind            smallint;
alter table public.eqemu_zone add column if not exists zone_exp_multiplier numeric;
