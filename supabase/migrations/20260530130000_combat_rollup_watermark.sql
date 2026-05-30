-- Per-ability combat rollups, collected GOING FORWARD only, with a version
-- watermark so we never re-chew the old aggregate-only datasets we already have.
--
-- Context (2026-05-30): the agent already uploads a granular events[] array per
-- encounter, but the bot drops it after computing per-player aggregates. So the
-- "/me grand total by spell/song/crush/stab/bite/…" and the "attacked yourself X
-- times" counter have no source data historically and cannot be backfilled.
--
-- Plan:
--   * The next agent version emits a compact per-character rollup alongside the
--     encounter (damage/hits bucketed by skill, plus a self-attack count where
--     attacker == defender). The bot stores it here and stamps the contribution
--     with the agent_version that produced it.
--   * "Only pull the new data": rollups exist ONLY for uploads at/after the
--     cutover version. We never reprocess older contributions (they have no
--     detail to extract). Ongoing collection is automatic; enriching history is
--     OPT-IN — a member re-runs the agent over their old logs if they want their
--     verb totals + fun counters unlocked for past raids. find_or_create_encounter
--     dedups, so a resubmit attaches a new detailed contribution to the same
--     encounter rather than duplicating it.

-- 1) Watermark on contributions ----------------------------------------------
alter table public.contributions
    add column if not exists agent_version text;
alter table public.contributions
    add column if not exists has_ability_detail boolean not null default false;

comment on column public.contributions.agent_version is
    'Agent version that produced this contribution (null for pre-watermark / manual /parse). Used to tell rollup-capable uploads from old aggregate-only ones.';
comment on column public.contributions.has_ability_detail is
    'True when this contribution carried per-ability rollup data (encounter_combat_rollup populated).';

-- 2) Compact per-character per-encounter rollup ------------------------------
--    Kept deliberately small (one row per char per encounter, skills bucketed
--    in jsonb) rather than a granular event stream, per the long-haul storage
--    note in CLAUDE.md.
create table if not exists public.encounter_combat_rollup (
    id              uuid primary key default gen_random_uuid(),
    guild_id        text,
    encounter_id    uuid not null references public.encounters(id) on delete cascade,
    character_name  text not null,
    agent_version   text,
    -- { "crush": {"hits":N,"dmg":M}, "slash": {...},
    --   "Spell: Lightning Bolt": {...}, "Song: Selo's": {...}, ... }
    by_skill        jsonb not null default '{}'::jsonb,
    total_hits      integer not null default 0,
    total_damage    bigint  not null default 0,
    -- swings/casts the character aimed at itself (attacker == defender):
    -- charm-break pets, mez-break friendly fire, fat-finger /assist, etc.
    self_attack_count integer not null default 0,
    created_at      timestamptz not null default now(),
    unique (encounter_id, character_name)
);

create index if not exists idx_eqcr_character on public.encounter_combat_rollup (lower(character_name));
create index if not exists idx_eqcr_encounter on public.encounter_combat_rollup (encounter_id);

comment on table public.encounter_combat_rollup is
    'Per-character per-encounter skill rollup (going-forward only). Source for /me verb totals and the self-attack fun counter. by_skill buckets damage/hits per skill or named spell/song.';

alter table public.encounter_combat_rollup enable row level security;
-- Guild members can read aggregates (anonymous server-wide totals + their own /me).
create policy "eqcr read for authenticated"
    on public.encounter_combat_rollup for select to authenticated using (true);
-- Writes only via service_role (the bot).

-- 3) Per-character coverage: how many of a character's encounters still lack
--    ability detail (= resubmittable). Drives the "resubmit to unlock" nudge.
create or replace view public.character_rollup_coverage
with (security_invoker = true)
as
with ep as (
    select lower(ep.character_name) as name_l,
           ep.character_name,
           count(*) as encounters_total
    from public.encounter_players ep
    group by lower(ep.character_name), ep.character_name
),
roll as (
    select lower(character_name) as name_l, count(*) as encounters_with_detail
    from public.encounter_combat_rollup
    group by lower(character_name)
)
select
    ep.character_name,
    ep.encounters_total,
    coalesce(roll.encounters_with_detail, 0) as encounters_with_detail,
    ep.encounters_total - coalesce(roll.encounters_with_detail, 0) as encounters_resubmittable
from ep
left join roll on roll.name_l = ep.name_l;

comment on view public.character_rollup_coverage is
    'Per character: total encounters vs encounters that have per-ability detail. encounters_resubmittable > 0 means resubmitting old logs would unlock more verb/fun stats.';

grant select on public.encounter_combat_rollup to authenticated, service_role;
grant select on public.character_rollup_coverage to authenticated, service_role;
