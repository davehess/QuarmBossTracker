-- supabase/migrations/20260525150000_wishlist_bid_privacy.sql
--
-- BID STRATEGY PRIVACY — "safeguard even from me as the main admin"
--
-- Sealed bids are competitive strategy. Members must not see each other's
-- bid amounts — not via Discord commands, not via the Supabase SQL editor,
-- not via any API query. This migration enforces that at the schema level.
--
-- The approach:
--   1. Add `bid_amount_enc` (text) — AES-256-GCM ciphertext produced by the
--      bot. The decryption key (WISHLIST_BID_KEY env var) lives ONLY in the
--      bot process. The Supabase dashboard sees an opaque hex string:
--        "d3f1a2...:ab4c...:0e1f..."  ← meaningless without the key.
--
--   2. Nullify the plaintext `bid_amount` column added/renamed in earlier
--      migrations. We don't DROP it (to stay idempotent) but the bot stops
--      writing to it. The column comment explains it is deprecated.
--
--   3. Strip any anon/authenticated SELECT grants on wishlists (belt-and-
--      suspenders — the initial schema already revoked them, but this is
--      belt-and-suspenders for a privacy-critical table).
--
--   4. Lock down `loot_drops.runner_up_bids` the same way — it contains
--      per-character bid amounts for completed auctions (post-hoc, but still
--      strategically sensitive for future auctions).
--
-- The bot reads/writes using service_role, which bypasses RLS. Decryption
-- happens in bot process memory — the plaintext integer never touches the DB.
--
-- Key rotation: when WISHLIST_BID_KEY changes, all rows must be re-encrypted.
-- Use: scripts/rotate-bid-key.js (TODO — generate if you ever rotate the key).

-- ── 1. Add encrypted bid column ──────────────────────────────────────────────
alter table wishlists
  add column if not exists bid_amount_enc text;

comment on column wishlists.bid_amount_enc is
  'AES-256-GCM encrypted bid amount. '
  'Key stored ONLY in WISHLIST_BID_KEY bot env var — Supabase never sees it. '
  'Format: "<iv_hex>:<auth_tag_hex>:<ciphertext_hex>". '
  'NULL means no explicit bid → bot bids 1 DKP (safe default). '
  'Do NOT add a plaintext fallback here.';

-- ── 2. Deprecate the plaintext column (clear existing rows, add warning) ─────
update wishlists set bid_amount = null where bid_amount is not null;

comment on column wishlists.bid_amount is
  'DEPRECATED (migration 20260525150000). Nullified — use bid_amount_enc. '
  'Kept for backward compat only. Do not write to this column.';

-- ── 3. Belt-and-suspenders RLS lockdown on wishlists ─────────────────────────
-- Revoke any stray grants (no-op if not granted; idempotent).
revoke all on wishlists from anon;
revoke all on wishlists from authenticated;

-- Ensure no SELECT policy exists for anon/authenticated.
-- (Drop idempotently by catching the "does not exist" error via DO block.)
do $$
begin
  drop policy if exists "wishlists_read_all" on public.wishlists;
  drop policy if exists "wishlists_anon_read" on public.wishlists;
  drop policy if exists "wishlists_auth_read" on public.wishlists;
exception when others then null;
end;
$$;

comment on table wishlists is
  'PRIVACY SENSITIVE — bid_amount_enc is AES-256-GCM encrypted. '
  'No SELECT policy for anon/authenticated is intentional. '
  'service_role (bot) is the only intended read path. '
  'Do not expose bid amounts in any public API or web UI without encryption.';

-- ── 4. Lock down loot_drops (runner_up_bids contains post-auction bids) ──────
revoke all on loot_drops from anon;
revoke all on loot_drops from authenticated;

do $$
begin
  drop policy if exists "loot_drops_read_all" on public.loot_drops;
  drop policy if exists "loot_drops_anon_read" on public.loot_drops;
exception when others then null;
end;
$$;

comment on table loot_drops is
  'PRIVACY SENSITIVE — runner_up_bids contains per-character bid amounts from '
  'completed auctions. No public SELECT policy is intentional. '
  'Future web UI: expose winner_character and dkp_spent only (not runner_up_bids).';
