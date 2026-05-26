-- supabase/migrations/20260525130000_wishlist_max_dkp.sql
-- Add max_dkp ceiling to wishlists (optional — null means "auto-bid 1 DKP only").
--
-- Background: the original schema treated wishlists as just "registered intent."
-- But the /wishlist add command was already accepting a max_dkp parameter — the
-- column to store it was missing.
--
-- Behavior semantics with this column:
--   max_dkp = NULL   → bot auto-places 1 DKP minimum bid when the item drops.
--                      Wishlister wins if no one else bids. Outbid? No escalation.
--   max_dkp = N      → bot auto-places 1 DKP minimum bid.
--                      If outbid, bot escalates by +1 each step up to N.
--                      At N+1 the bot stops bidding (the wishlister conceded).

alter table wishlists
  add column if not exists max_dkp int;

comment on column wishlists.max_dkp is
  'Auto-bid ceiling. NULL = bid 1 DKP only (no escalation). N = escalate by +1 up to N when outbid.';
