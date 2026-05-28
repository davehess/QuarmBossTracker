-- Re-applies 20260527000000_historical_chat.sql which never landed in prod
-- (table was missing as of 2026-05-28). Adds RLS hardening on top: service_role
-- only, no public read policies. The historical chat collection pipeline is
-- back in scope per the 2026-05-28 direction — we collect to Supabase but
-- intentionally don't surface old chat on Discord.

CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  guild_id    TEXT        NOT NULL DEFAULT 'wolfpack',
  ts          TIMESTAMPTZ NOT NULL,
  channel     TEXT        NOT NULL,
  speaker     TEXT        NOT NULL,
  text        TEXT        NOT NULL,
  who         JSONB,
  uploaded_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_dedup
  ON chat_messages (guild_id, ts, channel, speaker, text);
CREATE INDEX IF NOT EXISTS chat_messages_ts        ON chat_messages (ts);
CREATE INDEX IF NOT EXISTS chat_messages_speaker   ON chat_messages (speaker);
CREATE INDEX IF NOT EXISTS chat_messages_channel   ON chat_messages (channel);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chat_messages FROM anon, authenticated;
