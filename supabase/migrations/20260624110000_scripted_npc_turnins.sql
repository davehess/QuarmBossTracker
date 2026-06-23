-- scripted_npc_turnins — authoritative quest data scraped from the ProjectEQ
-- quest scripts (https://github.com/ProjectEQ/projecteqquests). Each row is one
-- turn-in handler: the items a player gives, the items rewarded, the faction
-- nudges, and the raw script slice as forensic trace. Lets us seed real quest
-- discovery instead of hand-typing (Uilnayar 2026-06-24: "Build the script
-- import" → unblocks Velium armor, Coldain rings, Skyshrine class armor,
-- Dozekar tears, epic 1.0 chains, etc.).
--
-- Loader: scripts/import-quest-scripts.js walks the repo, parses each
-- EVENT_ITEM (Perl) and item_lib.check_turn_in (Lua) block, and writes
-- one row per detected turn-in branch. Run with --commit on a machine that
-- has SUPABASE_SERVICE_ROLE_KEY; --dump <file> writes JSONL for offline load.
create table if not exists scripted_npc_turnins (
  id                 bigserial primary key,
  zone_short         text not null,
  npc_name           text not null,
  script_path        text not null,                -- e.g. "kael/Captain_Bvellos.pl"
  script_lang        text not null check (script_lang in ('lua','perl')),
  inputs             jsonb not null,               -- [{item_id, qty}]
  outputs            jsonb not null,               -- [{item_id, kind:'fixed'|'random'}]
  faction_changes    jsonb,                        -- [{faction_id, delta}]
  cash               jsonb,                        -- {plat, gold, silver, copper}
  exp_award          integer,
  random_outputs     boolean not null default false,
  raw_snippet        text not null,
  imported_at        timestamptz not null default now(),
  unique (zone_short, npc_name, raw_snippet)
);
create index if not exists scripted_npc_turnins_zone_idx
  on scripted_npc_turnins (zone_short);
create index if not exists scripted_npc_turnins_npc_idx
  on scripted_npc_turnins (lower(npc_name));
create index if not exists scripted_npc_turnins_input_gin
  on scripted_npc_turnins using gin ((inputs));
create index if not exists scripted_npc_turnins_output_gin
  on scripted_npc_turnins using gin ((outputs));
alter table scripted_npc_turnins enable row level security;
grant all on scripted_npc_turnins to service_role;
grant usage, select on all sequences in schema public to service_role;
