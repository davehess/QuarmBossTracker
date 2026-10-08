-- Per-fight threat graph, kept after the raw snapshots are gone.
--
-- The guild lead, 2026-09-22: "per fight, consolidate the threat data into a
-- flattened graph, married up with the player deaths from those fights. make
-- sure that the data isn't removed from the on-prem database then make
-- deletions from the table". Consolidate → confirm on-prem → delete: this is
-- the consolidate step. Nothing here deletes anything.
--
-- The graph already exists as a query: encounter_timeline(encounter, step) —
-- per 5 s bucket, per character, damage and damage-taken deltas, each
-- character's best uploader. It is computed from encounter_threat_snapshots
-- on every read, so it dies with them. This stores its output once per fight:
--
--   encounter_threat_graph.rows    [[t_sec, char_name, pet_owner, dmg_delta, took_delta], …]
--                                  in encounter_timeline's own order (t_sec, char_name)
--   encounter_threat_graph.deaths  each uploader's RAW death array from
--                                  contributions.raw_parse->'deaths' — exactly the
--                                  input of the canonical JS dedup
--                                  (utils/parseDeaths.js dedupParseDeaths, mirrored in
--                                  web/app/parses/[id]/page.tsx and web/lib/raidReview.ts).
--                                  Stored raw on purpose: the dedup rule lives in three
--                                  mirrored places already and must not gain a fourth in SQL.
--
-- encounter_timeline becomes a wrapper: the live computation whenever raw
-- snapshots exist (so its output is unchanged today), the stored graph only
-- when they do not. Its one caller, web/app/parses/[id]/page.tsx, reads it with
-- the service role and pages with .range(); the stored rows come back in the
-- same order.
--
-- RLS on with no policies, like encounter_threat_snapshots: service role only.
--
-- Idempotent. Applied 2026-09-23 via execute_sql; this file is the record.

create table if not exists public.encounter_threat_graph (
  encounter_id uuid primary key references public.encounters(id) on delete cascade,
  guild_id     text not null default 'wolfpack',
  npc_name     text,
  started_at   timestamptz,
  ended_at     timestamptz,
  step_sec     int  not null default 5,
  rows         jsonb not null default '[]'::jsonb,
  deaths       jsonb not null default '[]'::jsonb,
  row_count    int  not null default 0,
  built_at     timestamptz not null default now()
);
alter table public.encounter_threat_graph enable row level security;
create index if not exists encounter_threat_graph_started_idx
  on public.encounter_threat_graph (started_at);

-- The live computation, byte-for-byte the body encounter_timeline had in
-- production on 2026-09-23 (including the later baseline fix).
create or replace function public.encounter_timeline_live(p_encounter_id uuid, p_step_sec integer default 5)
 returns table(t_sec integer, char_name text, pet_owner text, dmg_delta bigint, took_delta bigint)
 language sql
 stable
 set search_path to 'public'
as $function$
  with enc as (
    select e.id, e.started_at, e.ended_at,
           public.npc_display_name(n.name) as npc_name
    from public.encounters e
    join public.eqemu_npc_types n on n.id = e.npc_id
    where e.id = p_encounter_id
  ),
  snaps as (
    select s.uploader, s.snapshot_at,
           greatest(0, floor(extract(epoch from (s.snapshot_at - enc.started_at))
                             / greatest(p_step_sec,1))::int) as bucket,
           kv.key as char_name,
           nullif(kv.value->>'pet_owner','')          as pet_owner,
           coalesce((kv.value->>'dmg')::bigint , 0)   as dmg_cum,
           coalesce((kv.value->>'took')::bigint, 0)   as took_cum
    from enc
    join public.encounter_threat_snapshots s
      on lower(s.boss_name) = lower(enc.npc_name)
     and s.snapshot_at >= enc.started_at - interval '2 minutes'
     and s.snapshot_at <= coalesce(enc.ended_at, enc.started_at + interval '2 hours')
                          + interval '2 minutes'
    cross join lateral jsonb_each(s.per_player) kv
  ),
  best_dmg as (
    select distinct on (char_name) char_name, uploader
    from (select uploader, char_name, max(dmg_cum) f from snaps group by 1,2) x
    order by char_name, f desc, uploader
  ),
  best_took as (
    select distinct on (char_name) char_name, uploader
    from (select uploader, char_name, max(took_cum) f from snaps group by 1,2) x
    order by char_name, f desc, uploader
  ),
  -- The FIRST sample in the window is a baseline, never a delta.
  --
  -- Counting it (coalesce(lag,0)) charges the whole cumulative counter to bucket
  -- zero. Harmless for an uploader who began at this fight — their first value
  -- is ~0 — but catastrophic for one whose counters carry an EARLIER pull of the
  -- same boss. Kaas Thox Xi Aten Ha Ra was fought repeatedly across two hours
  -- and one uploader's series began 52 minutes before this encounter; that alone
  -- put the reconstruction at 311% of the parse's own total. `lag IS NULL -> 0`
  -- discards the baseline sample, which costs nothing when it really is zero.
  d_dmg_raw as (
    select s.bucket, s.char_name, s.pet_owner,
           case when lag(s.dmg_cum) over w is null then 0
                else greatest(0, s.dmg_cum - lag(s.dmg_cum) over w) end as d
    from snaps s join best_dmg b using (char_name, uploader)
    window w as (partition by s.char_name order by s.snapshot_at)
  ),
  d_took_raw as (
    select s.bucket, s.char_name,
           case when lag(s.took_cum) over w is null then 0
                else greatest(0, s.took_cum - lag(s.took_cum) over w) end as d
    from snaps s join best_took b using (char_name, uploader)
    window w as (partition by s.char_name order by s.snapshot_at)
  ),
  d_dmg as (
    select bucket, char_name, max(pet_owner) as pet_owner, sum(d) as dmg_delta
    from d_dmg_raw group by bucket, char_name
  ),
  d_took as (
    select bucket, char_name, sum(d) as took_delta
    from d_took_raw group by bucket, char_name
  )
  select (coalesce(a.bucket, t.bucket) * p_step_sec)::int as t_sec,
         coalesce(a.char_name, t.char_name)               as char_name,
         a.pet_owner,
         coalesce(a.dmg_delta, 0)::bigint                 as dmg_delta,
         coalesce(t.took_delta, 0)::bigint                as took_delta
  from d_dmg a
  full join d_took t on t.bucket = a.bucket and t.char_name = a.char_name
  where coalesce(a.dmg_delta,0) > 0 or coalesce(t.took_delta,0) > 0
  order by 1, 2;
$function$;

-- Live while the raw snapshots exist; the stored graph once they do not.
create or replace function public.encounter_timeline(p_encounter_id uuid, p_step_sec integer default 5)
 returns table(t_sec integer, char_name text, pet_owner text, dmg_delta bigint, took_delta bigint)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  return query select * from public.encounter_timeline_live(p_encounter_id, p_step_sec);
  if found then return; end if;
  return query
    select (x.r->>0)::int,
           x.r->>1,
           nullif(x.r->>2, ''),
           (x.r->>3)::bigint,
           (x.r->>4)::bigint
      from public.encounter_threat_graph g
      cross join lateral jsonb_array_elements(g.rows) with ordinality as x(r, n)
     where g.encounter_id = p_encounter_id and g.step_sec = p_step_sec
     order by x.n;
end;
$function$;

-- Build the stored graph for settled fights that lack one, oldest first.
-- `p_settle` gives late uploads time to land before a graph is frozen. A fight
-- with no snapshots still gets a row (rows = []), so it is never retried.
create or replace function public.build_encounter_threat_graphs(p_limit integer default 200,
                                                                p_settle interval default '1 day')
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  e record;
  v_rows jsonb;
  v_built integer := 0;
begin
  for e in
    select en.id, coalesce(en.guild_id, 'wolfpack') as guild_id, en.started_at, en.ended_at,
           public.npc_display_name(n.name) as npc_name
      from public.encounters en
      left join public.eqemu_npc_types n on n.id = en.npc_id
     where en.started_at is not null
       and en.started_at < now() - p_settle
       and not exists (select 1 from public.encounter_threat_graph g where g.encounter_id = en.id)
     order by en.started_at
     limit greatest(p_limit, 0)
  loop
    select coalesce(jsonb_agg(jsonb_build_array(t.t_sec, t.char_name, t.pet_owner, t.dmg_delta, t.took_delta)
                              order by t.t_sec, t.char_name), '[]'::jsonb)
      into v_rows
      from public.encounter_timeline_live(e.id, 5) t;

    insert into public.encounter_threat_graph
           (encounter_id, guild_id, npc_name, started_at, ended_at, step_sec, rows, deaths, row_count)
    values (e.id, e.guild_id, e.npc_name, e.started_at, e.ended_at, 5, v_rows,
            coalesce((select jsonb_agg(c.raw_parse->'deaths' order by c.id)
                        from public.contributions c
                       where c.encounter_id = e.id
                         and jsonb_typeof(c.raw_parse->'deaths') = 'array'
                         and jsonb_array_length(c.raw_parse->'deaths') > 0), '[]'::jsonb),
            jsonb_array_length(v_rows))
    on conflict (encounter_id) do nothing;
    v_built := v_built + 1;
  end loop;
  return v_built;
end;
$function$;

-- Every raw snapshot BEFORE this time belongs to a fight whose graph is stored.
-- It is the start of the oldest settled fight still lacking a graph, minus the
-- 2-minute lead encounter_timeline reads before a fight's start (5 for margin);
-- with none outstanding, the settle horizon. The sweep and the thinning must
-- never delete at or after it.
create or replace function public.threat_graph_built_through(p_settle interval default '1 day')
 returns timestamptz
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select min(en.started_at)
       from public.encounters en
      where en.started_at is not null
        and en.started_at < now() - p_settle
        and not exists (select 1 from public.encounter_threat_graph g where g.encounter_id = en.id)),
    now() - p_settle) - interval '5 minutes';
$function$;

-- The builder writes; only the service role (the bot) may call it.
revoke execute on function public.build_encounter_threat_graphs(integer, interval) from public, anon, authenticated;
revoke execute on function public.threat_graph_built_through(interval) from public, anon, authenticated;
