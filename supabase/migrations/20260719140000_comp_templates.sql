-- #93 — raid composition templates (officer-authored archetype-group targets).
--
-- Follows the overlay_tuning pattern exactly: ONE row per guild, a single jsonb
-- blob, officer writes via /admin/comp (Next.js server action with service_role),
-- authenticated members read. Nothing else in the schema fit — overlay_tuning is
-- overlay-specific and bot_kv is service-role-only bot cursor state — so this is
-- the "new table only if nothing fits" case for the shared settings mechanism.
--
-- `templates` is a jsonb ARRAY of CompTemplate objects (see web/lib/comp.ts):
--   { name, groups: [{ name, requires: [{ class|archetype, count }] }], minimums? }
-- Validation lives in web/lib/comp.ts (validateTemplate) — the store is dumb on
-- purpose; the editor rejects malformed JSON before it ever lands here. The
-- planned-vs-actual matcher on /admin/signups reads a template by name and diffs
-- it against RaidHelper signups (planned) and, when a raid_roster snapshot exists
-- in the event window, the live roster (actual).

create table if not exists public.comp_templates (
  guild_id              text primary key,
  templates             jsonb not null default '[]'::jsonb,
  updated_by_discord_id text,
  updated_by_name       text,
  updated_at            timestamptz not null default now()
);

-- Seed Wolf Pack's row. Idempotent — re-running never resets officer templates.
insert into public.comp_templates (guild_id)
values ('wolfpack')
on conflict (guild_id) do nothing;

alter table public.comp_templates enable row level security;

-- Signed-in members may read (the /admin/comp editor is officer-gated at the
-- route level; the matcher surfaces on the officer /admin/signups page). Writes
-- go through service_role only — no INSERT/UPDATE policy for authenticated.
drop policy if exists "comp_templates read" on public.comp_templates;
create policy "comp_templates read" on public.comp_templates
  for select to authenticated using (true);
