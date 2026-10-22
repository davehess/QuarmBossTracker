// Route planner: the database half. Server-only (the service client). The pure rules are in this folder's other files.
//
// READS (each bounded; the table is small or the key list is, test/db-read-discipline-web.test.js)
//   bot_kv `route_plan:<zone>`       the zone's plans and their versions: ONE row, read whole only when it changed; the cheap
//                                    check is the stamp inside the value (`value->>updated_at`)
//   fight_cards                      the zone's active cards (boss_npc_id in the zone's npc id range), at most 100
//   eqemu_npc_types / spawnentry / spawn2
//                                    only for a fight-card boss the static zone data does not have: its name and its
//                                    first spawn point, at most 100 npc ids
//   raid_track_minutes / encounters  NOT read here: the zone's recent raid nights come from raidRoutesLoad.ts zoneNightSeries,
//                                    the per-visit analysis /api/raid/routes already reads (bounded and paged there), at most
//                                    NIGHT_CAP visits, kept five minutes in this process (the ?v= previews only)
// The browser never gets a row it did not ask for: the page passes the plan and the card bosses as props, the actions
// return one plan at a time.
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import { selectAll } from '@/lib/selectAll';
import { cleanBossName } from '@/lib/format';
import { GUIDE_ITEMS } from '@/lib/popGuide';
import { zoneNightSeries } from '@/lib/raidRoutesLoad';
import { parseStore, storeKey, type PlanStore } from './store';
import { NIGHT_CAP, liveNights, mergeNights, nightsNote } from './nights';
import type { Mob, Night, ZoneData } from './types';
import type { ChecklistStep } from './build';

export async function readStore(zone: string): Promise<PlanStore | null> {
  const { data, error } = await supabaseAdmin().from('bot_kv').select('value')
    .eq('guild_id', GUILD_TAG).eq('key', storeKey(zone)).limit(1).maybeSingle();
  if (error) throw new Error(`bot_kv: ${error.message}`);
  return data ? parseStore((data as { value: unknown }).value, zone) : null;
}

/** The stamp of the stored row (any plan of the zone saved), without the plans: what a poll asks first. Null when nothing is saved. */
export async function readRowStamp(zone: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from('bot_kv').select('stamp:value->>updated_at')
    .eq('guild_id', GUILD_TAG).eq('key', storeKey(zone)).limit(1).maybeSingle();
  if (error) throw new Error(`bot_kv: ${error.message}`);
  const s = data ? (data as unknown as { stamp: string | null }).stamp : null;
  return typeof s === 'string' ? s : null;
}

export async function writeStore(store: PlanStore): Promise<void> {
  const { error } = await supabaseAdmin().from('bot_kv')
    .upsert({ guild_id: GUILD_TAG, key: storeKey(store.zone), value: store, updated_at: store.updated_at }, { onConflict: 'guild_id,key' });
  if (error) throw new Error(`bot_kv: ${error.message}`);
}

/** The zone's PoP checklist steps, in the guide's own order. */
export function zoneChecklist(zone: ZoneData): ChecklistStep[] {
  const byKey = new Map(GUIDE_ITEMS.map(i => [i.key, i]));
  return zone.popKeys.flatMap(key => {
    const it = byKey.get(key);
    return it ? [{ key, title: it.title }] : [];
  });
}

export type CardBosses = {
  onPlanNpcs: number[];      // every fight-card boss of the zone, in card order
  extra: Mob[];              // those the static zone data has no mob for, placed at their first spawn point
  unplaced: number;          // those with no spawn point on record (left out of the build)
};

export async function cardBosses(zone: ZoneData): Promise<CardBosses> {
  const sb = supabaseAdmin();
  const lo = zone.zoneId * 1000, hi = lo + 999;
  const { data: cards, error } = await sb.from('fight_cards').select('boss_npc_id, sort_order')
    .eq('guild_id', GUILD_TAG).eq('active', true).gte('boss_npc_id', lo).lte('boss_npc_id', hi)
    .order('sort_order', { ascending: true }).order('id', { ascending: true }).limit(100);
  if (error) throw new Error(`fight_cards: ${error.message}`);
  const onPlanNpcs: number[] = [];
  for (const c of (cards ?? []) as { boss_npc_id: number }[]) if (!onPlanNpcs.includes(c.boss_npc_id)) onPlanNpcs.push(c.boss_npc_id);

  const known = new Set(zone.mobs.map(m => m.npc).filter((n): n is number => n !== undefined));
  const missing = onPlanNpcs.filter(n => !known.has(n));
  if (!missing.length) return { onPlanNpcs, extra: [], unplaced: 0 };

  const [names, entries] = await Promise.all([
    sb.from('eqemu_npc_types').select('id, name, level, hp').in('id', missing).order('id').limit(100),
    selectAll<{ spawngroup_id: number; npc_id: number }>((from, to) =>
      sb.from('eqemu_spawnentry').select('spawngroup_id, npc_id').in('npc_id', missing).order('spawngroup_id').order('npc_id').range(from, to)),
  ]);
  if (names.error) throw new Error(`eqemu_npc_types: ${names.error.message}`);
  const groupOf = new Map<number, number[]>();
  for (const e of entries) {
    const a = groupOf.get(e.npc_id) ?? [];
    a.push(e.spawngroup_id);
    groupOf.set(e.npc_id, a);
  }
  const groups = [...new Set([...groupOf.values()].flat())];
  const spawns = groups.length
    ? await selectAll<{ id: number; spawngroup_id: number; x: number | null; y: number | null; z: number | null }>((from, to) =>
      sb.from('eqemu_spawn2').select('id, spawngroup_id, x, y, z').eq('zone_short', zone.zone).in('spawngroup_id', groups).order('id').range(from, to))
    : [];
  const firstOf = new Map<number, { id: number; x: number; y: number; z: number | null }>();   // spawngroup -> its first point
  for (const s of spawns) {
    if (typeof s.x === 'number' && typeof s.y === 'number' && !firstOf.has(s.spawngroup_id)) firstOf.set(s.spawngroup_id, { id: s.id, x: s.x, y: s.y, z: s.z });
  }
  const info = new Map(((names.data ?? []) as { id: number; name: string; level: number | null; hp: number | null }[]).map(n => [n.id, n]));

  const extra: Mob[] = [];
  let unplaced = 0;
  for (const npc of missing) {
    const sp = (groupOf.get(npc) ?? []).map(g => firstOf.get(g)).find(Boolean);
    if (!sp) { unplaced++; continue; }
    const n = info.get(npc);
    const m: Mob = {
      tier: 1, id: `npc${npc}`, name: cleanBossName(n?.name), kind: 'boss', npc, x: Math.round(sp.x), y: Math.round(sp.y), spawn2: sp.id,
      note: 'On a fight card (the raid planner). Placed at its first catalog spawn point.',
    };
    if (sp.z !== null) m.z = Math.round(sp.z * 10) / 10;
    if (n?.level) m.level = n.level;
    if (n?.hp) m.hp = Number(n.hp);
    extra.push(m);
  }
  return { onPlanNpcs, extra, unplaced };
}

// ── the zone's recorded nights, live ──────────────────────────────────────────
const NIGHTS_TTL = 5 * 60 * 1000;       // "a few minutes": a night in progress is a few minutes old at worst
const NIGHTS_WAIT = 8000;               // the page does not wait longer; the work goes on and the next load has it
const nightsHeld = new Map<string, { at: number; p: Promise<Night[]> }>();

async function readLiveNights(zone: ZoneData): Promise<Night[]> {
  const got = await zoneNightSeries(zone.zone, NIGHT_CAP);
  return got ? liveNights(got.map(g => ({ night_key: g.visit.night_key, from: g.visit.from, minutes: g.visit.minutes, series: g.series, kills: g.kills })), zone.nights) : [];
}

/**
 * The zone's nights for the planner: the file's saved ones with the recorder's raid nights merged over them (same night key =
 * one night, the live copy wins), newest first, at most NIGHT_CAP. `note` is what the Layers tab says about the list. Any
 * failure, or a recorder slower than NIGHTS_WAIT, gives the file's own nights, as the page has always had.
 */
export async function plannerNights(zone: ZoneData): Promise<{ nights: Night[]; note: string }> {
  const plain = { nights: zone.nights, note: '' };
  let h = nightsHeld.get(zone.zone);
  if (!h || Date.now() - h.at > NIGHTS_TTL) {
    const mine = { at: Date.now(), p: readLiveNights(zone) };
    h = mine;
    nightsHeld.set(zone.zone, mine);
    mine.p.catch(() => { if (nightsHeld.get(zone.zone) === mine) nightsHeld.delete(zone.zone); });   // a failure is not remembered
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const live = await Promise.race([h.p, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('recorder slow')), NIGHTS_WAIT); })]);
    if (!live.length) return plain;
    const m = mergeNights(zone.nights, live, NIGHT_CAP);
    return { nights: m.nights, note: nightsNote(m, NIGHT_CAP) };
  } catch {
    return plain;
  } finally {
    clearTimeout(timer);
  }
}
