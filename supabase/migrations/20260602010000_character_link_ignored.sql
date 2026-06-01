-- Officer "dismiss erroneous match" control for the Character → Discord links
-- admin tool (/admin/links).
--
-- Some characters that surface in the link-matching workflow are never going
-- to resolve to a guild Discord user — a mis-imported name, a one-off pug we
-- caught in a /who, a duplicate, or a character an officer has decided simply
-- should not be matched. Those would otherwise sit in the "needs review" list
-- forever and keep showing up as auto-match candidates.
--
-- `link_ignored` lets an officer dismiss such a character: it drops out of the
-- review/auto-match lists entirely and is parked in an "Ignored" view where it
-- can be restored. This is an ADMIN decision about the linking tool only — it
-- is distinct from the member-facing `exclude_from_stats` / `exclude_inventory`
-- opt-outs, and does NOT touch the character's discord_id, stats, or uploads.

alter table public.characters
    add column if not exists link_ignored boolean not null default false;

comment on column public.characters.link_ignored is
    'Officer dismissal for the /admin/links matching tool: when true, hide this character from the link review list and skip it in auto-matching. Distinct from exclude_from_stats; does not affect discord_id or data collection.';
