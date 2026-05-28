-- Web /character page and /parses/[id] now read class/race/rank from the
-- characters table (mirrored from OpenDKP) instead of who_observations.
-- service_role bypasses RLS, but explicit anon/authenticated read policies
-- keep the option of client-side reads open — none of these fields are
-- sensitive within the guild.

drop policy if exists characters_anon_read on characters;
create policy characters_anon_read on characters for select to anon using (true);

drop policy if exists characters_auth_read on characters;
create policy characters_auth_read on characters for select to authenticated using (true);

grant select on characters to anon, authenticated;
grant all    on characters to service_role;
