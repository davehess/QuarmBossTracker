-- Lock down ari_state — the original migration granted SELECT to every
-- authenticated user (including the `password` column). The web app no
-- longer reads this table at all (the homepage banner was removed because
-- the password was rendered in plain text + the Discord deep-link buttons
-- triggered an Android app-launch permission prompt), so authenticated
-- access should be revoked entirely. The bot writes via service_role,
-- which bypasses RLS regardless.

drop policy if exists "ari_state read for authenticated" on public.ari_state;
revoke select on public.ari_state from authenticated;
revoke all    on public.ari_state from authenticated;
