-- Capture the verbatim OpenDKP bid payload so we can find the real timestamp
-- field name.
--
-- bid_at is NULL on all 7,393 bids. It is not unwired: _bidRow() already tries
-- Date / BidAt / Timestamp / CreatedAt / created_at / bid_at, and the code
-- comment records that the OpenDKP WEB UI shows a "Date" column for auction
-- 994909. So the API returns the value under some other name (or nested), and
-- the defensive matcher misses it — the same field-name drift that broke the
-- Raid-Helper client.
--
-- This matters for awards, not just tidiness: ties are broken by who bid FIRST
-- (Hitya 2026-08-03), and with bid_at NULL there is currently no way to
-- resolve one. `position` cannot substitute — it is a within-auction rank 1..6,
-- not an arrival clock.
--
-- There is no raw column to mine and no stored sample, so the field name cannot
-- be recovered from what we already have. Storing the payload verbatim (the same
-- pattern rh_events and eqemu_spells use) makes the very next sync reveal it,
-- after which the fix is one entry in the _lootField list.
alter table public.opendkp_auction_bids
  add column if not exists raw jsonb;

comment on column public.opendkp_auction_bids.raw is
  'Verbatim bid object from the OpenDKP auction detail endpoint. Kept so field-name drift (see bid_at, NULL on every row) is diagnosable without a live capture session.';
