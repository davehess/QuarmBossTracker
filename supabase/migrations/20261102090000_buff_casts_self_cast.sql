-- buff_casts.self_cast: the landing was reported by its CASTER's own agent (2026-11-02).
--
-- Why. A debuff landing is seen by every agent near the mob, but only the caster's own log can say WHICH spell
-- it was (its "You begin casting ..." line resolves the shared emote: "yawns." is eleven spells). Bystanders
-- record the emote and crown a guess. buff_casts kept no trace of which kind a row was, so Target Info could not
-- tell "Turgur's Insects, cast by this raider" from "something that yawns" and showed SLOWED? beside the right
-- spell (the guild lead, 2026-11-01: "the debuffer should always be the one whose buff landing takes
-- precedence"). The agent has always sent the flag as `_selfCast`; the bot dropped it. Now it is stored, and
-- `observer` on a self_cast row IS the caster.
--
-- Dedup. The same landing from N observers collapses into the row that got there first, so the caster's row can
-- lose the race and its flag with it. insert_buff_casts therefore also PROMOTES an existing row: when a batch row
-- is a self_cast and the same (guild, target, spell, cast_at) is already stored without the flag, the stored row
-- takes self_cast = true, the caster as observer, and the caster's spawn id when the stored row had none.
-- Ambiguous rows (spell_id = 0) are never promoted: a self-cast always resolves a spell id.
--
-- Order on deploy: apply this BEFORE the bot that selects/inserts self_cast ships (the bot's insert fallback and
-- the target-buffs read name the column). Adding a nullable-default column is instant and backward compatible.

alter table public.buff_casts add column if not exists self_cast boolean not null default false;

create or replace function public.insert_buff_casts(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  with ins as (
    insert into public.buff_casts
      (guild_id, target, spell_id, spell_name, landing_text, dur_ticks, dur_formula, cast_at,
       observer, uploaded_by_discord_id, is_charm_spell, target_id, self_cast)
    select r.guild_id, r.target, coalesce(r.spell_id, 0), r.spell_name, r.landing_text, r.dur_ticks,
           r.dur_formula, r.cast_at, r.observer, r.uploaded_by_discord_id, coalesce(r.is_charm_spell, false),
           r.target_id, coalesce(r.self_cast, false)
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      guild_id text, target text, spell_id integer, spell_name text, landing_text text, dur_ticks integer,
      dur_formula integer, cast_at timestamptz, observer text, uploaded_by_discord_id text,
      is_charm_spell boolean, target_id integer, self_cast boolean)
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into n from ins;

  update public.buff_casts b
     set self_cast = true,
         observer  = r.observer,
         target_id = coalesce(nullif(b.target_id, 0), nullif(r.target_id, 0), b.target_id)
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      guild_id text, target text, spell_id integer, cast_at timestamptz, observer text, target_id integer,
      self_cast boolean)
   where coalesce(r.self_cast, false)
     and coalesce(r.spell_id, 0) <> 0
     and b.spell_id = r.spell_id
     and b.guild_id = r.guild_id
     and b.target = r.target
     and b.cast_at = r.cast_at
     and not b.self_cast;

  return coalesce(n, 0);
end;
$$;

revoke all on function public.insert_buff_casts(jsonb) from public, anon, authenticated;
grant execute on function public.insert_buff_casts(jsonb) to service_role;
