-- chat_attribution_conflicts — surface stray-log speaker misattributions.
-- A "collision" is the same in-game line (channel + ts + normalized text) stored
-- under >1 speaker. The non-roster speaker is the ghost (an old/foreign
-- eqlog_<Name> the uploader's agent is tailing); the roster speaker on the same
-- line is the real one. Returns one row per (ghost, uploader) with the inferred
-- real name + line count, so officers can tell that uploader to remove the
-- stray log. (Uilnayar 2026-06-23: Wabumkin→Dopefiend, Chadivarius→Ashaiya.)
create or replace function chat_attribution_conflicts(p_days int default 7)
returns table(ghost_speaker text, uploader_discord_id text, likely_real text, lines int, last_line timestamptz)
language sql stable as $$
  with norm as (
    select channel, ts,
           lower(regexp_replace(text, '\s+', ' ', 'g')) as nt,
           speaker, uploaded_by,
           exists(select 1 from characters c
                  where c.guild_id = 'wolfpack' and lower(c.name) = lower(cm.speaker)) as is_roster
    from chat_messages cm
    where channel in ('guild','raid')
      and ts >= now() - make_interval(days => p_days)
      and uploaded_by is not null
  ),
  collisions as (
    select channel, ts, nt
    from norm
    group by channel, ts, nt
    having count(distinct speaker) > 1
  ),
  ghosts as (
    select n.speaker as ghost, n.uploaded_by as uploader, n.channel, n.ts, n.nt
    from norm n
    join collisions c using (channel, ts, nt)
    where n.is_roster = false
  ),
  reals as (
    select distinct on (channel, ts, nt) channel, ts, nt, speaker as real_speaker
    from norm
    where is_roster = true
    order by channel, ts, nt, speaker
  )
  select g.ghost                       as ghost_speaker,
         g.uploader                    as uploader_discord_id,
         max(r.real_speaker)           as likely_real,
         count(*)::int                 as lines,
         max(g.ts)                     as last_line
  from ghosts g
  left join reals r using (channel, ts, nt)
  group by g.ghost, g.uploader
  having max(r.real_speaker) is not null
  order by count(*) desc;
$$;

grant execute on function chat_attribution_conflicts(int) to service_role;
