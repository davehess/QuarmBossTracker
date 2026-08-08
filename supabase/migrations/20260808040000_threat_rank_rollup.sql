-- Durable per-encounter threat ranking, so the raw snapshot stream stops being
-- the system of record for it.
--
-- What the raw stream is actually FOR (audited 2026-08-07): exactly one reader
-- exists — the dashboard's "Live threat" / "Threat detail" 🛰local/🌐server
-- toggle, which asks how often a character was #1 and top-3 over 30 days. That
-- question was costing 484 MB, 19,580 full scoreboards per encounter, and it
-- evaporated entirely once rows aged past the retention sweep.
--
-- One row per (encounter, character) answers it forever in a few KB, and gives
-- us something the stream never could: history older than the sweep window.
--
-- Deliberately NOT storing damage numbers here — encounter_players already
-- owns those and is the merged, multi-uploader truth. This table stores only
-- what the snapshots uniquely knew: WHERE IN THE ORDER you sat, over time.

CREATE TABLE IF NOT EXISTS public.encounter_threat_rank (
  guild_id        text        NOT NULL,
  encounter_id    uuid        NOT NULL,
  character_name  text        NOT NULL,
  boss_name       text,
  started_at      timestamptz,
  -- How many snapshots this character appeared in, and where they ranked.
  snapshots       integer     NOT NULL DEFAULT 0,
  times_top1      integer     NOT NULL DEFAULT 0,
  times_top3      integer     NOT NULL DEFAULT 0,
  best_rank       integer,
  worst_rank      integer,
  -- Rank averaged across the fight — the "were you riding the top" number, and
  -- the one a tank actually wants. numeric so a 1.4 reads honestly.
  avg_rank        numeric(6,2),
  -- Field size matters: rank 2 of 3 is not rank 2 of 40.
  avg_field       numeric(6,2),
  rolled_up_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encounter_threat_rank_pk PRIMARY KEY (guild_id, encounter_id, character_name)
);

CREATE INDEX IF NOT EXISTS encounter_threat_rank_char_idx
  ON public.encounter_threat_rank (guild_id, lower(character_name), started_at DESC);

COMMENT ON TABLE public.encounter_threat_rank IS
  'Per-encounter threat RANKING roll-up, derived from encounter_threat_snapshots at fight end. Survives the raw snapshot retention sweep; damage totals live in encounter_players, not here.';

ALTER TABLE public.encounter_threat_rank ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'encounter_threat_rank'
       AND policyname = 'threat_rank_read_authenticated'
  ) THEN
    CREATE POLICY threat_rank_read_authenticated
      ON public.encounter_threat_rank FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Backfill every encounter we still hold snapshots for, so the feature has
-- history on day one rather than starting empty. Idempotent: re-running
-- refreshes the same primary key.
INSERT INTO public.encounter_threat_rank
  (guild_id, encounter_id, character_name, boss_name, started_at,
   snapshots, times_top1, times_top3, best_rank, worst_rank, avg_rank, avg_field)
WITH ranked AS (
  SELECT s.guild_id,
         s.encounter_id,
         s.boss_name,
         s.started_at,
         s.snapshot_at,
         p.key AS character_name,
         row_number() OVER (
           PARTITION BY s.guild_id, s.encounter_id, s.snapshot_at, s.uploader
           ORDER BY (COALESCE((p.value->>'swing')::numeric, 0)
                   + COALESCE((p.value->>'proc')::numeric,  0)
                   + COALESCE((p.value->>'spell')::numeric, 0)
                   + COALESCE((p.value->>'heal')::numeric,  0)) DESC
         ) AS rank,
         count(*) OVER (
           PARTITION BY s.guild_id, s.encounter_id, s.snapshot_at, s.uploader
         ) AS field
    FROM public.encounter_threat_snapshots s
    CROSS JOIN LATERAL jsonb_each(s.per_player) p
   WHERE s.encounter_id IS NOT NULL
     AND jsonb_typeof(s.per_player) = 'object'
)
SELECT guild_id,
       encounter_id,
       character_name,
       min(boss_name)  AS boss_name,
       min(started_at) AS started_at,
       count(*)                                   AS snapshots,
       count(*) FILTER (WHERE rank = 1)           AS times_top1,
       count(*) FILTER (WHERE rank <= 3)          AS times_top3,
       min(rank)                                  AS best_rank,
       max(rank)                                  AS worst_rank,
       round(avg(rank)::numeric, 2)               AS avg_rank,
       round(avg(field)::numeric, 2)              AS avg_field
  FROM ranked
 GROUP BY guild_id, encounter_id, character_name
ON CONFLICT (guild_id, encounter_id, character_name) DO UPDATE
  SET snapshots    = EXCLUDED.snapshots,
      times_top1   = EXCLUDED.times_top1,
      times_top3   = EXCLUDED.times_top3,
      best_rank    = EXCLUDED.best_rank,
      worst_rank   = EXCLUDED.worst_rank,
      avg_rank     = EXCLUDED.avg_rank,
      avg_field    = EXCLUDED.avg_field,
      boss_name    = EXCLUDED.boss_name,
      started_at   = EXCLUDED.started_at,
      rolled_up_at = now();
