-- character_bid_prefs — make planned bids survive a reinstall.
--
-- Hitya, 2026-08-26: "have these all local and sync them up to the DB and bring
-- them back down to a local mimic." Today `logsync.plannedbids.json`,
-- `logsync.lootdismiss.json` and `logsync.bidfamily.json` are LOCAL ONLY with
-- no bot-side counterpart at all — reinstall Mimic, switch machines, or play on
-- the Deck instead of the desktop and every planned bid is gone.
--
-- The local file stays the LIVE source of truth for the panel; this table is a
-- roaming backup. A dashboard that cannot reach the bot must keep working
-- exactly as it does now.
--
-- Last-writer-wins on updated_at, deliberately NOT a merge: these are one
-- person's preferences edited on one machine at a time, and merging would let a
-- stale Deck resurrect a planned bid the desktop just cleared.
--
-- Full design + the autobid safety rules: docs/DESIGN-bid-assist.md

CREATE TABLE IF NOT EXISTS character_bid_prefs (
  guild_id     text        NOT NULL DEFAULT 'wolfpack',
  character    text        NOT NULL,
  item_id      integer     NOT NULL,
  planned_bid  integer,
  autobid      boolean     NOT NULL DEFAULT false,
  dismissed    boolean     NOT NULL DEFAULT false,
  item_name    text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, character, item_id)
);

CREATE INDEX IF NOT EXISTS character_bid_prefs_char_idx
  ON character_bid_prefs (guild_id, lower(character));

-- service_role only (the bot). No member-facing direct access: the agent goes
-- through the bot's authenticated endpoint, same as every other bid surface.
ALTER TABLE character_bid_prefs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE character_bid_prefs IS
  'Roaming bid preferences per (character, item): planned next bid, autobid flag, dismissal. The agent keeps logsync.plannedbids.json / logsync.lootdismiss.json as the LIVE source of truth; this table exists so those survive a reinstall or a move between machines. Last-writer-wins on updated_at, deliberately not a merge - a stale Deck must not resurrect a planned bid the desktop just cleared. See docs/DESIGN-bid-assist.md.';

COMMENT ON COLUMN character_bid_prefs.autobid IS
  'OFF for every item until explicitly ticked, never inferred from wishlist membership, and CLEARED when the character wins anything - Hitya 2026-08-26: "we do not ever want to default these on in case they won other items for the same slots".';
