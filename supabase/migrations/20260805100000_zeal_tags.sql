-- #194 — Zeal /tag broadcasts carry the target's SPAWN ID (verified from
-- CoastalRedwood/Zeal nameplate.cpp: "ZEALTAG | <text> | <name> | <spawn_id>").
-- The one datum the pipe lacks, delivered through chat. Agents forward the
-- structured extract; the raw channel line never uploads (privacy filter
-- unchanged). Shape: [{ "spawn_id": 1234, "mob": "Thall Va Xakra",
-- "text": "Naggato-Tanking", "shape": "G", "tagger": "Naggato", "since": ISO }]
ALTER TABLE character_live_state ADD COLUMN IF NOT EXISTS zeal_tags jsonb;
