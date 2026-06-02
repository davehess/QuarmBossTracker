-- characters.deleted — preserve characters that OpenDKP marks Deleted so
-- their CharacterId can still resolve in the loot leaderboard.
--
-- Before this, syncCharacters() dropped Deleted=true rows entirely
-- (utils/openDkpSync.js: .filter(c => !c.Deleted)). OpenDKP keeps historical
-- loot pointing at those deleted character IDs forever — the auction's
-- winner_character_id still references the deleted character — so the
-- opendkp_loot_recent COALESCE waterfall fell through to the raw bidder
-- string (e.g. "alezalo"), leaking what looked like Discord handles into
-- the Biggest Spenders leaderboard.
--
-- 69 of 153 distinct auction winner_character_ids (45%) were unresolvable
-- before this change. After the sync re-runs with the updated filter,
-- those resolve to the actual character names.
--
-- Default false keeps existing rows untouched; readers that want only
-- live roster members should add WHERE NOT deleted explicitly.

alter table public.characters
  add column if not exists deleted boolean not null default false;

comment on column public.characters.deleted is
  'True when OpenDKP marks this character Deleted=true. Imported anyway so historical loot awards can resolve the character name. Filter NOT deleted for live roster views.';
