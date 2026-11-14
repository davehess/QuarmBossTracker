-- Invited password accounts carry their Discord id where only the server can write it (DECISIONS §579).
--
-- A member who cannot use Discord sign-in gets a password account from the claim flow (web/app/auth/claim). That
-- account has no Discord identity, so the site reads its Discord id from app_metadata.discord_id. The claim flow
-- stamps it on every account it creates or resets from web 2.1.139 on; this stamps the accounts made before that,
-- from the members row the claim flow tied them to (wolfpack_members.user_id).
--
-- Idempotent: re-running writes the same value. Touches only accounts with NO Discord identity.
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('discord_id', m.discord_id::text)
  from public.wolfpack_members m
 where m.user_id = u.id
   and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'discord')
   and m.discord_id::text ~ '^\d{5,25}$';
