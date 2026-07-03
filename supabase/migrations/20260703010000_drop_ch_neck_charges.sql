-- Drop the CH-neck (Necklace of Resolution) charge tracker (Dave 2026-07-03:
-- "We can remove the CH Neck piece, it's just not useful"). Reverts
-- 20260702230000_ch_neck_charges.sql — no data worth preserving, the feature
-- shipped for less than a day and was never in real raid use.
drop table if exists public.ch_neck_charges;
