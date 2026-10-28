-- 20261028170000_guild_id_on_untagged_tables.sql  (applied 2026-10-28 after a snapshot of all 33 tables in schema
-- backup_seg_20261028; Tower's archive had merged the same day at 12:37 UTC)
--
-- Step 2 of the raidmimic segmentation build order (docs/DESIGN-raidmimic-hosted.md section 3): tag every guild-data
-- table with `guild_id text not null default 'wolfpack'`. Additive only: no key, unique, index or RLS change here
-- (steps 3 and 5), and no code reads the column yet, so Wolf Pack behaves exactly as before.
--
-- Shape per table: `alter table ... add column if not exists guild_id text not null default 'wolfpack';`
-- A constant default is a catalog-only change on Postgres 11+ (no table rewrite), so the lock is the brief
-- ACCESS EXCLUSIVE of the ALTER itself. Largest table below: encounter_players, ~245k rows (pg_stat n_live_tup,
-- 2026-10-28). Nothing tagged here is over 1M rows. `lock_timeout` makes a blocked ALTER fail fast rather than
-- queue behind a long reader and stall every writer behind it; re-run the file and it resumes (IF NOT EXISTS).
--
-- Idempotent: safe to run twice.
--
-- ---------------------------------------------------------------------------------------------------------------
-- EXCLUDED (untagged on purpose; no guild owns the rows)
--   eqemu_*                 Tier 1 mirrors of the game server's database: one game, shared by every guild.
--   spell_level_seed        game-data seed (spell levels), not guild-authored.
--   spell_scroll_aliases    game-data alias map.
--   scripted_npc_turnins    imported from the server's quest scripts: game data.
--   quarm_patch_notes       the server's own patch notes, scraped: game data.
--   locked_zone_keys        zone key-item catalog: game data.
--   loot_pet_gear_names     catalog of pet-gear item names: game data.
--   travel_paths            zone-to-zone travel graph over eqemu_zone: game data.
--   zone_map_lines          map line art per zone: game data.
--   sync_meta               bookkeeping for the weekly eqemu mirror sync: platform.
--   ui_window_usage         page/window/day counters: product telemetry, not a guild's data.
--   roadmap_votes           votes on the platform's roadmap, one per signed-in user: platform-level.
--   overlay_design_votes    votes on Mimic overlay designs: platform-level product feedback.
--   overlay_design_feedback comments on Mimic overlay designs: platform-level product feedback.
--   test_server_comments    cross-guild community thread about the test server: platform-level.
--   test_server_interests   cross-guild community interest list: platform-level.
--   anon_feedback           from strangers on eqmimic.quest, belongs to no guild (DECISIONS section 192).
-- Revisit any of these with the guild lead if a hosted guild needs its own copy.
--
-- BACKFILL: none, deliberately. Every parent row already reads 'wolfpack' (aggregate check 2026-10-28:
-- encounters 40,692 / feedback 109 / rh_events 344 / quest_catalog 10, all 'wolfpack'; gallery_masterpieces is
-- empty), so the constant default gives every existing child row the same value an UPDATE ... FROM parent would.
-- It only starts to matter once a second guild writes rows: from then on a child row must be INSERTED with its
-- parent's guild_id (the default would silently stamp 'wolfpack' on another guild's children), so step 4's
-- write-path work owns that. Children whose guild comes from a parent:
--   contributions, combat_events, loot_drops, encounter_players  <- encounters
--   opendkp_ticks, opendkp_loot, opendkp_auctions                <- opendkp_raids (auction_bids <- opendkp_auctions)
--   rh_signups <- rh_events;  feedback_replies <- feedback;  quest_required_item <- quest_catalog
--   gallery_versions, gallery_adoptions, gallery_reports         <- gallery_masterpieces
--
-- INDEXES: none. No table over 100k rows is queried by guild yet, and a single-column index on a column that holds
-- one value in every row is not selective. The key rebuild (step 3) adds guild_id-leading composites where they
-- are needed. (encounter_players, ~245k rows, is the only candidate; it is read by encounter_id.)
-- ---------------------------------------------------------------------------------------------------------------

set local lock_timeout = '5s';

-- Core guild data
alter table public.audit_log           add column if not exists guild_id text not null default 'wolfpack';
alter table public.bosses_local        add column if not exists guild_id text not null default 'wolfpack';
alter table public.bot_boards          add column if not exists guild_id text not null default 'wolfpack';
alter table public.hate_kills          add column if not exists guild_id text not null default 'wolfpack';
alter table public.guild_media         add column if not exists guild_id text not null default 'wolfpack';
alter table public.officer_notes       add column if not exists guild_id text not null default 'wolfpack';
alter table public.patch_notes         add column if not exists guild_id text not null default 'wolfpack';
alter table public.wishlists           add column if not exists guild_id text not null default 'wolfpack';
alter table public.page_views          add column if not exists guild_id text not null default 'wolfpack';

-- Membership and sessions
alter table public.wolfpack_members    add column if not exists guild_id text not null default 'wolfpack';
alter table public.wolfpack_roles      add column if not exists guild_id text not null default 'wolfpack';
alter table public.member_lockouts     add column if not exists guild_id text not null default 'wolfpack';
alter table public.mimic_link_codes    add column if not exists guild_id text not null default 'wolfpack';
alter table public.mimic_sessions      add column if not exists guild_id text not null default 'wolfpack';
alter table public.ui_snapshots        add column if not exists guild_id text not null default 'wolfpack';

-- Encounters and children of encounters (parent: encounters, already tagged)
alter table public.contributions       add column if not exists guild_id text not null default 'wolfpack';
alter table public.encounter_players   add column if not exists guild_id text not null default 'wolfpack';
alter table public.combat_events       add column if not exists guild_id text not null default 'wolfpack';
alter table public.loot_drops          add column if not exists guild_id text not null default 'wolfpack';

-- OpenDKP mirror
alter table public.opendkp_raids       add column if not exists guild_id text not null default 'wolfpack';
alter table public.opendkp_ticks       add column if not exists guild_id text not null default 'wolfpack';
alter table public.opendkp_loot        add column if not exists guild_id text not null default 'wolfpack';
alter table public.opendkp_auctions    add column if not exists guild_id text not null default 'wolfpack';
alter table public.opendkp_auction_bids add column if not exists guild_id text not null default 'wolfpack';
alter table public.opendkp_adjustments add column if not exists guild_id text not null default 'wolfpack';
alter table public.opendkp_audits      add column if not exists guild_id text not null default 'wolfpack';
alter table public.opendkp_call_stats  add column if not exists guild_id text not null default 'wolfpack';

-- Raid-hub signups, feedback replies, quest items, gallery children
alter table public.rh_signups          add column if not exists guild_id text not null default 'wolfpack';
alter table public.feedback_replies    add column if not exists guild_id text not null default 'wolfpack';
alter table public.quest_required_item add column if not exists guild_id text not null default 'wolfpack';
alter table public.gallery_versions    add column if not exists guild_id text not null default 'wolfpack';
alter table public.gallery_adoptions   add column if not exists guild_id text not null default 'wolfpack';
alter table public.gallery_reports     add column if not exists guild_id text not null default 'wolfpack';
