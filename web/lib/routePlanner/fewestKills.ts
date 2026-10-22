// Route planner: the hook for "fewest raiders so far". Server only.
//
// For each boss npc id: our past kills of it with the raider count at the kill and the class mix, smallest first. The real
// data (a lib + API another session is building) is wired in HERE and nowhere else; until then this answers [] and the page
// shows nothing for it. The page calls it once per load with the npc ids of the zone's bosses and named, and hands the rows
// to the engine as a plain prop, so the shape in ./fewest.ts is the whole contract.
import type { FewestKill } from './fewest';

export async function fewestKills(_zone: string, _npcIds: readonly number[]): Promise<FewestKill[]> {
  return [];
}
