-- Two-guild read-policy check for 20261110120000_guild_scoped_reads.sql.
-- This file has NO begin/rollback of its own, so it can be pasted between yours. Dry run, one transaction:
--   begin; <migration file>; <this file>; rollback;
-- Run as a privileged role (postgres). Any failed assertion raises, so the script errors instead of finishing.
--
-- Assumptions:
--   * the migration is applied (is_member_of / home_guild_id exist);
--   * the role running the script can insert into auth.users / auth.identities and bypasses RLS (postgres);
--   * the tables below have no extra NOT NULL columns beyond those filled here (measured 2026-11-10:
--     encounters needs npc_id (FK eqemu_npc_types) + started_at; who_observations character + observed_at;
--     characters name; character_live_state character; chat_messages ts, channel, speaker, text; guild_id defaults
--     to 'wolfpack' everywhere, so test rows set it explicitly). A BEFORE INSERT trigger or a unique key not
--     listed here will surface as an error: adjust the fixture, not the assertions.
--   * all fixtures are synthetic: a fake wolfpack_members login and a fake hub-guild login, so no real member is read.

-- Fixtures: two logins, one hub guild, one hub membership.
insert into auth.users (id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'zz-wolf@example.invalid'),
       ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'zz-test@example.invalid');

insert into auth.identities (id, user_id, provider, provider_id, identity_data)
values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', 'discord', 'zz-discord-wolf', '{"provider_id":"zz-discord-wolf"}'),
       (gen_random_uuid(), '00000000-0000-4000-8000-0000000000b2', 'discord', 'zz-discord-test', '{"provider_id":"zz-discord-test"}');

insert into public.wolfpack_members (discord_id, user_id, is_member)
values ('zz-discord-wolf', '00000000-0000-4000-8000-0000000000a1', true);

insert into public.hub_guilds (guild_id, display_name) values ('zz-test', 'ZZ Test Guild');
insert into public.hub_players (player_id, discord_id)
values ('00000000-0000-4000-8000-0000000000c3', 'zz-discord-test');
insert into public.hub_memberships (guild_id, player_id) values ('zz-test', '00000000-0000-4000-8000-0000000000c3');

-- One row per representative table, per guild.
insert into public.encounters (npc_id, started_at, guild_id)
values ((select id from public.eqemu_npc_types limit 1), now(), 'zz-test'),
       ((select id from public.eqemu_npc_types limit 1), now(), 'wolfpack');
insert into public.who_observations (character, observed_at, guild_id)
values ('ZzTestWho', now(), 'zz-test'), ('ZzWolfWho', now(), 'wolfpack');
insert into public.characters (name, guild_id)
values ('ZzTestChar', 'zz-test'), ('ZzWolfChar', 'wolfpack');
insert into public.character_live_state (character, guild_id)
values ('ZzTestLive', 'zz-test'), ('ZzWolfLive', 'wolfpack');
insert into public.chat_messages (ts, channel, speaker, text, guild_id)
values (now(), 'gu', 'ZzTest', 'zz-test row', 'zz-test'), (now(), 'gu', 'ZzWolf', 'zz-wolf row', 'wolfpack');

-- Helper: count what the current session can see, split by guild.
create or replace function pg_temp.seen(p_guild text) returns int language plpgsql as $$
declare n int := 0; c int;
begin
  select count(*) into c from public.encounters where guild_id = p_guild and started_at > now() - interval '1 minute'; n := n + c;
  select count(*) into c from public.who_observations where guild_id = p_guild and character like 'Zz%'; n := n + c;
  select count(*) into c from public.characters where guild_id = p_guild and name like 'Zz%'; n := n + c;
  select count(*) into c from public.character_live_state where guild_id = p_guild and character like 'Zz%'; n := n + c;
  select count(*) into c from public.chat_messages where guild_id = p_guild and speaker like 'Zz%'; n := n + c;
  return n;
end $$;
grant execute on function pg_temp.seen(text) to public;

-- 1. A Wolf Pack member: sees all five wolfpack rows, none from zz-test.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
do $$
begin
  if pg_temp.seen('zz-test') <> 0 then raise exception 'FAIL: wolfpack member sees % zz-test rows', pg_temp.seen('zz-test'); end if;
  if pg_temp.seen('wolfpack') < 5 then raise exception 'FAIL: wolfpack member sees only % of 5 wolfpack rows', pg_temp.seen('wolfpack'); end if;
  if not public.is_guild_member() then raise exception 'FAIL: is_guild_member() false for a wolfpack member'; end if;
  if public.is_member_of('zz-test') then raise exception 'FAIL: wolfpack member is a member of zz-test'; end if;
end $$;
reset role;

-- 2. The zz-test member: sees its five rows, none of wolfpack's, and is not a Wolf Pack member.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$
begin
  if pg_temp.seen('zz-test') <> 5 then raise exception 'FAIL: zz-test member sees % of 5 own rows', pg_temp.seen('zz-test'); end if;
  if pg_temp.seen('wolfpack') <> 0 then raise exception 'FAIL: zz-test member sees % wolfpack rows', pg_temp.seen('wolfpack'); end if;
  if public.is_guild_member() then raise exception 'FAIL: is_guild_member() true for a hub-only login'; end if;
end $$;
reset role;

-- 3. Leaving / suspension / deletion end access.
update public.hub_memberships set left_at = now() where guild_id = 'zz-test';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$ begin
  if public.is_member_of('zz-test') then raise exception 'FAIL: left member still a member'; end if;
end $$;
reset role;
update public.hub_memberships set left_at = null where guild_id = 'zz-test';
update public.hub_guilds set suspended_at = now() where guild_id = 'zz-test';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
do $$ begin
  if public.is_member_of('zz-test') then raise exception 'FAIL: member of a suspended guild still a member'; end if;
end $$;
reset role;

-- 4. Signed out: anon cannot call my_guild_ids or is_member_of.
set local role anon;
do $$
begin
  begin
    perform public.is_member_of('wolfpack');
    raise exception 'FAIL: anon can execute is_member_of';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.my_guild_ids();
    raise exception 'FAIL: anon can execute my_guild_ids';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'two_guild_rls: all assertions passed' as result;
