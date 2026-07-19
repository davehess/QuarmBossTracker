-- #82 Quartermaster v1 — seed ONE real quest chain into the EXISTING officer-
-- authored quest catalog (quest_catalog + quest_required_item, migration
-- 20260624010000). Quartermaster Board 2 reuses that store — no new table — so
-- this seed is pure DATA, idempotent, and officers edit it via /admin/quests.
--
-- Chain: the Emperor Ssraeshza key (Ssraeshza Temple / Luclin, era-correct). The
-- required components are the four "Quarter of a Diaku Emblem" pieces, which
-- combine into the "Completed Diaku Emblem". Every item id below was VERIFIED to
-- exist in the live eqemu_items mirror before seeding:
--   29216/29217/29218/29219 = Quarter of a Diaku Emblem (four distinct ids, same
--                             name — item_id is what tells the pieces apart, the
--                             same pattern the seeded VT key uses for its 10
--                             "A Lucid Shard" ids)
--   29215                    = Completed Diaku Emblem (the assembled key / reward)
-- Detection is against a character's VISIBLE inventory (character_inventory; bank
-- is stripped before upload), so a piece already turned in / kept in the bank
-- reads as "not seen", not "never had". Officers extend/correct the recipe in
-- /admin/quests — the store is the source of truth, this is just a starting point.

do $$
declare
  qid bigint;
begin
  -- Idempotent: only seed if this quest isn't already present for the guild.
  if not exists (
    select 1 from quest_catalog
    where guild_id = 'wolfpack' and name = 'Emperor Ssraeshza key (Diaku Emblem)'
  ) then
    insert into quest_catalog
      (guild_id, name, category, zone, notes, display_order, active,
       reward_item_id, reward_item_name)
    values
      ('wolfpack', 'Emperor Ssraeshza key (Diaku Emblem)', 'key', 'Ssraeshza Temple',
       'Seeded from the verified Diaku Emblem catalog items. Officers: confirm/extend the full turn-in recipe here.',
       20, true, 29215, 'Completed Diaku Emblem')
    returning id into qid;

    insert into quest_required_item (quest_id, item_id, item_name, quantity, optional, display_order, notes)
    values
      (qid, 29216, 'Quarter of a Diaku Emblem', 1, false, 10, 'piece 1 of 4'),
      (qid, 29217, 'Quarter of a Diaku Emblem', 1, false, 20, 'piece 2 of 4'),
      (qid, 29218, 'Quarter of a Diaku Emblem', 1, false, 30, 'piece 3 of 4'),
      (qid, 29219, 'Quarter of a Diaku Emblem', 1, false, 40, 'piece 4 of 4'),
      (qid, 29215, 'Completed Diaku Emblem',    1, false, 50, 'the assembled key');
  end if;
end $$;
