-- CH-neck (Necklace of Resolution, Plane of Sky) charge tracker (Uilnayar
-- 2026-07-02). It's a one-charge item, manually recharged by combining with
-- a Mana Battery - Class Four inside a Box of the Void — both lore items, so
-- recharging is rare and deliberate. The combine's success line is generic
-- tradeskill flavor text ("You have fashioned the items together to create
-- something new!"), identical for every combine in the game, so it can't be
-- used to auto-detect a recharge. Two event sources instead:
--   'used'             — agent-observed "You begin casting Complete Healing"
--                         self-cast line (the item's click effect). Always
--                         trusted — only the clicker's own log ever shows it.
--   'declared_charged' — a self-service "CH Neck Charged" button on the CH
--                         Chain overlay. Scoped server-side to the CLICKING
--                         agent's own active character (never a client-
--                         supplied name), so one user can't mark another's
--                         row charged.
-- No row = unknown (never observed either event) — the overlay shows nothing
-- rather than assuming a state we have no evidence for.
create table if not exists public.ch_neck_charges (
  guild_id       text not null default 'wolfpack',
  character      text not null,
  available      boolean not null,
  last_event     text not null,   -- 'used' | 'declared_charged'
  last_event_at  timestamptz not null default now(),
  updated_by_discord_id text,
  updated_at     timestamptz not null default now(),
  primary key (guild_id, character)
);

alter table public.ch_neck_charges enable row level security;
revoke all on public.ch_neck_charges from anon;
grant select on public.ch_neck_charges to authenticated;
grant all on public.ch_neck_charges to service_role;
