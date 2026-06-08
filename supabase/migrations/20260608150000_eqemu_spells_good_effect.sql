-- eqemu_spells.good_effect — EQEmu spells_new.goodEffect: 1 = beneficial (buff),
-- 0 = detrimental (debuff). Populated by scripts/sync-from-eqmac.js on the next
-- weekly sync. Lets the Mimic overlays color buffs green and debuffs red, and
-- lets the agent assume a debuff's duration from the caster level when we don't
-- otherwise know it.
alter table public.eqemu_spells
  add column if not exists good_effect int;

comment on column public.eqemu_spells.good_effect is
  'EQEmu spells_new.goodEffect — 1 = beneficial (buff), 0 = detrimental (debuff). Populated by sync-from-eqmac.';
