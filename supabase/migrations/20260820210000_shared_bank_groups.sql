-- Shared-bank account fingerprinting (Hitya 2026-08-20: "build fingerprinting
-- on shared bank lines" — "The goal is that we don't overcount items in shared
-- banks (up to 8x if we don't review and dedup)").
--
-- The shared bank is ACCOUNT-level: every character on a game account exports
-- byte-identical SharedBank rows in /outputfile inventory. That identity IS
-- the account fingerprint — no TAKP-forum modeling, no manual grouping table.
-- Characters whose SharedBank row-set hashes identically are on the same game
-- account; consumers count that shared bank ONCE per fingerprint group,
-- attributed to the freshest snapshot (the representative).
--
-- Self-maintaining by construction: move a character to another game account
-- and their next inventory upload carries that account's shared bank → new
-- fingerprint → regrouped, nothing to curate. Two designed-in caveats:
--   • EMPTY shared banks never group — no SharedBank rows means no row in
--     this view at all (an empty-content hash would collide every empty
--     account into one giant false group).
--   • Same-account characters snapshotted at different times can transiently
--     split if the shared bank changed in between — mild overcount until the
--     stale snapshot refreshes, which the agent's auto-upload (3.6.0+) now
--     does within ~10 minutes of the file changing.
-- Cross-FAMILY fingerprint collisions (two unrelated accounts with identical
-- trivial shared banks, e.g. one Water Flask each) are possible, so consumers
-- that scope to one person's characters should pick the representative WITHIN
-- their subset rather than trusting is_representative globally.
CREATE OR REPLACE VIEW shared_bank_groups AS
SELECT guild_id,
       character_name,
       fingerprint,
       newest_observed_at,
       row_number() OVER (PARTITION BY guild_id, fingerprint
                          ORDER BY newest_observed_at DESC, character_name) = 1
         AS is_representative
FROM (
  SELECT guild_id,
         character_name,
         md5(string_agg(
           slot_label || '|' || COALESCE(item_id::text, '') || '|' ||
             lower(item_name) || '|' || COALESCE(quantity, 1)::text,
           E'\n' ORDER BY slot_label)) AS fingerprint,
         max(observed_at) AS newest_observed_at
  FROM character_inventory
  WHERE slot_label ILIKE 'sharedbank%'
  GROUP BY guild_id, character_name
) s;
