// /spectator/replay: the killed bosses of a night that was recorded before targets were. The pure parts of
// GET /api/spectator/replay/bosses, so the route, the board and the tests share one copy of the rules.
//
// WHAT IT KNOWS
//   An encounter says WHICH boss was fought and WHEN (started_at to ended_at). It does not say WHERE. The only
//   place we hold for an NPC is where it is spawned: eqemu_spawnentry (npc_id -> spawngroup_id) joined to
//   eqemu_spawn2 (spawngroup_id -> zone_short, x, y, z). So the marker is the SPAWN POINT, drawn dimmed and
//   labelled as such: where the boss stands when it appears, not where the raid dragged it.
//
// FRAME
//   eqemu_spawn2 x/y are the SERVER frame, the same axes as a decoded raider (lib/raidReplay.ts, after serverXY)
//   and as the zone mesh (lib/zoneMesh.ts); the points go out untouched. That is what the repo documents
//   (lib/spectator.ts, lib/zoneMap/slice.ts: measured 2026-10-04 on live data against eqemu_spawn2). It was not
//   re-measured for this file.

export const SPAWN_LINGER_MS = 2 * 60 * 1000;   // the marker stays this long after the kill
export const MAX_POINTS_PER_BOSS = 8;           // a placeholder group can own dozens of spawn2 rows; the map needs a few

export type EncounterRow = { npc_id: number; name: string | null; zone_short: string | null; started_at: string; ended_at: string | null };
export type SpawnEntryRow = { spawngroup_id: number; npc_id: number };
export type Spawn2Row = { id: number; spawngroup_id: number | null; zone_short: string | null; x: number | null; y: number | null; z: number | null };

export type SpawnPoint = { zone: string; x: number; y: number; z: number };
/** One boss fight with the places it can have been. Times are epoch ms. */
export type SpawnBoss = { npc_id: number; name: string; from: number; to: number; points: SpawnPoint[] };

/** A Zeal target name and an EQEmu npc name for the same mob: "Lord_Nagafen", "#Lord Nagafen", "lord nagafen". */
export function normMobName(s: string): string {
  return s.replace(/^[#!~]+/, '').replace(/[_`]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** An EQEmu npc name for display: the same cleaning as web/lib/format.ts cleanBossName, minus its placeholder. */
export function displayMobName(s: string | null | undefined): string {
  return s ? s.replace(/^[#!~]+/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Encounters + the spawn tables -> one SpawnBoss per encounter that has a place. An encounter with no spawn point
 * (summoned, instanced and parked elsewhere) is left out, since there is nothing honest to draw. When the
 * encounter names its zone, only that zone's points are kept (an NPC id is one zone, but a group can be shared).
 */
export function buildSpawnBosses(encounters: EncounterRow[], entries: SpawnEntryRow[], spawns: Spawn2Row[]): SpawnBoss[] {
  const groupsOf = new Map<number, number[]>();
  for (const e of entries) {
    const a = groupsOf.get(e.npc_id);
    if (a) a.push(e.spawngroup_id); else groupsOf.set(e.npc_id, [e.spawngroup_id]);
  }
  const byGroup = new Map<number, Spawn2Row[]>();
  for (const s of spawns) {
    if (s.spawngroup_id == null || !s.zone_short || !finite(s.x) || !finite(s.y)) continue;
    const a = byGroup.get(s.spawngroup_id);
    if (a) a.push(s); else byGroup.set(s.spawngroup_id, [s]);
  }
  const out: SpawnBoss[] = [];
  for (const enc of encounters) {
    const from = Date.parse(enc.started_at);
    const to = enc.ended_at ? Date.parse(enc.ended_at) : NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
    const rows = (groupsOf.get(enc.npc_id) ?? []).flatMap(g => byGroup.get(g) ?? []);
    const here = enc.zone_short ? rows.filter(r => r.zone_short === enc.zone_short) : [];
    const use = (here.length ? here : rows).slice().sort((a, b) => a.id - b.id);
    const seen = new Set<string>();
    const points: SpawnPoint[] = [];
    for (const r of use) {
      const k = `${r.zone_short}|${Math.round(r.x as number)}|${Math.round(r.y as number)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      points.push({ zone: r.zone_short as string, x: r.x as number, y: r.y as number, z: finite(r.z) ? r.z : 0 });
      if (points.length >= MAX_POINTS_PER_BOSS) break;
    }
    if (points.length) out.push({ npc_id: enc.npc_id, name: displayMobName(enc.name) || 'Unknown boss', from, to, points });
  }
  return out.sort((a, b) => a.from - b.from || a.npc_id - b.npc_id);
}

export type ActiveSpawn = { name: string; zone: string; x: number; y: number; z: number };

/**
 * The spawn-point markers to draw at playhead `t`: bosses fought now (started_at through ended_at plus the
 * linger), minus any whose name is in `recorded` (normMobName'd names of mobs raiders were seen targeting just
 * now: the recorded position beats the spawn point).
 */
export function activeSpawns(bosses: readonly SpawnBoss[], t: number, recorded: ReadonlySet<string>): ActiveSpawn[] {
  const out: ActiveSpawn[] = [];
  for (const b of bosses) {
    if (t < b.from || t > b.to + SPAWN_LINGER_MS) continue;
    if (recorded.has(normMobName(b.name))) continue;
    for (const p of b.points) out.push({ name: b.name, zone: p.zone, x: p.x, y: p.y, z: p.z });
  }
  return out;
}

/** Slices of at most `size`, for an `in (...)` list that must stay a short URL. */
export function chunk<T>(a: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

/**
 * The bosses endpoint's JSON -> SpawnBosses, dropping anything that is not the shape we wrote. A boss with an empty
 * `points` list is kept: the hosted route never sends one (buildSpawnBosses drops a boss with no place), but the local
 * site's agent does for a kill it has no recorded position for, and the raid timeline still wants that death.
 */
export function parseBosses(j: unknown): SpawnBoss[] {
  const list = j && typeof j === 'object' ? (j as { bosses?: unknown }).bosses : null;
  if (!Array.isArray(list)) return [];
  const out: SpawnBoss[] = [];
  for (const b of list as Record<string, unknown>[]) {
    if (!b || typeof b.name !== 'string' || !finite(b.from) || !finite(b.to) || !Array.isArray(b.points)) continue;
    const points = (b.points as Record<string, unknown>[]).filter(
      p => p && typeof p.zone === 'string' && finite(p.x) && finite(p.y),
    ).map(p => ({ zone: p.zone as string, x: p.x as number, y: p.y as number, z: finite(p.z) ? p.z : 0 }));
    out.push({ npc_id: finite(b.npc_id) ? b.npc_id : 0, name: b.name, from: b.from, to: b.to, points });
  }
  return out;
}
