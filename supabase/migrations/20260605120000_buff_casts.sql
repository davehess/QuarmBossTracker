-- Observed buff landings on OTHER players, captured from a Mimic-running
-- raider's log via the spell's `cast_on_other` landing message
-- (e.g. "Bonkur's eye gleams with the power of Aegolism." → target=Bonkur,
-- spell=Aegolism). This fills in buff coverage for raiders who are NOT running
-- the agent themselves — we never get their Zeal buff window, but anyone near
-- them who IS running Mimic sees the landing message and reports it here.
--
-- We store the matched spell (when unambiguous) plus the EQEmu duration fields
-- (buffduration ticks + formula) so the web can estimate remaining time =
-- min(level*formula, cap) − elapsed. This is the NO-FOCUS floor; if the buffed
-- player runs Mimic, their own Zeal ticks (character_live_state) are authoritative
-- and take precedence. caster is intentionally nullable — the landing message
-- names the target, not the caster (caster-focus accuracy is a later phase).
--
-- Dedup: the same landing is seen by every nearby agent. Collapse on
-- (guild, target, spell_id, cast_at) so N observers of one cast = one row. When
-- the spell is ambiguous (a landing message shared by multiple spells) spell_id
-- is 0 and we fall back to (guild, target, landing_text, cast_at) — see the two
-- partial unique indexes below.
create table if not exists public.buff_casts (
  id                     bigint generated always as identity primary key,
  guild_id               text not null default 'wolfpack',
  target                 text not null,          -- who the buff landed on
  spell_id               int  not null default 0, -- 0 = unresolved/ambiguous
  spell_name             text,                   -- null when ambiguous
  landing_text           text,                   -- raw cast_on_other suffix matched
  dur_ticks              int,                    -- eqemu_spells.buffduration (cap)
  dur_formula            int,                    -- eqemu_spells.buffdurationformula
  cast_at                timestamptz not null,
  observer               text,                   -- character whose log saw it
  uploaded_by_discord_id text,
  created_at             timestamptz not null default now()
);

-- Resolved casts dedup on the spell id; ambiguous ones (spell_id = 0) dedup on
-- the raw landing text so different unresolved messages don't collide.
create unique index if not exists buff_casts_resolved_uniq
  on public.buff_casts (guild_id, target, spell_id, cast_at)
  where spell_id <> 0;
create unique index if not exists buff_casts_ambiguous_uniq
  on public.buff_casts (guild_id, target, landing_text, cast_at)
  where spell_id = 0;

-- Read path: "latest buff landings for the raid in the last N minutes".
create index if not exists buff_casts_recent_idx
  on public.buff_casts (guild_id, cast_at desc);
create index if not exists buff_casts_target_idx
  on public.buff_casts (guild_id, target, cast_at desc);

alter table public.buff_casts enable row level security;
revoke all on public.buff_casts from anon;
grant select on public.buff_casts to authenticated;
grant all on public.buff_casts to service_role;
