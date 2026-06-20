-- Officer-set main/alt override.
--
-- The only automatic main_name source is OpenDKP ParentId, and DKP admins
-- routinely set rank "Raid Alt" without parenting the character (Adiwen had
-- rank Raid Alt but ParentId 0 → its own family, splitting one human into
-- two "players"/"agents" everywhere main_name drives family grouping). A
-- manual main_name edit doesn't survive: syncCharacters() re-upserts
-- main_name from OpenDKP on every cycle.
--
-- main_name_override is the durable officer intent: when set, the OpenDKP
-- sync writes main_name = override instead of the ParentId resolution, and
-- /admin/links sets BOTH columns so the fix is immediate. Clearing the
-- override lets the next sync restore OpenDKP's view.

alter table public.characters
  add column if not exists main_name_override text;

comment on column public.characters.main_name_override is
  'Officer-set family link from /admin/links. When non-null, the OpenDKP sync writes main_name from this instead of OpenDKP ParentId. Null = follow OpenDKP.';
