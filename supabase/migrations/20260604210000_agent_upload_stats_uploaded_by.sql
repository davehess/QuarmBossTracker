-- Record WHO (which Discord user, via their per-user session token) uploaded
-- each character's stream, so the admin agent board can asterisk uploads done
-- by someone other than the character's owner — e.g. a member logging in as a
-- spouse's / friend's toon to fill a class. The upload is still valid; the
-- asterisk just flags "not the owner driving this".
alter table public.agent_upload_stats
  add column if not exists uploaded_by_discord_id text;

create or replace function public.bump_agent_upload_stat(
  p_guild text, p_character text, p_endpoint text, p_version text,
  p_ok boolean, p_status integer, p_error text, p_agent_state jsonb,
  p_uploaded_by text default null
) returns void
  language sql security definer set search_path to 'public'
as $function$
  insert into public.agent_upload_stats as s
    (guild_id, character, endpoint, upload_count, error_count,
     first_uploaded_at, last_uploaded_at, agent_version, last_ok, last_status_code,
     last_error, last_agent_state, uploaded_by_discord_id)
  values
    (coalesce(p_guild,'wolfpack'), coalesce(nullif(p_character,''),'(unknown)'), p_endpoint,
     1, case when p_ok then 0 else 1 end, now(), now(), p_version, p_ok, p_status,
     p_error, p_agent_state, p_uploaded_by)
  on conflict (guild_id, character, endpoint) do update set
    upload_count     = s.upload_count + 1,
    error_count      = s.error_count + case when p_ok then 0 else 1 end,
    last_uploaded_at = now(),
    agent_version    = coalesce(p_version, s.agent_version),
    last_ok          = p_ok,
    last_status_code = p_status,
    last_error       = case when p_ok then s.last_error else p_error end,
    last_agent_state = coalesce(p_agent_state, s.last_agent_state),
    uploaded_by_discord_id = coalesce(p_uploaded_by, s.uploaded_by_discord_id);
$function$;
