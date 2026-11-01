-- Ends a member's website sign-ins (the guild lead, 2026-11-01: a banned member's lock on /admin/access did not
-- end his web sessions; they had to be deleted by hand). Called by lockMember (web/app/admin/access/actions.ts)
-- through the service-role client. The Admin API's signOut needs the user's JWT, which an officer action does not
-- have, so this deletes the rows instead. Current GoTrue cascades auth.refresh_tokens from auth.sessions; the
-- second delete covers a project on an older schema where it does not (refresh_tokens.user_id is varchar).
-- Returns the number of sessions ended. Idempotent.
create or replace function public.end_member_web_sessions(p_user_id uuid)
returns int
language sql
security definer
set search_path = auth, public
as $$
  with d as (delete from auth.sessions where user_id = p_user_id returning 1),
       r as (delete from auth.refresh_tokens where user_id = p_user_id::text returning 1)
  select count(*)::int from d
$$;

revoke all on function public.end_member_web_sessions(uuid) from public, anon, authenticated;
grant execute on function public.end_member_web_sessions(uuid) to service_role;
