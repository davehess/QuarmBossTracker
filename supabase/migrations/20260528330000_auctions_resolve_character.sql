-- Bid.User is the OpenDKP account login, not the character name. Bid.CharacterId
-- is the actual character the bid is for; resolves via characters.opendkp_id.
-- Add the ID columns + repoint the loot view to JOIN characters and surface
-- the real character name. Falls back to the raw login when no character match.

alter table opendkp_auctions
  add column if not exists winner_character_id int;

alter table opendkp_auction_bids
  add column if not exists character_id int,
  add column if not exists user_login text;

create index if not exists opendkp_auctions_winner_char_idx
  on opendkp_auctions (winner_character_id) where winner_character_id is not null;
create index if not exists opendkp_auction_bids_character_id_idx
  on opendkp_auction_bids (character_id) where character_id is not null;

drop view if exists opendkp_loot_recent;
create view opendkp_loot_recent
with (security_invoker = true) as
select
  r.ts::date         as raid_date,
  r.raid_id,
  r.name             as raid_name,
  a.item_name,
  coalesce(c.name, a.winner) as character_name,
  a.bid_amount       as dkp,
  a.notes,
  a.item_id          as game_item_id,
  a.item_id,
  a.auction_id,
  a.auctioneer
from opendkp_auctions a
join opendkp_raids r on r.raid_id = a.raid_id
left join characters c on c.opendkp_id = a.winner_character_id
where a.winner is not null
  and a.bid_amount is not null;

grant select on opendkp_loot_recent to authenticated;
