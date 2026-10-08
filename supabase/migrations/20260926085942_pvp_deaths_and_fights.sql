-- PvP deaths and fights (the guild lead, 2026-09-26: "Lets start combining PVP encounters into
-- history. 2+ deaths nearby constitutes encounters I think.").
--
-- pvp_kills only holds kills with Wolf Pack on one side, so a fight between an alliance and the Zeks
-- (the Vex Thal night this was written for) is mostly invisible there. pvp_deaths keeps EVERY death
-- the PvP broadcast reports: player kills, deaths to an NPC, any guilds. The bot writes it from
-- POST /api/agent/pvp. Boss kills are not deaths and stay in pvp_boss_kills.
--
-- Size: about 1,300 deaths a month on this server, so tens of thousands of rows a year. No pruning.

create table if not exists public.pvp_deaths (
  id                     bigserial primary key,
  guild_id               text        not null default 'wolfpack',
  victim                 text        not null,
  victim_guild           text,
  killer                 text,                    -- null when the broadcast names none
  killer_guild           text,
  killer_is_npc          boolean     not null default false,
  pet_name               text,                    -- the pet that landed it; killer is then its owner
  zone                   text,
  died_at                timestamptz not null,
  source                 text        not null,    -- pvp_channel | log_backfill | backfill:<how>
  raw_text               text,
  dedup_key              text        not null unique,   -- guild|victim|second: every relay of one death collapses
  uploaded_by_discord_id text,
  created_at             timestamptz not null default now()
);
create index if not exists pvp_deaths_zone_time_idx on public.pvp_deaths (guild_id, zone, died_at);
create index if not exists pvp_deaths_time_idx      on public.pvp_deaths (guild_id, died_at desc);

alter table public.pvp_deaths enable row level security;
drop policy if exists "pvp_deaths read auth" on public.pvp_deaths;
create policy "pvp_deaths read auth" on public.pvp_deaths
  for select to authenticated using (guild_id = 'wolfpack');

-- Backfill the last 30 days. Wolf Pack kills and deaths come from pvp_kills. Everything else is
-- rebuilt from the who_observations rows the relay wrote for each broadcast: the bot pushes the
-- victim row, then the killer row, in one upsert, so within a batch and a broadcast second the
-- killer's id is the victim's id + 1 (checked 9 of 9 against pvp_assists.raw_text). A row with no
-- partner is a death with no player named (a death to an NPC). Rows that were a known boss kill's
-- killer are left out. The source column says which way each row was recovered.
insert into public.pvp_deaths (guild_id, victim, victim_guild, killer, killer_guild, killer_is_npc,
                               pet_name, zone, died_at, source, raw_text, dedup_key)
with relay as (
  select id, observed_at, created_at, character, nullif(btrim(guild_name), '') guild, zone
  from public.who_observations
  where guild_id = 'wolfpack' and uploaded_by = 'pvp-relay'
    and observed_at >= now() - interval '30 days'
), ledger as (
  select killed_at, zone, victim, victim_guild, killer, killer_guild, pet_name
  from public.pvp_kills
  where guild_id = 'wolfpack' and killed_at >= now() - interval '30 days'
), boss as (
  select killed_at, killed_by from public.pvp_boss_kills where killed_at >= now() - interval '31 days'
), tagged as (
  select r.*,
    exists (select 1 from ledger l
             where date_trunc('second', l.killed_at) = date_trunc('second', r.observed_at)
               and lower(r.character) in (lower(l.victim), lower(l.killer))) as in_ledger,
    exists (select 1 from boss b
             where abs(extract(epoch from b.killed_at - r.observed_at)) <= 2
               and lower(b.killed_by) = lower(r.character)) as boss_killer
  from relay r
), free as (
  select t.*, row_number() over (partition by created_at, observed_at order by id) rn
  from tagged t where not in_ledger and not boss_killer
), pairs as (
  select v.observed_at ts, v.zone, v.character victim, v.guild victim_guild,
         k.character killer, k.guild killer_guild, v.id vid, k.id kid
  from free v
  join free k on k.created_at = v.created_at and k.observed_at = v.observed_at
             and k.rn = v.rn + 1 and k.id = v.id + 1
  where v.rn % 2 = 1
), singles as (
  select f.observed_at ts, f.zone, f.character victim, f.guild victim_guild
  from free f
  where f.id not in (select vid from pairs union all select kid from pairs)
), rows_ as (
  select victim, victim_guild, killer, killer_guild, false as npc, pet_name, zone, killed_at as ts, 'backfill:pvp_kills' as src from ledger
  union all
  select victim, victim_guild, killer, killer_guild, killer_guild is null, null, zone, ts, 'backfill:relay_pair' from pairs
  union all
  select victim, victim_guild, null, null, true, null, zone, ts, 'backfill:relay_single' from singles
)
select distinct on (lower(victim), date_trunc('second', ts))
       'wolfpack', victim, victim_guild, killer, killer_guild, npc, pet_name, zone, ts, src, null,
       'wolfpack|' || lower(victim) || '|' || to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
from rows_
order by lower(victim), date_trunc('second', ts), src
on conflict (dedup_key) do nothing;

-- Fights: deaths in one zone grouped in two steps.
--   A WAVE is deaths each within p_wave_gap of the one before; it counts when it has 2+ deaths and at
--   least one is a player kill (so an NPC raid wipe is not a PvP fight).
--   A FIGHT joins waves in the same zone less than p_join_gap apart, and takes every death between
--   its first and last wave.
-- 3 minutes is where the gaps between player kills thin out; 20 minutes keeps one night's battle in
-- a few fights instead of nineteen pieces (measured on the Vex Thal night, DECISIONS §46).
-- "Zek" is the guild Zek or Rise of Zek, as the database's own Zek checks read it.
create or replace function public.pvp_fights(
  p_since    timestamptz default now() - interval '30 days',
  p_wave_gap interval    default interval '3 minutes',
  p_join_gap interval    default interval '20 minutes',
  p_limit    integer     default 20
)
returns table (
  zone            text,
  started_at      timestamptz,
  ended_at        timestamptz,
  waves           integer,
  deaths          integer,
  player_kills    integer,
  zek_deaths      integer,
  rest_deaths     integer,
  deaths_by_guild jsonb,
  top_killers     jsonb
)
language sql
stable
set search_path = public
as $$
  with d as (
    select p.zone, p.died_at, p.victim, coalesce(p.victim_guild, '') vg, p.killer, p.killer_guild,
           (p.killer is not null and not p.killer_is_npc) as pk
    from public.pvp_deaths p
    where p.guild_id = 'wolfpack' and p.died_at >= p_since and p.zone is not null
  ), d1 as (
    select d.*, case when d.died_at - lag(d.died_at) over (partition by d.zone order by d.died_at) <= p_wave_gap
                     then 0 else 1 end s
    from d
  ), d2 as (
    select d1.*, sum(d1.s) over (partition by d1.zone order by d1.died_at rows unbounded preceding) wave from d1
  ), w as (
    select d2.zone, d2.wave, min(d2.died_at) a, max(d2.died_at) b
    from d2 group by d2.zone, d2.wave
    having count(*) >= 2 and count(*) filter (where d2.pk) >= 1
  ), w1 as (
    select w.*, case when w.a - lag(w.b) over (partition by w.zone order by w.a) <= p_join_gap
                     then 0 else 1 end s
    from w
  ), w2 as (
    select w1.*, sum(w1.s) over (partition by w1.zone order by w1.a rows unbounded preceding) fight from w1
  ), f as (
    select w2.zone, w2.fight, min(w2.a) a, max(w2.b) b, count(*)::integer waves from w2 group by w2.zone, w2.fight
  ), fd as (
    select f.zone, f.fight, f.a, f.b, f.waves, x.victim, x.vg, x.killer, x.killer_guild, x.pk
    from f join d x on x.zone = f.zone and x.died_at between f.a and f.b
  )
  select fd.zone, fd.a, fd.b, fd.waves,
         count(*)::integer,
         count(*) filter (where fd.pk)::integer,
         count(*) filter (where fd.vg ~* '^(zek|rise of zek)$')::integer,
         count(*) filter (where fd.vg !~* '^(zek|rise of zek)$')::integer,
         (select jsonb_object_agg(g, n) from (
            select coalesce(nullif(y.vg, ''), '(no guild)') g, count(*) n
            from fd y where y.zone = fd.zone and y.fight = fd.fight group by 1) q),
         (select coalesce(jsonb_agg(jsonb_build_object('killer', k, 'guild', g, 'kills', n) order by n desc, k), '[]'::jsonb) from (
            select y.killer k, max(y.killer_guild) g, count(*) n
            from fd y where y.zone = fd.zone and y.fight = fd.fight and y.pk
            group by y.killer order by count(*) desc, y.killer limit 5) q)
  from fd
  group by fd.zone, fd.fight, fd.a, fd.b, fd.waves
  order by fd.a desc
  limit p_limit
$$;

grant execute on function public.pvp_fights(timestamptz, interval, interval, integer) to authenticated, service_role;
