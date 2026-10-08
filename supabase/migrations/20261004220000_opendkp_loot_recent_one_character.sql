-- 20261004220000_opendkp_loot_recent_one_character.sql
-- One row per auction in opendkp_loot_recent (DECISIONS §155, "found, not fixed").
--
-- The view joined `characters` on opendkp_id, and one OpenDKP id is on two character rows (a rename
-- leftover the OpenDKP sync never cleared). Every auction that id won came back twice: 9,251 rows for
-- 9,225 auctions on 2026-10-04. The night's loot lists, character pages, /me and the raid review showed
-- those auctions twice, and leaderboard_loot_spend() counted their DKP twice.
--
-- The join now takes ONE character per OpenDKP id: not deleted first, then the row the sync touched
-- most recently (it stamps updated_at on every roster row it sees, so a leftover row is the stale one),
-- then active, then name for a stable answer. Same columns in the same order, so readers are unchanged.
-- Checked before applying: 9,225 rows, 9,225 distinct auctions, and no row the old view did not return.
--
-- This file also brings the repo in line with production. The two name fallbacks (c2 by winner name,
-- b by the bid-history id→name map) were applied through the MCP on 2026-05-29
-- (opendkp_loot_recent_name_fallback, opendkp_loot_recent_bid_history_fallback) and never committed.
-- The opendkp_character_id_to_name view this reads is likewise only in production.
-- Idempotent (CREATE OR REPLACE).

create or replace view public.opendkp_loot_recent with (security_invoker = on) as
select r.ts::date as raid_date,
       r.raid_id,
       r.name as raid_name,
       a.item_name,
       coalesce(c.name, c2.name, b.character_name, a.winner) as character_name,
       a.bid_amount as dkp,
       a.notes,
       a.item_id as game_item_id,
       a.item_id,
       a.auction_id,
       a.auctioneer
  from opendkp_auctions a
  join opendkp_raids r on r.raid_id = a.raid_id
  left join lateral (
    select ch.name
      from characters ch
     where ch.opendkp_id = a.winner_character_id
     order by ch.deleted, ch.updated_at desc, ch.active desc, ch.name
     limit 1
  ) c on true
  left join characters c2
    on c.name is null and lower(c2.name) = lower(a.winner) and c2.guild_id = 'wolfpack'
  left join opendkp_character_id_to_name b
    on c.name is null and c2.name is null and b.character_id = a.winner_character_id
 where a.winner is not null
   and a.bid_amount is not null;
