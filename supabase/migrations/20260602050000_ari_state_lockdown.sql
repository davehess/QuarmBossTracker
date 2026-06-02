-- Lock down ari_state — the original migration granted SELECT to every
-- authenticated user. The web app no longer reads this table at all
-- (the homepage banner was removed; invites are coordinated in-game),
-- so authenticated access should be revoked entirely. The bot writes
-- via service_role, which bypasses RLS regardless.

drop policy if exists "ari_state read for authenticated" on public.ari_state;
revoke select on public.ari_state from authenticated;
revoke all    on public.ari_state from authenticated;
