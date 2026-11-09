// The NPC type ids of the Planes of Power scripted events (Coirnav's fiends, Fennin's army, the Air and Earth
// encounters), read from web/lib/eventSpawns.json: a copy of data/event-spawns.json, which scripts/gen-event-spawns.js
// builds from the server's quest scripts (the web imports nothing from outside web/).
//
// Why the timelines need it: the spectator, replay and share timelines keep an encounter only when its npc has a
// curated bosses_local row. The event mobs are registered automatically (auto_registered = true), so a real kill of
// one was dropped. An encounter now passes when it is curated OR its npc is on this list.
import data from './eventSpawns.json';

const byZone: Record<string, ReadonlySet<number>> = {};
const all = new Set<number>();
for (const [zone, ids] of Object.entries(data.npc_ids as Record<string, number[]>)) {
  byZone[zone] = new Set(ids);
  for (const id of ids) all.add(id);
}

export const EVENT_NPC_IDS: ReadonlySet<number> = all;

export function eventNpcIdsFor(zone: string): ReadonlySet<number> {
  return byZone[zone] ?? new Set<number>();
}

export function isEventNpcId(id: number): boolean {
  return all.has(id);
}
