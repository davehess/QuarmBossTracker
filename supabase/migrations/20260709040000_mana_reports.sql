-- mana_reports — self-reported "% mana" macro call-outs, extracted bot-side
-- from the live /gu + /rs chat relay (the same lines already flowing to
-- Discord). One row per character, last report wins. Complements
-- character_live_state.self_mana_pct (Zeal pipe, Mimic-running casters only):
-- the macros cover every healer/caster ANY Mimic user can hear, so the /raid
-- Mana list + Twitch Queue fill in without requiring the reporter to run
-- Mimic. Group chat is never relayed (privacy), so nothing new leaves anyone's
-- machine — this reads what the relay already carries.
create table if not exists public.mana_reports (
  guild_id    text        not null,
  character   text        not null,
  pct         numeric     not null,
  source      text        default 'macro',
  reported_at timestamptz not null default now(),
  primary key (guild_id, character)
);

alter table public.mana_reports enable row level security;
revoke all on public.mana_reports from anon;
grant select on public.mana_reports to authenticated;
grant all on public.mana_reports to service_role;
