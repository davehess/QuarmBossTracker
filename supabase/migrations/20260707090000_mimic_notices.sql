-- mimic_notices — "Mimic Mail" broadcast channel (Uilnayar 2026-07-07: "a
-- communications channel to notify users of critical elements, regardless of
-- mimic version moving forward").
--
-- Officers compose on /admin/notices (service-role writes). Delivery is
-- version-independent from Mimic 1.6 forward: the bot serves active notices
-- alongside the overlay-tuning payload every agent already polls (~90s), the
-- dashboard header shows a pulsing ✉ with an unread dot, and CRITICAL
-- notices are additionally posted to Discord by the bot
-- (MIMIC_NOTICE_CHANNEL_ID, falling back to TRIGGER_BROADCAST_CHANNEL_ID).

CREATE TABLE IF NOT EXISTS public.mimic_notices (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id              text NOT NULL DEFAULT 'wolfpack',
  title                 text NOT NULL,
  body                  text NOT NULL,
  severity              text NOT NULL DEFAULT 'info',   -- info | critical
  active                boolean NOT NULL DEFAULT true,
  created_by_discord_id text,
  created_by_name       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz,
  discord_posted_at     timestamptz
);
ALTER TABLE public.mimic_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mimic_notices read" ON public.mimic_notices;
CREATE POLICY "mimic_notices read" ON public.mimic_notices
  FOR SELECT TO authenticated USING (true);
