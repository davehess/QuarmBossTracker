-- supabase/migrations/20260525140000_wishlist_sealed_bid.sql
--
-- Rename wishlists.max_dkp → wishlists.bid_amount.
--
-- Semantics correction: the guild uses CLOSED/SEALED bids, not open
-- auctions with escalation. Each character submits one bid amount and
-- the highest wins. There is no "I'll go up to X" escalation.
--
-- New behavior:
--   bid_amount = NULL → bot places a single 1 DKP bid (the safe default).
--                       If they win, they paid 1 DKP. If they lose, no escalation.
--   bid_amount = N    → bot places a single N DKP bid. EXACTLY N — never more.
--                       This is intentional: 'all-in' bids exist (someone
--                       bidding their entire balance) and we don't want the bot
--                       to ever guess at that on their behalf.
--
-- Both the safety floor (1 DKP) and explicit all-in (e.g. 187 DKP) are
-- supported by the same column — the absence of a value means safe,
-- the presence of a value means exact.

alter table wishlists rename column max_dkp to bid_amount;

comment on column wishlists.bid_amount is
  'Closed/sealed bid amount. NULL = bot places 1 DKP only (safe default). N = bot places exactly N DKP (no escalation, no overage). Players must explicitly set N to commit DKP — the bot will never guess.';
