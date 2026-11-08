// Who hailed each flag NPC inside a raid session's window (the guild lead, 2026-11-03: "add in who was able to flag from
// a raid (or at least who hailed, its up to them to have been in the raid and not invis)").
//
// WHY A HAIL. The server flags whoever hails a flag NPC while in the raid and visible. Nothing in a log says "you were
// flagged by this raid", so a witnessed hail (pop_flags: flag_key 'hail', source 'hail_witnessed') is the proxy: it shows
// who stood at the NPC, not who the server actually flagged.
//
// Pure (no Supabase, no React), so the loader, the card and the tests share one copy. The read itself is
// loadWindowHails in lib/raidSessionLoad.ts.
import { anonName, nameKey, type AnonMap } from './raidSession';

/** A Planar Projection stays about this long, so hails this close to the previous one are the same event. */
export const HAIL_EVENT_GAP_MS = 20 * 60_000;

export type HailRow = { character: string; npc: string | null; zone: string | null; earned_at: string };

export type HailEvent = {
  npc: string;                 // shown without its article: "Planar Projection"
  zone: string | null;         // the zone id as stored
  zoneName: string | null;     // "Plane of Valor", when the id is one we can name
  fromMs: number;
  toMs: number;
  names: string[];             // shown names (an opted-out character is their label), first hail first, once each
};

/** "A Planar Projection" -> "Planar Projection". */
export const npcLabel = (npc: string): string => npc.trim().replace(/^(a|an|the)\s+/i, '');

/**
 * Hail rows -> events. `keep(nameKey, ms)` narrows to a raid set (absent = everyone). Several uploaders witness the same
 * hail, so a character counts once per event. An event is one NPC in one zone, each hail within HAIL_EVENT_GAP_MS of the
 * one before it. Oldest event first.
 */
export function buildHailEvents(
  rows: readonly HailRow[],
  anon: AnonMap,
  opts: { keep?: (nk: string, ms: number) => boolean; zoneName?: (zone: string | null) => string | null } = {},
): HailEvent[] {
  const hails = rows
    .map(r => ({ character: String(r.character ?? '').trim(), npc: String(r.npc ?? '').trim(), zone: r.zone ?? null, ms: Date.parse(r.earned_at) }))
    .filter(h => h.character && h.npc && Number.isFinite(h.ms) && (!opts.keep || opts.keep(nameKey(h.character), h.ms)))
    .sort((a, b) => a.ms - b.ms);
  const open = new Map<string, { ev: HailEvent; seen: Set<string> }>();
  const out: HailEvent[] = [];
  for (const h of hails) {
    const key = `${npcLabel(h.npc).toLowerCase()}|${h.zone ?? ''}`;
    let cur = open.get(key);
    if (!cur || h.ms - cur.ev.toMs > HAIL_EVENT_GAP_MS) {
      cur = { ev: { npc: npcLabel(h.npc), zone: h.zone, zoneName: opts.zoneName ? opts.zoneName(h.zone) : null, fromMs: h.ms, toMs: h.ms, names: [] }, seen: new Set() };
      open.set(key, cur);
      out.push(cur.ev);
    }
    cur.ev.toMs = h.ms;
    const nk = nameKey(h.character);
    if (cur.seen.has(nk)) continue;
    cur.seen.add(nk);
    cur.ev.names.push(anonName(anon, h.character));
  }
  return out.filter(e => e.names.length).sort((a, b) => a.fromMs - b.fromMs || (a.npc < b.npc ? -1 : 1));
}
