-- Live raid roster from Zeal's type-5 "raid" pipe event (name, class, group,
-- level, rank per member). Uploaded by any agent in the raid (the roster is
-- identical from every member's view); latest write per (guild, name) wins.
-- Members not refreshed within the read window have left the raid and age out.
-- Powers the group-based /buffs coverage grid.
create table if not exists public.raid_roster (
  guild_id               text not null default 'wolfpack',
  name                   text not null,
  class                  text,
  group_num              int,
  level                  int,
  rank                   text,
  captured_at            timestamptz not null default now(),
  uploaded_by_discord_id text,
  primary key (guild_id, name)
);
create index if not exists raid_roster_captured_idx
  on public.raid_roster (guild_id, captured_at desc);

alter table public.raid_roster enable row level security;
revoke all on public.raid_roster from anon;
grant select on public.raid_roster to authenticated;
grant all on public.raid_roster to service_role;
