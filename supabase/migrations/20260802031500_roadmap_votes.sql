-- Roadmap queue voting (wolfpack.quest/roadmap). One row per (item, member);
-- vote weight is always 1 and un-voting deletes the row. RLS is enabled with
-- NO policies on purpose: only the service role touches this table — the web
-- server actions verify the Supabase session server-side and then write via
-- the admin client, so vote counts stay readable on the PUBLIC roadmap page
-- (aggregated server-side) without exposing per-member rows to anyone.
CREATE TABLE IF NOT EXISTS roadmap_votes (
  item_key   text        NOT NULL,
  user_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_key, user_id)
);
ALTER TABLE roadmap_votes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS roadmap_votes_item_idx ON roadmap_votes (item_key);
