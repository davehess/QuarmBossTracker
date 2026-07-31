-- Parser tokens for members Discord blocks from OAuth (phone/email
-- verification wall). Such a member has no auth.users row — they can never
-- complete the wolfpack.quest sign-in that populates wolfpack_members.user_id
-- — so their mimic_session carries discord_id only. All session consumers
-- (list/revoke, requireAgentAuth, roster/character links) key on discord_id;
-- user_id is only the web-account join and may now be absent.
ALTER TABLE mimic_sessions ALTER COLUMN user_id DROP NOT NULL;
