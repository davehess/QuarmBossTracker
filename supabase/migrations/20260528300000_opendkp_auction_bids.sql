-- Per-auction bid history. The /clients/wolfpack/auctions/{id} endpoint
-- returns every bid (character, rank, value, timestamp) — captured here
-- before settled auctions discard runner-up data.

create table if not exists opendkp_auction_bids (
  id              bigserial primary key,
  auction_id      bigint not null references opendkp_auctions(auction_id) on delete cascade,
  position        int,
  character_name  text not null,
  rank            text,
  value           int,
  bid_at          timestamptz,
  fetched_at      timestamptz not null default now()
);

create unique index if not exists opendkp_auction_bids_dedup
  on opendkp_auction_bids (auction_id, character_name, value);
create index if not exists opendkp_auction_bids_auction_idx
  on opendkp_auction_bids (auction_id);
create index if not exists opendkp_auction_bids_character_idx
  on opendkp_auction_bids (lower(character_name));

alter table opendkp_auction_bids enable row level security;

drop policy if exists opendkp_auction_bids_read on opendkp_auction_bids;
create policy opendkp_auction_bids_read on opendkp_auction_bids
  for select to authenticated using (true);
drop policy if exists opendkp_auction_bids_anon_read on opendkp_auction_bids;
create policy opendkp_auction_bids_anon_read on opendkp_auction_bids
  for select to anon using (true);

grant select on opendkp_auction_bids to authenticated, anon;
grant all    on opendkp_auction_bids to service_role;
grant usage, select on sequence opendkp_auction_bids_id_seq to service_role;
