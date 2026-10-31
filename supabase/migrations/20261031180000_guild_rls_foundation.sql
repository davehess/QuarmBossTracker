-- 20261031180000_guild_rls_foundation.sql
--
-- The foundation of per-request guild scoping (docs/DESIGN-raidmimic-hosted.md section 3 steps 5 and 6, and section 9b:
-- "the bot never uses service_role for guild data"). The bot mints a short-lived JWT per request, signed with the
-- project's JWT secret, carrying `role: guild_scoped` and a `guild_id` claim. PostgREST switches to that role for the
-- request, and the policies below let it see and write only its own guild's rows. A call that forgets its guild filter then
-- returns nothing instead of everything.
--
-- ADDITIVE and OFF BY DEFAULT. Nothing here changes what today's bot sees:
--   - The service role bypasses RLS, so every existing call is untouched.
--   - The new policies are `to guild_scoped` only. The existing `authenticated` read policies are not edited.
--   - The bot sends a scoped token only when GUILD_RLS=1 (or the tuning flag flag_guild_rls) is on AND a JWT secret is set.
--
-- Template tables, and only these three: encounters, encounter_players, contributions. Each already carries
-- `guild_id text not null default 'wolfpack'` (20261028170000), so every policy is a direct column test. The two RPCs on
-- this path (find_or_create_encounter, merge_encounter_players) are SECURITY DEFINER and stay on the service role in the
-- bot for now; they are not touched here.
--
-- Triggers on the three tables are SECURITY DEFINER (the bump and tombstone functions) except encounters_touch_updated_at,
-- which only sets NEW.updated_at, so the scoped role needs no grant on any table beyond the three.
--
-- The role: `guild_scoped` is NOLOGIN. PostgREST reaches it through `authenticator`, which must be a member of it, so the
-- file grants the role to `authenticator` (Supabase's standard connection role). Guarded: on a database with no
-- `authenticator` (a self-host without PostgREST) the grant is skipped.
--
-- Idempotent: safe to run twice. Nothing is dropped.

-- 1. The role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'guild_scoped') then
    create role guild_scoped nologin;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator')
     and not pg_has_role('authenticator', 'guild_scoped', 'member') then
    grant guild_scoped to authenticator;
  end if;
end
$$;

-- 2. The claim reader. Stable and SECURITY INVOKER: it reads the request's own settings and nothing else. PostgREST puts
--    the verified claims in `request.jwt.claims` (a JSON string); older versions set one GUC per claim, so the second
--    spelling is the fallback. No claim, or an empty one, is NULL, and `guild_id = NULL` matches no row.
create or replace function public.app_guild_id()
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'guild_id', ''),
    nullif(current_setting('request.jwt.claim.guild_id', true), '')
  )
$$;

-- 3. Grants: the three tables, and the claim reader. No other table is reachable by this role.
grant usage on schema public to guild_scoped;
grant execute on function public.app_guild_id() to guild_scoped;
grant select, insert, update, delete on public.encounters         to guild_scoped;
grant select, insert, update, delete on public.encounter_players  to guild_scoped;
grant select, insert, update, delete on public.contributions      to guild_scoped;

-- 4. The policies: four per table, each guarded so a re-run adds nothing. RLS is already enabled on all three
--    (it is, in production, with an `authenticated` read policy); `enable row level security` is repeated so a fresh
--    database gets it too.
do $$
declare
  t text;
  c text;
  pol text;
begin
  foreach t in array array['encounters', 'encounter_players', 'contributions'] loop
    execute format('alter table public.%I enable row level security', t);
    foreach c in array array['select', 'insert', 'update', 'delete'] loop
      pol := t || '_guild_scoped_' || c;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = pol) then
        if c = 'insert' then
          execute format('create policy %I on public.%I for insert to guild_scoped with check (guild_id = public.app_guild_id())', pol, t);
        elsif c = 'update' then
          execute format('create policy %I on public.%I for update to guild_scoped using (guild_id = public.app_guild_id()) with check (guild_id = public.app_guild_id())', pol, t);
        else
          execute format('create policy %I on public.%I for %s to guild_scoped using (guild_id = public.app_guild_id())', pol, t, c);
        end if;
      end if;
    end loop;
  end loop;
end
$$;

comment on function public.app_guild_id() is
  'The guild_id claim of the request''s JWT (role guild_scoped), or NULL. The RLS policies on encounters, encounter_players and contributions compare guild_id to it. See docs/DESIGN-raidmimic-hosted.md section 9b.';
