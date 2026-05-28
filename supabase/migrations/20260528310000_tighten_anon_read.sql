-- Drop anon-read policies on guild-data tables. The web app uses service_role
-- for SSR reads (bypasses RLS regardless) and gates every page behind sign-in
-- at the page level. There's no reason an unauthenticated client with the
-- public NEXT_PUBLIC_SUPABASE_ANON_KEY should be able to query encounters,
-- ticks, auctions, bid history, or character class/race/rank directly.
--
-- Authenticated read policies stay intact — signed-in guild members keep
-- working through anon-key client paths. Tier 1 eqemu_* tables, patch_notes,
-- sync_meta, wolfpack_roles, and bosses_local stay public (game catalog +
-- non-sensitive infra).
--
-- Idempotent — drop policies if they exist.

-- characters: drop the anon policy added when we were considering public sharing.
drop policy if exists characters_anon_read on characters;

-- encounters + encounter_players: drop the "public_read" policy. The
-- authenticated_read policy is the one we actually want.
drop policy if exists encounters_public_read on encounters;
drop policy if exists encounter_players_public_read on encounter_players;

-- OpenDKP mirror tables — drop anon policies. Authenticated policies remain.
drop policy if exists opendkp_raids_anon_read       on opendkp_raids;
drop policy if exists opendkp_ticks_anon_read       on opendkp_ticks;
drop policy if exists opendkp_loot_anon_read        on opendkp_loot;
drop policy if exists opendkp_auctions_anon_read    on opendkp_auctions;
drop policy if exists opendkp_auction_bids_anon_read on opendkp_auction_bids;
