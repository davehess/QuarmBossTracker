-- Plane of Hate mini-boss kill log — moves the tracker from state.json + a
-- hidden Discord JSON embed into Supabase. The old model stored ONE row per
-- spot (overwritten on every kill), which (a) lost history and (b) couldn't
-- survive a Railway redeploy when the volume blanked: the next /pvphatekill
-- save then overwrote the Discord embed with the partial post-redeploy state,
-- erasing every other spot. PvP Hate also reshuffles spawn identities at
-- spots after a period of zone vacancy, so multiple distinct kills CAN
-- legitimately land on the same spot within one nominal 72h lockout — the
-- per-spot-singleton model couldn't represent that either.
--
-- Each kill is its own row. "Current state" of a spot = the most recent row
-- whose next_spawn_latest is in the future (or whose timer is unknown).
-- spot_num is NULLABLE — auto-detected [PVP] broadcasts from foreign guilds
-- arrive without spot information, and Wolf Pack PVP-server kills get a
-- spot assigned later via a Discord button (which UPDATEs the row).

CREATE TABLE IF NOT EXISTS public.hate_kills (
  id                    bigserial PRIMARY KEY,

  -- 'live' = exact 72h timer, no variance. 'pvp' = 72h ±20% variance.
  server                text        NOT NULL CHECK (server IN ('live','pvp')),

  -- 1..12 (4 and 6 don't exist on this server). NULL while a [PVP] echo
  -- waits for a guildmate to click which spot.
  spot_num              smallint        NULL CHECK (spot_num IS NULL OR (spot_num BETWEEN 1 AND 12)),

  -- Killer attribution, sourced from the [PVP] / Druzzil / manual entry.
  -- For a /pvphatekill or /livehatekill click, killer_name is NULL and
  -- recorded_by_discord_id carries the operator's identity.
  killer_name           text            NULL,
  killer_guild          text            NULL,

  -- The kill itself + the derived respawn window.
  killed_at             timestamptz NOT NULL,
  next_spawn_earliest   timestamptz     NULL,  -- killed_at + 80%/100% of timer
  next_spawn_latest     timestamptz     NULL,  -- killed_at + 100%/120% of timer
  -- Set to TRUE when an operator says "this was killed but I don't know
  -- when" — the row participates in board display but the spawn windows
  -- are skipped.
  timer_unknown         boolean     NOT NULL DEFAULT false,

  -- Provenance — how the row was created. 'manual_slash' (/pvphatekill /
  -- /livehatekill), 'manual_button' (clicked the board), 'pvp_broadcast'
  -- (agent saw a [PVP] echo), 'druzzil_broadcast' (agent saw a Druzzil
  -- Ro tells the guild). Used for filtering + display badges.
  source                text        NOT NULL,
  -- Raw log line / Druzzil broadcast text. Capped to 500 chars at write.
  raw_text              text            NULL,
  -- Free-form notes — currently used to flag "(Instanced)" kills.
  notes                 text            NULL,

  -- Discord ID of whoever ran the slash command / clicked the button.
  -- NULL for agent-sourced rows.
  recorded_by_discord_id text           NULL,

  -- The Discord message we posted to HATE_THREAD_ID when the row was
  -- created — used to edit-in-place when the row's state changes (spot
  -- assigned, timer cleared, etc.) and avoids a re-post on every refresh.
  thread_message_id     text            NULL,

  -- Set by the spot-button / "mark available" flow when an operator says
  -- the spot is open again BEFORE next_spawn_latest. Rows with this set
  -- are excluded from "current state" calculations.
  cleared_at            timestamptz     NULL,
  cleared_by_discord_id text            NULL,

  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Hot path: "what's the current state of each spot for this server?" — pulls
-- the latest active row per (server, spot_num). Also covers the boards (which
-- read by server) and per-spot history queries.
CREATE INDEX IF NOT EXISTS hate_kills_server_spot_killed_idx
  ON public.hate_kills (server, spot_num, killed_at DESC);

-- Recent-kills feed (for the agent-broadcast "Singzu of <Freedom> killed
-- Lord of Ire" post): just ordered by killed_at.
CREATE INDEX IF NOT EXISTS hate_kills_server_killed_idx
  ON public.hate_kills (server, killed_at DESC);

-- Cross-source dedup. The agent will see the same kill on multiple alts'
-- logs simultaneously; the agent's own _crossLogDupe handles same-machine
-- duplication, but two SEPARATE installations witnessing the same broadcast
-- still arrive at the bot. Two rows for the same kill within the same UTC
-- minute with the same killer + zone are a duplicate; the unique index
-- makes the second attempt fail with 409 and we drop it. NULL killer =
-- manual entries which always insert fresh.
--
-- NOTE on the AT TIME ZONE 'UTC' cast: `date_trunc(text, timestamptz)` is
-- STABLE (depends on session TZ), and Postgres won't accept a STABLE
-- function in an index expression. Casting to a naive `timestamp` (UTC-
-- fixed) makes the result IMMUTABLE, which the planner requires here.
CREATE UNIQUE INDEX IF NOT EXISTS hate_kills_broadcast_dedup_idx
  ON public.hate_kills (
    server,
    killer_name,
    killer_guild,
    date_trunc('minute', (killed_at AT TIME ZONE 'UTC'))
  )
  WHERE killer_name IS NOT NULL AND source IN ('pvp_broadcast','druzzil_broadcast');

ALTER TABLE public.hate_kills ENABLE ROW LEVEL SECURITY;

-- Read for any signed-in member; bot writes via service_role (bypasses RLS).
DROP POLICY IF EXISTS hate_kills_read_auth ON public.hate_kills;
CREATE POLICY hate_kills_read_auth
  ON public.hate_kills
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.hate_kills IS
  'Plane of Hate mini-boss kill log. Replaces state.json hate_/hate_pvp_ keys + Discord JSON embed. One row per kill; current spot status = latest row per (server,spot_num) where cleared_at IS NULL and (timer_unknown OR next_spawn_latest > now()).';
