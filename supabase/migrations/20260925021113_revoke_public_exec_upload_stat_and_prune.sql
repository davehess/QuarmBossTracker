-- Close two SECURITY DEFINER functions the public (anon) and member
-- (authenticated) keys could run — found by the privacy audit, 2026-09-25.
--
-- bump_agent_upload_stat: 20260901160000 added an 11-argument overload. A new
-- function takes Postgres's default PUBLIC EXECUTE, and the July lockdown
-- (20260718040000) revoked the two OLDER overloads by exact signature, so it
-- never covered this one. Anyone holding the public key (it ships in the
-- sign-in page) could write an arbitrary uploaded_by_discord_id for any
-- character — and the website's claim flow (web/app/me/claim-actions.ts)
-- trusts that column as proof "your agent uploaded it", which then opens the
-- character's owner-only inventory, spellbook and quest pages.
--
-- prune_opendkp_call_stats: anyone could delete the public counter history.
--
-- The bot is the only caller of both and uses the service role, which keeps
-- EXECUTE. opendkp_traffic_summary stays callable by anon on purpose (the
-- public /opendkp page, aggregates only). Idempotent.

revoke execute on function public.bump_agent_upload_stat(text, text, text, text, boolean, integer, text, jsonb, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.bump_agent_upload_stat(text, text, text, text, boolean, integer, text, jsonb, text, text, boolean)
  to service_role;

revoke execute on function public.prune_opendkp_call_stats(integer)
  from public, anon, authenticated;
grant execute on function public.prune_opendkp_call_stats(integer)
  to service_role;
