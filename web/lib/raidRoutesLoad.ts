// /raid/routes: the database half. Server-only (the service client). The pure maths is in lib/raidRoutes.ts.
//
// READS (every one bounded for the 1,000-row cap, test/db-read-discipline-web.test.js)
//   raid_track_minutes   the zone list reads only night_key/minute_at/zones/raiders, paged on the primary key; the
//                        frames themselves are read for ONE zone's visit at a time (contains zones [zone]), 100 minutes
//                        a page, decoded here and reduced to a centroid path. Raw frames never leave the server.
//   encounters           the zone's npc id range (zone_id * 1000 + n) inside the visit, classification null, paged on id.
//   bosses_local         the curated bosses of that npc id range (auto_registered = false), at most 100.
//   eqemu_spawn2/entry   every spawn point in the zone and which npc stands at each, paged, kept 6 hours.
//
// CACHE: in this process, per night (the analysis) and per (zone, selected nights) (the answer). A visit still being
// recorded is kept 2 minutes, a finished one 6 hours. The same rules as web/app/pop/raid/walls.ts: it is a cache, never
// the record.
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { decodeRows, splitSessions, overlapsRaidWindow, MINUTE_MS, type MinuteRow } from '@/lib/raidReplay';
import { displayMobName } from '@/lib/replayBosses';
import { isZoneShort } from '@/lib/zoneMap/source';
import { loadWalls } from '@/app/pop/raid/walls';
import {
  MIN_NIGHT_MINUTES, MIN_RAIDERS, SESSION_GAP_MS, analyzeNight, averageRoute, routeBasis, centroidSeries,
  nightPath, type CPoint, type Enc, type NightFlag, type NightTrack, type RouteResult, type SpawnPick,
} from '@/lib/raidRoutes';

const GUILD = GUILD_TAG;
const SINCE = '2026-10-01T00:00:00Z';   // the recorder started 2026-10-06
const LIVE_TTL = 2 * 60 * 1000;
const DONE_TTL = 6 * 60 * 60 * 1000;
const MAX_CACHE = 60;

// ── a tiny promise cache ──────────────────────────────────────────────────────
type Held<T> = { at: number; ttl: number; p: Promise<T> };
function held<T>(store: Map<string, Held<T>>, key: string, ttl: number, make: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.p;
  const p = make();
  store.set(key, { at: now, ttl, p });
  p.catch(() => { if (store.get(key)?.p === p) store.delete(key); });   // a failure is not remembered
  if (store.size > MAX_CACHE) for (const k of store.keys()) { store.delete(k); if (store.size <= MAX_CACHE) break; }
  return p;
}
const listStore = new Map<string, Held<ZoneListing[]>>();
const nightStore = new Map<string, Held<NightTrack>>();
const spawnStore = new Map<string, Held<Map<number, SpawnPick[]>>>();
const namedStore = new Map<string, Held<Set<number>>>();
const resultStore = new Map<string, Held<ZoneAnswer>>();

// ── the zone list ─────────────────────────────────────────────────────────────
export type VisitInfo = { key: string; night_key: string; from: number; to: number; minutes: number; peak: number; raid: boolean };
export type ZoneListing = { zone: string; name: string; zone_id: number | null; visits: VisitInfo[] };

type MinuteMeta = { night_key: string | null; minute_at: string; zones: string[] | null; raiders: number | null };

/** Every zone with at least one recorded visit of MIN_NIGHT_MINUTES raid-sized minutes. Newest visit first within a zone. */
export function listZones(): Promise<ZoneListing[]> {
  return held(listStore, 'all', LIVE_TTL, async () => {
    const admin = supabaseAdmin();
    const rows = await selectAll<MinuteMeta>((from, to) => admin.from('raid_track_minutes')
      .select('night_key, minute_at, zones, raiders')
      .eq('guild_id', GUILD)
      .gte('minute_at', SINCE)
      .order('minute_at')                  // the primary key's second column: unique within a guild
      .range(from, to));

    const byZone = new Map<string, { t: number; night: string | null; raiders: number }[]>();
    for (const r of rows) {
      const t = Date.parse(r.minute_at);
      if (!Number.isFinite(t) || (r.raiders ?? 0) < MIN_RAIDERS) continue;
      for (const z of r.zones ?? []) {
        if (typeof z !== 'string' || !z) continue;
        const a = byZone.get(z);
        const m = { t, night: r.night_key, raiders: r.raiders ?? 0 };
        if (a) a.push(m); else byZone.set(z, [m]);
      }
    }
    const out: ZoneListing[] = [];
    for (const [zone, ms] of byZone) {
      if (!isZoneShort(zone)) continue;
      const visits: VisitInfo[] = [];
      for (const g of splitSessions(ms, SESSION_GAP_MS)) {
        if (g.length < MIN_NIGHT_MINUTES) continue;
        const from = g[0].t, to = g[g.length - 1].t + MINUTE_MS;
        visits.push({
          key: String(Math.round(from / MINUTE_MS)),
          night_key: g[0].night ?? '',
          from, to, minutes: g.length,
          peak: Math.max(...g.map(m => m.raiders)),
          raid: overlapsRaidWindow(from, to),
        });
      }
      if (visits.length) out.push({ zone, name: zone, zone_id: null, visits: visits.sort((a, b) => b.from - a.from) });
    }

    // names and ids, one small read for the zones that qualified
    if (out.length) {
      const { data, error } = await admin.from('eqemu_zone').select('short_name, long_name, zone_id')
        .in('short_name', out.map(o => o.zone)).limit(100);
      if (error) throw new Error(`eqemu_zone: ${error.message}`);
      const info = new Map((data ?? []).map((z: { short_name: string; long_name: string | null; zone_id: number | null }) => [z.short_name, z]));
      for (const o of out) {
        const z = info.get(o.zone);
        if (z) { o.name = z.long_name || o.zone; o.zone_id = z.zone_id; }
      }
    }
    return out.filter(o => o.zone_id != null).sort((a, b) => a.name.localeCompare(b.name));
  });
}

// ── spawn points and curated bosses of a zone ─────────────────────────────────
function zoneSpawns(zone: string): Promise<Map<number, SpawnPick[]>> {
  return held(spawnStore, zone, DONE_TTL, async () => {
    const admin = supabaseAdmin();
    const spawns = await selectAll<{ id: number; spawngroup_id: number | null; x: number | null; y: number | null }>((from, to) =>
      admin.from('eqemu_spawn2').select('id, spawngroup_id, x, y').eq('zone_short', zone).order('id').range(from, to));
    const groups = new Map<number, SpawnPick[]>();
    for (const s of spawns) {
      if (s.spawngroup_id == null || typeof s.x !== 'number' || typeof s.y !== 'number') continue;
      const p: SpawnPick = { id: `${Math.round(s.x)}|${Math.round(s.y)}`, x: s.x, y: s.y };
      const a = groups.get(s.spawngroup_id);
      if (a) { if (!a.some(q => q.id === p.id)) a.push(p); } else groups.set(s.spawngroup_id, [p]);
    }
    const ids = [...groups.keys()];
    const out = new Map<number, SpawnPick[]>();
    for (let i = 0; i < ids.length; i += 100) {
      const entries = await selectAll<{ spawngroup_id: number; npc_id: number }>((from, to) =>
        admin.from('eqemu_spawnentry').select('spawngroup_id, npc_id')
          .in('spawngroup_id', ids.slice(i, i + 100))
          .order('spawngroup_id').order('npc_id')
          .range(from, to));
      for (const e of entries) {
        const pts = groups.get(e.spawngroup_id) ?? [];
        const a = out.get(e.npc_id) ?? [];
        for (const p of pts) if (!a.some(q => q.id === p.id)) a.push(p);
        out.set(e.npc_id, a);
      }
    }
    return out;
  });
}

function zoneNamed(zoneId: number): Promise<Set<number>> {
  return held(namedStore, String(zoneId), 10 * 60 * 1000, async () => {
    const { data, error } = await supabaseAdmin().from('bosses_local')
      .select('npc_id')
      .eq('auto_registered', false)
      .gte('npc_id', zoneId * 1000).lt('npc_id', zoneId * 1000 + 1000)
      .limit(100);   // a zone holds far fewer curated bosses than that
    if (error) throw new Error(`bosses_local: ${error.message}`);
    return new Set((data ?? []).map((r: { npc_id: number }) => r.npc_id));
  });
}

// ── one visit ─────────────────────────────────────────────────────────────────
type EncRaw = { id: number; npc_id: number; started_at: string; ended_at: string | null; eqemu_npc_types: { name: string | null } | { name: string | null }[] | null };

function visitTrack(zone: string, zoneId: number, v: VisitInfo): Promise<NightTrack> {
  const live = v.to > Date.now() - 15 * 60 * 1000;
  return held(nightStore, `${zone}|${v.key}`, live ? LIVE_TTL : DONE_TTL, async () => {
    const admin = supabaseAdmin();
    const fromIso = new Date(v.from).toISOString(), toIso = new Date(v.to).toISOString();
    const walls = await loadWalls(zone);
    const [minutes, encRaw, named] = await Promise.all([
      selectAll<MinuteRow>((from, to) => admin.from('raid_track_minutes')
        .select('minute_at, zones, data')
        .eq('guild_id', GUILD)
        .contains('zones', [zone])
        .gte('minute_at', fromIso).lt('minute_at', toIso)
        .order('minute_at')
        .range(from, to), { page: 100 }),
      selectAll<EncRaw>((from, to) => admin.from('encounters')
        .select('id, npc_id, started_at, ended_at, eqemu_npc_types(name)')
        .eq('guild_id', GUILD)
        .is('classification', null)
        .gte('npc_id', zoneId * 1000).lt('npc_id', zoneId * 1000 + 1000)
        .gte('started_at', fromIso).lt('started_at', toIso)
        .order('id')
        .range(from, to)),
      zoneNamed(zoneId),
    ]);
    const series = centroidSeries(decodeRows(minutes), zone, walls?.bounds ?? null);
    const encs: Enc[] = encRaw.flatMap(r => {
      const started = Date.parse(r.started_at);
      if (!Number.isFinite(started)) return [];
      const t = Array.isArray(r.eqemu_npc_types) ? r.eqemu_npc_types[0] : r.eqemu_npc_types;
      const ended = r.ended_at ? Date.parse(r.ended_at) : NaN;
      return [{ id: r.id, npc_id: r.npc_id, name: displayMobName(t?.name) || `npc ${r.npc_id}`, started, ended: Number.isFinite(ended) ? ended : null }];
    });
    return analyzeNight(v.key, { from: v.from, to: v.to }, series, encs, named);
  });
}

// ── the answer ────────────────────────────────────────────────────────────────
export type NightOut = {
  key: string; night_key: string; from: number; to: number; minutes: number; peak: number; raid: boolean;
  included: boolean;
  firstEngage: number | null;
  preTrash: number; preMinutes: number | null; engageToNamedS: number | null;
  named: { name: string; clockS: number }[];
  trashKills: number;
  flags: NightFlag[];
  path: [number, number][];
};
export type ZoneAnswer = {
  zone: string; name: string;
  nights: NightOut[];
  selected: string[];
  route: RouteResult;
};

/** The answer for a zone and a set of included visit keys (null = all). Null when the zone has no recorded visit. */
export async function zoneRoutes(zone: string, keys: string[] | null): Promise<ZoneAnswer | null> {
  const list = (await listZones()).find(z => z.zone === zone);
  if (!list || list.zone_id == null) return null;
  const zoneId = list.zone_id;
  const want = keys ? new Set(keys) : null;
  const selected = list.visits.filter(v => !want || want.has(v.key)).map(v => v.key).sort();
  const cacheKey = `${zone}|${selected.join(',')}`;
  const newest = list.visits[0]?.to ?? 0;
  return held(resultStore, cacheKey, newest > Date.now() - 15 * 60 * 1000 ? LIVE_TTL : DONE_TTL, async () => {
    const tracks: NightTrack[] = [];
    for (let i = 0; i < list.visits.length; i += 3) {       // three at a time: a visit is a few MB of text
      tracks.push(...await Promise.all(list.visits.slice(i, i + 3).map(v => visitTrack(zone, zoneId, v))));
    }
    const inc = new Set(selected);
    const used = tracks.filter(t => inc.has(t.key));
    const spawns = await zoneSpawns(zone);
    const route = averageRoute(used, spawns);
    const stops = routeBasis(used).stops;
    const nights: NightOut[] = list.visits.map((v, i) => {
      const t = tracks[i];
      return {
        key: v.key, night_key: v.night_key, from: v.from, to: v.to, minutes: v.minutes, peak: v.peak, raid: v.raid,
        included: inc.has(v.key),
        firstEngage: t.firstEngage,
        preTrash: t.preTrash, preMinutes: t.preMinutes, engageToNamedS: t.engageToNamedS,
        named: t.firstEngage == null ? [] : t.named.map(k => ({ name: k.name, clockS: Math.round((k.start - (t.firstEngage as number)) / 1000) })),
        trashKills: t.trash.length,
        flags: t.flags,
        path: nightPath(t, stops),
      };
    });
    return { zone, name: list.name, nights, selected, route };
  });
}

// ── the raid centre per night, for the route planner ──────────────────────────
export type NightSeries = { visit: VisitInfo; series: CPoint[]; kills: string[] };

/**
 * A zone's RAID visits (inside the raid window, MIN_RAIDERS placed), newest first and at most `limit`, each as the raid-centre
 * series centroidSeries gave it and the names of its named kills in the order they died. The route planner turns them into the
 * nights it follows (web/lib/routePlanner/nights.ts). Reads nothing of its own: it is visitTrack, the cached per-visit analysis
 * the answer above is built from, so a visit costs its reads once whoever asks first. Null when the zone has no recorded visit.
 */
export async function zoneNightSeries(zone: string, limit: number): Promise<NightSeries[] | null> {
  const list = (await listZones()).find(z => z.zone === zone);
  if (!list || list.zone_id == null) return null;
  const zoneId = list.zone_id;
  const visits = list.visits.filter(v => v.raid).slice(0, Math.max(0, limit));   // newest first already
  const out: NightSeries[] = [];
  for (let i = 0; i < visits.length; i += 3) {       // three at a time: a visit is a few MB of text
    const tracks = await Promise.all(visits.slice(i, i + 3).map(v => visitTrack(zone, zoneId, v)));
    tracks.forEach((t, j) => out.push({ visit: visits[i + j], series: t.series, kills: t.named.map(k => k.name) }));
  }
  return out;
}
