-- Mob-info overlay: capture the special-attack flags + parametrized abilities
-- from the EQMac dump so the targeting overlay can show Summon/Enrage/Flurry/
-- Magical, etc.
--
-- npcspecialattks  — classic letter-flag string (S=Summon, E=Enrage, F=Flurry,
--                    m=Magical, R=Rampage, r=AreaRampage, T=Triple, Q=Quad, …).
--                    This is what the EQMacEmu (Al'Kabor-era) dump carries.
-- special_abilities — newer parametrized form ("1,1^2,1^…"); kept in case a
--                     future dump carries it instead. Decoded client-side.
--
-- Both nullable; populated by scripts/sync-from-eqmac.js on the next sync run.
ALTER TABLE public.eqemu_npc_types
  ADD COLUMN IF NOT EXISTS npcspecialattks  text,
  ADD COLUMN IF NOT EXISTS special_abilities text;
