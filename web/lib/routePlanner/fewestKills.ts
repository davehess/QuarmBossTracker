// Route planner: the hook for "fewest raiders so far". Server only.
//
// For each boss npc id: our past kills of it with the raider count at the kill and the class mix, smallest first. The data
// is web/lib/fewestKills.ts (the same reads as GET /api/raid/fewest), reshaped by toPlannerRows (./fewest.ts) into the
// planner's row, which is the whole contract with the engine. Raiders = PLAYERS, not characters (a boxer is one).
import { supabaseAdmin } from '@/lib/supabase';
import { fewestKills as readFewest } from '@/lib/fewestKills';
import { toPlannerRows, type FewestKill } from './fewest';

// A cache in this process: several officers open the same zone at once, and the reads are not small. Never the record.
const TTL = 5 * 60 * 1000;
const held = new Map<string, { at: number; p: Promise<FewestKill[]> }>();

// The page does not wait longer than this: a cold read answers [] and keeps filling the cache for the next load.
const WAIT_MS = 5000;

export async function fewestKills(zone: string, npcIds: readonly number[]): Promise<FewestKill[]> {
  const key = `${zone}:${[...npcIds].sort((a, b) => a - b).join(',')}`;
  let hit = held.get(key);
  if (!hit || Date.now() - hit.at >= TTL) {
    const p = readFewest(supabaseAdmin(), { zone, npcIds }).then(toPlannerRows);
    hit = { at: Date.now(), p };
    held.set(key, hit);
    p.catch(() => { if (held.get(key)?.p === p) held.delete(key); });   // a failure is not remembered
    if (held.size > 20) held.delete(held.keys().next().value as string);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<FewestKill[]>(res => { timer = setTimeout(() => res([]), WAIT_MS); });
  try { return await Promise.race([hit.p, late]); } finally { clearTimeout(timer); }
}
