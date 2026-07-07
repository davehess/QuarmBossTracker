-- Web UI Studio (/me/ui) — three tables (Uilnayar 2026-07-06: "UI studio
-- needs a version on wolfpack.quest to update these outside of that machine,
-- access backed up UI files and macros, find those common macros and suggest
-- updates").
--
-- ui_snapshots payloads are ENCRYPTED (bot-side WISHLIST_BID_KEY — the web
-- can't read them), so the BOT extracts what the web needs:
--   • ui_socials_index — per-character [Socials] macros, indexed in plaintext
--     by the bot at upload time (it has the plaintext before encrypting) and
--     backfilled from the latest snapshot per character on startup. Socials
--     are PRIVATE scope (they can carry personal macro text) → RLS with NO
--     authenticated policy; the web reads via service_role and filters to the
--     signed-in owner's household.
--   • common_macros — guild-wide aggregate the bot recomputes from the index.
--     Only macros observed on ≥3 DISTINCT characters are written, so the
--     commonality bar doubles as the privacy filter → authenticated-readable.
--   • ui_pending_edits — macro edits staged on /me/ui, pulled by the owner's
--     agent (GET /api/agent/ui-pending-edits) and applied to the character's
--     ini once they're logged out; result reported back. Service-role only.

CREATE TABLE IF NOT EXISTS public.ui_socials_index (
  guild_id         text NOT NULL DEFAULT 'wolfpack',
  character        text NOT NULL,
  owner_discord_id text,
  page             int  NOT NULL,
  button           int  NOT NULL,
  name             text,
  color            int,
  lines            jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_file      text,
  snapshot_id      uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, character, page, button)
);
ALTER TABLE public.ui_socials_index ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service_role only.

CREATE TABLE IF NOT EXISTS public.common_macros (
  guild_id   text NOT NULL DEFAULT 'wolfpack',
  sig        text NOT NULL,                       -- normalized lines signature
  name       text,                                -- most common button label
  lines      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- representative lines
  char_count int  NOT NULL DEFAULT 0,             -- distinct characters using it
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, sig)
);
ALTER TABLE public.common_macros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "common_macros read" ON public.common_macros;
CREATE POLICY "common_macros read" ON public.common_macros
  FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.ui_pending_edits (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id         text NOT NULL DEFAULT 'wolfpack',
  character        text NOT NULL,
  owner_discord_id text NOT NULL,
  target_file      text,             -- NULL → agent resolves <char>_pq.proj.ini
  edits            jsonb NOT NULL,   -- [{section,key,value|null}] — Socials/HotButtons only
  note             text,
  status           text NOT NULL DEFAULT 'pending',  -- pending|applied|failed|cancelled
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  applied_at       timestamptz
);
CREATE INDEX IF NOT EXISTS ui_pending_edits_char_status
  ON public.ui_pending_edits (guild_id, character, status);
ALTER TABLE public.ui_pending_edits ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service_role only.
