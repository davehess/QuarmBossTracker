-- Tell notifications: enable Realtime on the tells table + a per-character
-- Discord-DM toggle.
--
-- Two independent delivery channels for an incoming tell, each toggleable:
--   1. Discord DM  — controlled per-character by characters.tell_dm (default on).
--      The bot checks this before calling _relayTellsToDM.
--   2. Browser notification — device-local (localStorage on /me/tells), powered
--      by a Supabase Realtime subscription on tells filtered to the owner.
--      Realtime respects the same RLS as plain reads (tells read own only), so
--      a subscriber only ever receives their own rows.
--
-- Collection is still gated by characters.tell_relay (default off) — these two
-- toggles only decide HOW you're notified once a tell is already being relayed.

-- 1) Per-character DM toggle. Defaults on so opting into tell_relay gives you
--    DMs out of the box; flip off to keep the row + browser notif but silence
--    the Discord ping (e.g. a noisy alt).
alter table public.characters
    add column if not exists tell_dm boolean not null default true;

comment on column public.characters.tell_dm is
    'When tell_relay is on, also DM the owner on Discord for incoming tells to this character. Default true. Independent of browser notifications (those are device-local).';

-- 2) Enable Realtime for tells so /me/tells can subscribe to live INSERTs.
--    RLS still applies to realtime payloads, so each client only sees its own.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'tells'
  ) then
    execute 'alter publication supabase_realtime add table public.tells';
  end if;
end $$;
