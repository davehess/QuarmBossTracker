-- Rank → self-main rule. Officers and Pack Leaders cannot be alts —
-- an alt cannot rank above Raid Pack. The trigger now stamps
-- main_name_override = name on any row whose rank is in that set, so a
-- stale OpenDKP ParentId (e.g. an officer who was someone's alt before
-- promotion) gets corrected automatically on the next sync upsert.
--
-- Replaces apply_main_name_override (still drops in place on the same
-- trigger; preserves the override-pins-main_name behaviour).

create or replace function public.apply_main_name_override()
returns trigger
language plpgsql
as $$
begin
  -- Rank rule: Officer / Pack Leader → own family root.
  if NEW.rank in ('Officer', 'Pack Leader') then
    NEW.main_name_override := NEW.name;
  end if;
  -- Override pins main_name. NULL override = OpenDKP's value passes
  -- through unchanged (default for everyone below Officer).
  if NEW.main_name_override is not null then
    NEW.main_name := NEW.main_name_override;
  end if;
  return NEW;
end
$$;
