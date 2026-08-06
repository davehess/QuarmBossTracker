# Intentional deaths — standing rules, not per-death toggles

**Status:** designed, not built. Migration drafted below but DELIBERATELY NOT
COMMITTED as a migration file — the GitHub integration auto-applies on merge to
`main`, and shipping schema before the code that reads it just creates unused
production tables. Move the SQL into `supabase/migrations/` as part of the
implementation commit, not before.

**Ask:** Uilnayar 2026-08-06 — *"Fawx and Dant both 'made corpses' on purpose
with Kaas Thox Xi Ans Dyek, so while they did have 2 deaths, they were
intentional. Perhaps officers can have a way to set this, we do it every time
for these rogues on that fight."*

## The shape of the problem

Because it happens EVERY TIME for the same (character, boss) pair, a per-death
toggle is the wrong shape — officers would re-mark the same two rogues on the
same boss forever. It wants a STANDING rule, with a per-death override as the
exception.

## What the investigation established

- **"What to work on" is Discord-only.** `utils/raidReview.js` `summarizeNight()`
  builds `deathsByBoss` → `worstFights`, rendered by `renderReviewEmbeds()`. The
  web review page has a neutral Deaths list and no such section. So the fix is
  narrower than it looks: **exclude intentional deaths from `worstFights`, and
  nothing else changes.**
- The field shows **boss + count, never names** — so this is not about hiding
  anyone, it is about not counting a deliberate act as a failure.
- **Boss identity must key on `encounters.npc_id`**, never the display string:
  `cleanBossName()` strips `#`/`_` for display and two differently-templated NPCs
  can render the same clean name.
- Precedents to copy rather than invent: `characters.exclude_from_stats` (the
  standing per-character flag, with `web/app/me/ExclusionToggles.tsx` +
  `actions.ts` as the concrete optimistic-toggle pattern), and
  `encounters.classification` (`web/app/parses/actions.ts`) as the existing
  per-instance override with a stamped reason/actor.

## Precedence

An override always wins over a standing rule, **in both directions** — it can
force a death to count despite a matching rule, not just excuse one. Absent an
override, an active standing rule decides. Absent both: counts, as today.

## Display — a death is never hidden

The death stays in the headline count, on the fight-timeline sparkline, and in
the web Deaths list. It only leaves the "things to fix" tally. Web gets a muted
`intentional` chip beside the existing riposte-kill tag, with the rule's note as
a tooltip. Discord optionally gains `(N intentional)` on the deaths line.

## Open question before building

Phase 1 as designed adds a whole new `/admin/deaths` page. For what is currently
two rogues on one boss, consider instead hanging the rule off the existing
officer strip on `/parses/[id]` — where `classifyEncounter` already lives — since
that page already knows the encounter, its `npc_id`, and who died. Fewer
surfaces, and the officer is already looking at the fight when they decide.
Decide this before writing the UI.

## Known tradeoff, accepted

`worstCluster` (the "N died together" wipe signal on the sparkline) still counts
intentional deaths, so a multi-corpse strat can still read as a cluster. Left
alone on purpose — the sparkline is a factual record of what happened.

## Drafted schema

    -- Officers can mark a death as INTENTIONAL so it stops reading as a raid
    -- failure in the raid-night review's "What to work on" section (bot,
    -- utils/raidReview.js summarizeNight -> renderReviewEmbeds) while the death
    -- itself still shows everywhere it always has (headline count, per-fight
    -- timelines, the web Deaths list) -- a death that happened is never hidden,
    -- only excluded from the "things to fix" tally.
    --
    -- Real case (Uilnayar, guild lead, 2026-08-06): Fawx and Dant both "make a
    -- corpse on purpose" with Kaas Thox Xi Ans Dyek every single week (a known
    -- rogue-CH-battery / corpse-drag strat). Because it happens EVERY TIME for
    -- the same (character, boss) pair, a per-death toggle would make officers
    -- re-mark the same two rogues on the same boss forever -- the wrong shape.
    --
    -- Two layers:
    --
    --   1. intentional_death_rules -- a STANDING rule keyed on (character, boss).
    --      Set once ("Fawx is always intentional on Kaas Thox Xi Ans Dyek"),
    --      applies to every future death of that character on that boss without
    --      officers re-marking it week after week. THIS IS PHASE 1 -- it is what
    --      Uilnayar's report actually needs, and the only layer with UI wiring
    --      in the first cut.
    --
    --   2. intentional_death_overrides -- a PER-DEATH exception for the rare
    --      case the standing rule doesn't cover: a one-off before any rule
    --      exists, or (the harder direction) the rare week a rule character
    --      dies for real and an officer wants THIS ONE death to still count. An
    --      override always wins over a standing rule, in either direction.
    --      Schema only in this migration -- PHASE 2, no UI until a real need
    --      shows up (docs/DESIGN-*-intentional-deaths.md tracks the follow-up).
    --
    -- Both are matched at (guild, lower(character_name)) -- never a raw string
    -- compare -- the same convention as every other name-keyed table here
    -- (character_link_requests, characters.exclude_from_stats lookups). Boss
    -- identity is encounters.npc_id -> eqemu_npc_types.id, per CLAUDE.md's
    -- documented boss-identity source -- never the display name string, which
    -- cleanBossName() only derives for rendering.
    
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
    
    -- One rule per (character, boss) -- re-adding an existing pair edits it in
    -- place instead of piling up duplicates. Case-insensitive: death rows carry
    -- whatever case the log line had, and officers will not always match it.
    create unique index if not exists intentional_death_rules_char_boss_uniq
      on public.intentional_death_rules (guild_id, lower(character_name), npc_id);
    
    -- The hot-path lookup (summarizeNight / the review page load every rule for
    -- the guild once per render) only ever wants the active set.
    create index if not exists intentional_death_rules_active_idx
      on public.intentional_death_rules (guild_id, active) where active;
    
    alter table public.intentional_death_rules enable row level security;
    revoke all on public.intentional_death_rules from anon, authenticated;
    grant all  on public.intentional_death_rules to service_role;
    
    -- PHASE 2 (schema only -- see header). death_ts is the death's DISPLAYED
    -- timestamp (dedupEncounterDeaths/dedupNightDeaths' row.ts, i.e. the
    -- earliest report across contributors) and is matched with a tolerance
    -- window at read time, never exact equality -- a late backfill can shift
    -- that ts by a few seconds within the existing DEATH_DEDUP_MS/
    -- NIGHT_DEATH_DEDUP_MS windows, and an exact-match override must not go
    -- silently stale when that happens.
    create table if not exists public.intentional_death_overrides (
      id                     uuid primary key default gen_random_uuid(),
      guild_id               text not null default 'wolfpack',
      character_name         text not null,
      death_ts               timestamptz not null,
      intentional            boolean not null,
      -- Denormalized context for the admin UI only -- NOT part of the match key
      -- (see above). encounter_id is nullable-on-delete because an encounter
      -- merge/repair (web/app/admin/encounters) must not cascade-delete an
      -- officer's override decision.
      npc_id                 integer references public.eqemu_npc_types(id),
      encounter_id           uuid references public.encounters(id) on delete set null,
      note                   text,
      created_by_discord_id  text,
      created_by_name        text,
      created_at             timestamptz not null default now()
    );
    
    create index if not exists intentional_death_overrides_lookup_idx
      on public.intentional_death_overrides (guild_id, lower(character_name), death_ts);
    
    alter table public.intentional_death_overrides enable row level security;
    revoke all on public.intentional_death_overrides from anon, authenticated;
    grant all  on public.intentional_death_overrides to service_role;
