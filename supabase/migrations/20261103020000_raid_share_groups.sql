-- A public raid share link can carry a CHOSEN SET of the raids recorded in its window (the guild lead, 2026-11-03:
-- "i'm trying to link externally to [another guild] to share their raid, and NOT our raid" and "the selection should be
-- multi-select"). One recorded window can hold several raids at once (web/lib/sessionGroups.ts), and a leader hand-off
-- can split one guild's raid into several groups, so the link stores the group ids the officer picked.
--
-- NULL = the whole window, exactly as every existing link behaves. Otherwise 1 to 12 ids in the shape the review's
-- `group` parameter already accepts. The share routes narrow everything they return to the union of those groups.
-- Idempotent. RLS on raid_shares is unchanged (service role only).
alter table public.raid_shares add column if not exists group_ids text[];

do $$ begin
  alter table public.raid_shares add constraint raid_shares_group_ids_ok check (
    group_ids is null
    or (cardinality(group_ids) between 1 and 12
        and array_to_string(group_ids, ',') ~ '^[a-z0-9-]{3,40}(,[a-z0-9-]{3,40})*$')
  );
exception when duplicate_object then null; end $$;
