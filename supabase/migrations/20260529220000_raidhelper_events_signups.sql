-- Raid-Helper event mirror. Synced from https://raid-helper.dev API every
-- ~30 min by the bot. Used for sign-up vs reality reconciliation on
-- /admin/signups — did the people who said they'd be there actually
-- show up (per encounter_players + who_observations within the raid
-- window), did anyone show without signing up, etc.

CREATE TABLE IF NOT EXISTS rh_events (
  id                text PRIMARY KEY,
  guild_id          text NOT NULL DEFAULT 'wolfpack',
  server_id         text,
  channel_id        text,
  title             text,
  description       text,
  start_time        timestamptz,
  end_time          timestamptz,
  leader_discord_id text,
  template          text,
  raw               jsonb NOT NULL,
  synced_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rh_events_start_idx ON rh_events (guild_id, start_time DESC);

CREATE TABLE IF NOT EXISTS rh_signups (
  event_id        text NOT NULL REFERENCES rh_events(id) ON DELETE CASCADE,
  signup_id       text NOT NULL,
  discord_id      text,
  user_name       text,
  status          text,
  role            text,
  class_name      text,
  spec_name       text,
  signed_at       timestamptz,
  signup_index    integer,
  raw             jsonb NOT NULL,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, signup_id)
);
CREATE INDEX IF NOT EXISTS rh_signups_user_idx  ON rh_signups (discord_id, signed_at DESC);
CREATE INDEX IF NOT EXISTS rh_signups_event_idx ON rh_signups (event_id, status);

ALTER TABLE rh_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rh_signups ENABLE ROW LEVEL SECURITY;
