-- Task #39 (Hitya's go-ahead 2026-08-16): dedupe the 337 groups / 560 excess
-- rows left by overlapping /backfillopendkploot runs, then pin award identity
-- in the schema so the class of bug cannot recur.
--
-- The award key is (guild_id, source, raid_id, item_id, winner_character,
-- dkp_amount). PARTIAL on raid_id IS NOT NULL, deliberately: chat_extracted /
-- loot_command rows are DROP observations (no raid, no winner, no dkp) and two
-- different nights' drops of the same item must not collide. NULLS NOT
-- DISTINCT (PG15+) covers the still-nullable winner/dkp columns inside the
-- raid-bound world, matching dedupByConflictKey's code-side semantics.

-- 1. Keep the deleted rows recoverable. Service-role-only; drop the table
--    after 2026-09-16 if nothing has needed it.
create table if not exists public.loot_observations_dedup_backup_20260816
  (like public.loot_observations);
alter table public.loot_observations_dedup_backup_20260816 enable row level security;

with ranked as (
  select id, row_number() over (
    partition by guild_id, source, raid_id, item_id, winner_character, dkp_amount
    order by id
  ) as rn
  from public.loot_observations
  where raid_id is not null
)
insert into public.loot_observations_dedup_backup_20260816
select lo.* from public.loot_observations lo
join ranked r on r.id = lo.id
where r.rn > 1;

-- 2. Delete the duplicates, keeping the earliest row per award (min id — the
--    same "one row kept per award" rule as the 2026-08-14 fold cleanup).
delete from public.loot_observations lo
using (
  select id, row_number() over (
    partition by guild_id, source, raid_id, item_id, winner_character, dkp_amount
    order by id
  ) as rn
  from public.loot_observations
  where raid_id is not null
) r
where lo.id = r.id and r.rn > 1;

-- 3. Award identity lives in the schema from here on.
create unique index if not exists loot_observations_award_uniq
  on public.loot_observations (guild_id, source, raid_id, item_id, winner_character, dkp_amount)
  nulls not distinct
  where raid_id is not null;
