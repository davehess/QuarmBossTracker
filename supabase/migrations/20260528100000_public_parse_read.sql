-- Grant anon + authenticated read access to encounter data so the public
-- wolfpack.quest/parses page can display kill history without requiring
-- auth. DPS/damage stats are not sensitive; strat_notes in bosses_local
-- are excluded via column-level grants.

-- bosses_local — expose name, emoji, expansion, not strat_notes
grant select (npc_id, internal_id, nicknames, emoji, timer_hours_override,
              expansion_label, path_notes, added_at)
  on public.bosses_local to anon, authenticated;
create policy "bosses_local_public_read" on public.bosses_local
  for select using (true);

-- encounters — all columns are non-sensitive stats
grant select on public.encounters to anon, authenticated;
create policy "encounters_public_read" on public.encounters
  for select using (true);

-- encounter_players — per-kill DPS table, public
grant select on public.encounter_players to anon, authenticated;
create policy "encounter_players_public_read" on public.encounter_players
  for select using (true);

-- encounter_completeness view already granted to authenticated; extend to anon
grant select on public.encounter_completeness to anon;
