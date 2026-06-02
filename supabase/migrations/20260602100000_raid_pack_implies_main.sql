-- Raid Pack rank also implies main. v2 of the apply_main_name_override
-- trigger — adds 'Raid Pack' to the SELF_MAIN ranks alongside Officer and
-- Pack Leader. Wolf Pack's terminology: Raid Pack = main, Raid Alt = alt.
-- An alt cannot rank Raid Pack or above, so any character at that rank is
-- by definition their own family root.
--
-- Replaces the v1 trigger function in-place (same name, same firing rules);
-- the migration is purely a function body update. The existing trigger
-- on characters keeps invoking it.

create or replace function public.apply_main_name_override()
returns trigger
language plpgsql
as $$
begin
  -- Rank rule: Raid Pack / Officer / Pack Leader → own family root.
  -- Stamps the override so the rewrite below pins main_name on every
  -- insert AND on every future sync upsert.
  if NEW.rank in ('Raid Pack', 'Officer', 'Pack Leader') then
    NEW.main_name_override := NEW.name;
  end if;
  -- Apply override (if any) to main_name. NULL override = OpenDKP's value
  -- passes through unchanged (the default for Raid Alt / Recruit / etc).
  if NEW.main_name_override is not null then
    NEW.main_name := NEW.main_name_override;
  end if;
  return NEW;
end
$$;

-- Backfill: trigger only fires on INSERT/UPDATE. Force a no-op UPDATE on
-- every Raid Pack row so the new rule retroactively snaps everyone into
-- self-rooted shape. Equivalent to "re-save every row" — the trigger does
-- the actual rewrite.
update characters
   set updated_at = now()
 where guild_id = 'wolfpack'
   and rank = 'Raid Pack'
   and not deleted;
