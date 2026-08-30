-- bids_synced_at — has this auction's FULL bid list been mirrored?
--
-- The auctions LIST payload carries only the winning bid(s): measured
-- 2026-08-30, the mirror held 1.08 bids/auction and only 7–8% of auctions had
-- any losing bid, so RECENT MISSES was computing losses from a dataset that
-- was ~92% winners-only (Hitya's report: Utoh's losing bid on Vengeful Mail of
-- the Void absent; a 15/15 tie showing a blank runner-up). Full bids come from
-- the per-auction DETAIL endpoint; this marker makes that ONE call per auction
-- per lifetime — a closed auction's bid list never changes, so a synced
-- auction is never re-fetched.
alter table opendkp_auctions add column if not exists bids_synced_at timestamptz;

-- The pending-picker's exact shape: closed, not yet detail-synced, newest first.
create index if not exists opendkp_auctions_bids_pending
  on opendkp_auctions (end_at desc)
  where bids_synced_at is null and winner_character_id is not null;
