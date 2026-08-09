-- Officers can mark a (character, boss) pair as INTENTIONAL so those deaths
-- stop reading as a raid failure in the raid-night review's "What to work on"
-- section (utils/raidReview.js summarizeNight -> renderReviewEmbeds), while the
-- death itself still shows everywhere it always has: the headline count, the
-- per-fight timelines, and the web Deaths list. A death that happened is never
-- hidden — it is only excluded from the "things to fix" tally.
--
-- Real case (Hitya, guild lead, 2026-08-06): Fawx and Dant both "make a
-- corpse on purpose" with Kaas Thox Xi Ans Dyek every single week (a known
-- rogue corpse-drag strat). Because it happens EVERY TIME for the same
-- (character, boss) pair, a per-death toggle would have officers re-marking the
-- same two rogues on the same boss forever — the wrong shape. This is a
-- STANDING rule: set once, applies to every future death of that character on
-- that boss.
--
-- Design: docs/DESIGN-intentional-deaths.md. That doc also drafts a phase-2
-- intentional_death_overrides table (a per-death exception that can force a
-- death to count DESPITE a rule). It is deliberately NOT created here — the doc
-- is explicit that shipping schema ahead of the code that reads it just leaves
-- unused tables in production, and no override has been asked for yet. It is a
-- three-line migration the day one is.
--
-- Matching is on (guild_id, lower(character_name), npc_id):
--   * lower() because death rows carry whatever case the log line had, and an
--     officer typing the name will not always match it — the same convention as
--     every other name-keyed table here.
--   * npc_id, never the display string. cleanBossName() strips '#'/'_' purely
--     for rendering and two differently-templated NPCs can render the same
--     clean name, so the display name is not an identity. This is CLAUDE.md's
--     documented boss-identity source.

create table if not exists public.intentional_death_rules (
  id                     uuid primary key default gen_random_uuid(),
  guild_id               text not null default 'wolfpack',
  character_name         text not null,
  npc_id                 integer not null references public.eqemu_npc_types(id),
  note                   text,
  active                 boolean not null default true,
  created_by_discord_id  text,
  created_by_name        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- One rule per (character, boss) — re-adding an existing pair edits it in place
-- instead of piling up duplicates, and lets a deactivated rule be revived
-- rather than shadowed by a second row.
create unique index if not exists intentional_death_rules_char_boss_uniq
  on public.intentional_death_rules (guild_id, lower(character_name), npc_id);

-- The hot-path lookup: the review loads every active rule for the guild once
-- per render, so the partial index is the whole working set.
create index if not exists intentional_death_rules_active_idx
  on public.intentional_death_rules (guild_id, active) where active;

alter table public.intentional_death_rules enable row level security;
revoke all on public.intentional_death_rules from anon, authenticated;
grant all  on public.intentional_death_rules to service_role;
