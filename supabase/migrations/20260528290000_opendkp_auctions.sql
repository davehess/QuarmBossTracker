-- opendkp_auctions: canonical loot/bidding mirror.
--
-- Replaces the per-raid Items[] approach that wasn't returning data. The
-- /clients/wolfpack/auctions?page=N endpoint is paginated (50/page, ~1000
-- entries) and returns one row per auction with winner + bid + auctioneer.
-- Unawarded auctions (no winner) are still recorded so we can see what
-- dropped vs what got picked up.

create table if not exists opendkp_auctions (
  auction_id      bigint primary key,
  raid_id         bigint references opendkp_raids(raid_id) on delete set null,
  item_id         int,
  item_name       text not null,
  winner          text,
  bid_amount      int,
  auctioneer      text,
  notes           text,
  state           int,
  awarded_at      timestamptz,
  created_at      timestamptz,
  end_at          timestamptz,
  fetched_at      timestamptz not null default now()
);

create index if not exists opendkp_auctions_raid_idx
  on opendkp_auctions (raid_id);
create index if not exists opendkp_auctions_winner_idx
  on opendkp_auctions (lower(winner)) where winner is not null;
create index if not exists opendkp_auctions_item_idx
  on opendkp_auctions (item_name);
create index if not exists opendkp_auctions_awarded_idx
  on opendkp_auctions (raid_id, bid_amount desc)
  where winner is not null;

-- Repoint the existing loot view at the new auctions source so the web
-- app's per-night loot block and /character/[name] loot list start
-- populating from auctions. Only awarded auctions show up here.
drop view if exists opendkp_loot_recent;
create view opendkp_loot_recent as
select
  r.ts::date         as raid_date,
  r.raid_id,
  r.name             as raid_name,
  a.item_name,
  a.winner           as character_name,
  a.bid_amount       as dkp,
  a.notes,
  a.item_id          as game_item_id,
  a.item_id,
  a.auction_id,
  a.auctioneer
from opendkp_auctions a
join opendkp_raids r on r.raid_id = a.raid_id
where a.winner is not null
  and a.bid_amount is not null;

-- RLS — same posture as the other opendkp_* tables.
alter table opendkp_auctions enable row level security;

drop policy if exists opendkp_auctions_read on opendkp_auctions;
create policy opendkp_auctions_read on opendkp_auctions
  for select to authenticated using (true);

drop policy if exists opendkp_auctions_anon_read on opendkp_auctions;
create policy opendkp_auctions_anon_read on opendkp_auctions
  for select to anon using (true);

grant select on opendkp_auctions to authenticated, anon;
grant all    on opendkp_auctions to service_role;
grant select on opendkp_loot_recent to authenticated, anon;
