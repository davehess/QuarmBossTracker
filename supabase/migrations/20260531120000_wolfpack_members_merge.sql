-- Per-member household merge: declare that one Discord account is ALSO another
-- (same person, multiple Discord identities). When set, the merged account's
-- characters surface for the primary account on /me and anywhere that walks
-- "my household."
--
-- No data destruction: characters.discord_id stays as it was (the historical
-- link), the merge happens at the LOOKUP layer. Reversible — clear the column
-- to undo.
--
-- Self-pointing or cycles are prevented by the trigger below. Officer-only
-- mutation enforced at the server-action layer; RLS reads stay broad since
-- merge state isn't sensitive (it just affects what /me aggregates).

alter table public.wolfpack_members
    add column if not exists merged_into_discord_id text;

comment on column public.wolfpack_members.merged_into_discord_id is
    'When set, this Discord account is an ALIAS of the named primary discord_id (same person, multiple Discord identities). /me walks the household: primary + every account whose merged_into_discord_id points at the primary. Null = standalone account.';

create index if not exists idx_wolfpack_members_merged_into
    on public.wolfpack_members (merged_into_discord_id)
    where merged_into_discord_id is not null;

-- Prevent self-merge (a → a) and one-hop cycles (a → b, b → a). The web
-- server action also checks, but a DB-level guard is the safety net.
create or replace function public._wm_merge_validate() returns trigger as $$
begin
  if new.merged_into_discord_id is not null then
    if new.merged_into_discord_id = new.discord_id then
      raise exception 'merged_into_discord_id cannot equal own discord_id';
    end if;
    if exists (
      select 1 from public.wolfpack_members
      where discord_id = new.merged_into_discord_id
        and merged_into_discord_id = new.discord_id
    ) then
      raise exception 'merge would create a cycle with %', new.merged_into_discord_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists wm_merge_validate on public.wolfpack_members;
create trigger wm_merge_validate
  before insert or update of merged_into_discord_id on public.wolfpack_members
  for each row execute function public._wm_merge_validate();
