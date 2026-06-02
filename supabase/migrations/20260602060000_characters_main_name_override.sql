-- characters.main_name_override — survives OpenDKP roster sync.
--
-- syncCharacters() upserts characters.main_name from OpenDKP's ParentId
-- on every interval (≤30 min). Manually rewriting main_name to a value
-- OpenDKP doesn't agree with (e.g. re-parenting Lith / Dantare under
-- Dant when OpenDKP still says Lith is the root) would get reverted on
-- the next sync.
--
-- Instead: store the intended truth in main_name_override. A BEFORE
-- INSERT / UPDATE trigger replaces NEW.main_name with the override if
-- one is set. The sync stays untouched — every consumer reads
-- main_name and gets the right answer with no COALESCE plumbing.
--
-- NULL override = no opinion, OpenDKP's value passes through unchanged
-- (the default for every row).

alter table public.characters
  add column if not exists main_name_override text;

comment on column public.characters.main_name_override is
  'Manual family-root override that survives OpenDKP roster sync. When non-null, the apply_main_name_override trigger replaces main_name with this value on every INSERT/UPDATE — so sync upserts can never clobber a deliberate re-parenting decision (e.g. moving a player who renamed their main).';

create or replace function public.apply_main_name_override()
returns trigger
language plpgsql
as $$
begin
  if NEW.main_name_override is not null then
    NEW.main_name := NEW.main_name_override;
  end if;
  return NEW;
end
$$;

drop trigger if exists trg_apply_main_name_override on public.characters;
create trigger trg_apply_main_name_override
  before insert or update on public.characters
  for each row
  execute function public.apply_main_name_override();
