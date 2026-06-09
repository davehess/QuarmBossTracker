-- buff_casts.is_charm_spell — flags synthesized charm-spell entries.
--
-- Allure / Beguile / Charm and friends have cast_on_other = NULL in
-- eqemu_spells, so the standard log-driven buff-landing path can never
-- produce a row for them. The agent's _recordCharmSpellOnTarget()
-- synthesizes a buff_casts entry on every charm land instead, and the
-- new /api/agent/target-buffs endpoint surfaces them to OTHER Mimic
-- users targeting the same charmed mob (so they see "Allure (Hopeya)"
-- on their Mob Info with a live countdown).
--
-- is_charm_spell lets receivers force good = 0 (debuff section)
-- regardless of catalog good_effect — charm IS a debuff from the
-- mob's perspective, even though good_effect on the spell row may
-- not reflect that.

alter table public.buff_casts
  add column if not exists is_charm_spell boolean not null default false;

-- Index for the /api/agent/target-buffs lookup (target + recency).
create index if not exists buff_casts_target_recent_idx
  on public.buff_casts (guild_id, target, cast_at desc);

comment on column public.buff_casts.is_charm_spell is
  'true = synthesized charm-spell entry (Allure / Beguile / Charm — cast_on_other is NULL so no log row exists). Receivers force good=0 (debuff section) regardless of catalog good_effect.';
