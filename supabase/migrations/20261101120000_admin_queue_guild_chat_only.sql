-- /admin review queue: chat speakers are judged on GUILD chat only (the guild lead, 2026-11-01:
-- "many of the users here are observed not being in our guild and don't need to be here").
-- /rs (raid say) carries other guilds' raiders standing in the same zone, so a speaker who only ever
-- spoke in /rs says nothing about our membership. Same signature, same jsonb shape as
-- 20261004140400_cap_safe_admin.sql; only the channel filter narrows. The page then keeps just the
-- speakers that pass the membership predicate (web/lib/adminQueueData.ts, computeGuildMembers).
create or replace function public.admin_queue_chat_speakers(p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('speaker', s.speaker, 'n', s.n, 'last', s.last_ts)
                            order by s.speaker), '[]'::jsonb)
  from (
    select c.speaker, count(*) as n, max(c.ts) as last_ts
    from chat_messages c
    where c.channel = 'guild'
      and c.ts > p_since
    group by c.speaker
  ) s;
$$;

comment on function public.admin_queue_chat_speakers(timestamptz) is
  'Guild-channel (/gu) chat newer than p_since as one jsonb array of {speaker, n, last}, one entry per exact speaker. /rs is left out: it carries other guilds. A jsonb scalar, so PostgREST''s 1,000-row cap does not apply. Feeds the /admin review queue.';
