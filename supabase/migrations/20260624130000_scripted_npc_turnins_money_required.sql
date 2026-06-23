-- money_required jsonb on scripted_npc_turnins so we capture the currency a
-- handin demands ({plat,gold,silver,copper}). The EQ trade window holds 4
-- items + currency, and a turn-in can demand both: e.g. Kurron Ni asks for
-- 900pp + 3 Darkforge armor pieces. Both Perl signatures occur in the wild:
--   • inline currency keys: plugin::check_handin(\%ic, 7836 => 1, platinum => 100)
--   • prefix condition:    ($platinum >= 900) && plugin::check_handin(\%ic, ...)
-- The parser handles both. cash on the same table is the REWARD currency
-- (quest::givecash); money_required is the cost. (Uilnayar 2026-06-24.)
alter table scripted_npc_turnins add column if not exists money_required jsonb;
