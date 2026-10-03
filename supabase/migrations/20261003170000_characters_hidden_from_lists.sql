-- 20261003170000_characters_hidden_from_lists.sql
-- The guild lead, 2026-10-03: "put any unknown characters into a minimized area and make it so I can
-- hide these characters from anything but account inventory".
--
-- An owner-set flag on a character: when true the character leaves every list of characters on the
-- site and in Mimic (the /pop page, the PoP guide, /me, the spellbook picker's main list, Mimic's
-- character lists) and shows ONLY in the account inventory, where a mule's bags are the point. It is
-- a display choice, not a data one: unlike exclude_from_stats / exclude_inventory it stops nothing
-- being collected or uploaded. Set by the owner (or an officer) from /me.
alter table public.characters
  add column if not exists hidden_from_lists boolean not null default false;

comment on column public.characters.hidden_from_lists is
  'Owner-set: hide this character from every character list except the account inventory. Display only; collection is unaffected (see exclude_from_stats / exclude_inventory for that).';
