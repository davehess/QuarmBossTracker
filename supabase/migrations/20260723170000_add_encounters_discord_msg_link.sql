-- #83 — parse deep links (Discord card ↔ wolfpack.quest).
-- Store the Discord jump link of the parse card posted to the Parses Log
-- thread on each encounter row, so the web parse page (/parses/[id]) can
-- render a "View in Discord →" backlink. Nullable + idempotent; the bot
-- writes it best-effort (first writer wins via an is.null guard) and never
-- fails parse posting when the column is absent.

alter table encounters
  add column if not exists discord_msg_link text;
