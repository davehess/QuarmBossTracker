-- Historical chat archive — feeds /chatstats and future era-thread fills.
-- Each row is one guild- or raid-chat line captured from an agent's [O] backfill.
--
-- Dedup contract: UNIQUE(guild_id, ts, channel, speaker, text). The bot's
-- /api/agent/historical_chat handler upserts with on_conflict=guild_id,ts,channel,speaker,text
-- so re-running the same backfill is a no-op rather than a multiplier.
CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  guild_id    TEXT        NOT NULL DEFAULT 'wolfpack',
  ts          TIMESTAMPTZ NOT NULL,
  channel     TEXT        NOT NULL,            -- 'guild' | 'raid'
  speaker     TEXT        NOT NULL,
  text        TEXT        NOT NULL,
  who         JSONB,                            -- { name, level, race, class } if known
  uploaded_by TEXT,                             -- character whose log this came from
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup index — the upsert path keys on this exact set
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_dedup
  ON chat_messages (guild_id, ts, channel, speaker, text);

-- Common query patterns: by era (date range), by speaker, by channel
CREATE INDEX IF NOT EXISTS chat_messages_ts        ON chat_messages (ts);
CREATE INDEX IF NOT EXISTS chat_messages_speaker   ON chat_messages (speaker);
CREATE INDEX IF NOT EXISTS chat_messages_channel   ON chat_messages (channel);
