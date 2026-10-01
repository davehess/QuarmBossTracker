-- PoP flags as the server keeps them (DECISIONS §119, 2026-10-01).
-- stage: the server's own flag step behind a row (a qglobal value, e.g. 'mavuin_3' = mavuin 3),
--        read from the line the flag NPC prints before the grant or from Seer Mal Nae`Shi's recital.
--        utils/popFlagStages.js holds the tables.
-- npc:   for a witnessed hail (flag_key 'hail'), the NPC that was hailed. The bot used to drop it.
alter table public.pop_flags add column if not exists stage text;
alter table public.pop_flags add column if not exists npc   text;
