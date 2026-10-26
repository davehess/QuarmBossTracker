// The reads and the write behind the night slices (lib/nightSlices.ts). Server-side, service-role client.
//
// READ COST, in the order it is paid, and why it stays small:
//   * the slices: ONE bot_kv row (`night_slices:<guild>`), a few KB for months of nights.
//   * the extra fights: the session loader lists only fights with no mark (`classification is null`), so the fights an
//     officer marked (wipe / another guild's / live / pvp / test) are read here, with an `or` filter that returns a
//     handful of rows a night, and only the columns that name a fight.
//   * the deaths: `raw_parse->deaths` of the contributions of the window's encounters, nothing else of the parse
//     (~170 deaths for a whole night; the sub-array is a few dozen bytes a death). Ids are chunked, each page ordered
//     on the contribution id.
// Only the members' session page calls it (the shared page has no night panel).
//
// NO NAMES LEAVE THIS FILE. A death is read as a name only to deduplicate it (the same death seen by several
// uploaders, a pet or an NPC dropped) and is returned as a time.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import { chunk, displayMobName } from './replayBosses';
import { windowIso, type ShareWindow } from './raidShare';
import { nameKey, type KillRow } from './raidSession';
import { groupOfFight, inGroupAt, type GroupIndex } from './sessionGroups';
import { dedupEncounterDeaths, dedupNightDeaths, type RawDeath } from './raidReview';
import {
  massDeaths, markFights, parseSliceStore, planSliceWrite, playerDeathName, slicesKey,
  type FightIn, type FightMark, type MassDeath, type Slice, type SlicePlan,
} from './nightSlices';

const ID_CHUNK = 40;

// ── The slices ───────────────────────────────────────────────────────────────

type KvRow = { value: unknown; updated_at: string };

async function readRow(sb: SupabaseClient): Promise<KvRow | null> {
  const { data, error } = await sb.from('bot_kv').select('value, updated_at')
    .eq('guild_id', GUILD_TAG).eq('key', slicesKey(GUILD_TAG)).limit(1).maybeSingle();
  if (error) throw error;
  return (data as KvRow | null) ?? null;
}

/** Every saved slice (oldest first). A failed read is an empty list: the page still renders, without its labels. */
export async function loadSlices(sb: SupabaseClient): Promise<Slice[]> {
  try { return parseSliceStore((await readRow(sb))?.value).s; } catch { return []; }
}

/**
 * Replace the slices inside `win` with `incoming` (planSliceWrite decides what is allowed). The row is written with
 * the `updated_at` it was read with, so two officers saving at once cannot silently undo each other: the second one
 * gets `{ error, conflict: true }` and reloads.
 */
export async function saveSlices(
  sb: SupabaseClient, win: ShareWindow, incoming: unknown, nowMs: number = Date.now(), newId: () => string = randomId,
): Promise<SlicePlan & { conflict?: boolean }> {
  const row = await readRow(sb);
  const plan = planSliceWrite(parseSliceStore(row?.value), win, incoming, newId, nowMs);
  if ('error' in plan) return plan;
  const value = plan.store;
  const stamp = new Date(nowMs).toISOString();
  if (!row) {
    const { error } = await sb.from('bot_kv').insert({ guild_id: GUILD_TAG, key: slicesKey(GUILD_TAG), value, updated_at: stamp });
    if (error) return { error: 'someone saved at the same moment; reload and try again', conflict: true };
  } else {
    const { data, error } = await sb.from('bot_kv').update({ value, updated_at: stamp })
      .eq('guild_id', GUILD_TAG).eq('key', slicesKey(GUILD_TAG)).eq('updated_at', row.updated_at)
      .select('key');
    if (error) throw error;
    if (!data || !data.length) return { error: 'someone saved at the same moment; reload and try again', conflict: true };
  }
  return plan;
}

function randomId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => (b % 36).toString(36)).join('');
}

// ── The night's fights and deaths ────────────────────────────────────────────

type ExtraEnc = {
  id: string; npc_id: number | null; started_at: string; ended_at: string | null; duration_sec: number | null;
  zone_short: string | null; classification: string | null; is_wipe: boolean | null;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};
type DeathContrib = { id: string; encounter_id: string; deaths: unknown };

export type NightMarks = { fights: FightMark[]; deaths: number[]; mass: MassDeath[] };

/**
 * The window's named fights (curated bosses), kills AND wipes AND other guilds', and its deaths. `kills` is the
 * session loader's own list (the fights with no mark), so only the marked ones are read again here.
 */
export async function loadNightMarks(sb: SupabaseClient, win: ShareWindow, kills: readonly KillRow[], raid?: RaidScope | null): Promise<NightMarks> {
  // Held for two minutes per window in this process, so saving a slice (which refreshes the page) does not read the deaths again.
  const key = `${win.fromMs}|${win.toMs}|${kills.length}|${raid?.id ?? ''}`;
  const hit = marksCache.get(key);
  if (hit && Date.now() - hit.at < MARKS_CACHE_MS) return hit.value;
  const value = await readMarks(sb, win, kills, raid ?? null);
  if (marksCache.size >= 10) marksCache.delete(marksCache.keys().next().value as string);
  marksCache.set(key, { at: Date.now(), value });
  return value;
}

const MARKS_CACHE_MS = 2 * 60_000;
const marksCache = new Map<string, { at: number; value: NightMarks }>();

/** One raid of the window (lib/sessionGroups.ts): its fights and deaths are the ones its raiders were in. */
export type RaidScope = { id: string; index: GroupIndex };

async function readMarks(sb: SupabaseClient, win: ShareWindow, kills: readonly KillRow[], raid: RaidScope | null): Promise<NightMarks> {
  const { from: lo, to: hi } = windowIso(win);
  // Wipes and another guild's fights now arrive in `kills` too (the review lists them), so only the OTHER marks
  // (live, pvp, test, and anything not already in the list) are new here.
  const listed = new Set(kills.map(k => k.id));
  let extras = (await selectAll<ExtraEnc>((from, to) => sb.from('encounters')
    .select('id, npc_id, started_at, ended_at, duration_sec, zone_short, classification, is_wipe, eqemu_npc_types(name)')
    .eq('guild_id', GUILD_TAG)
    .or('classification.not.is.null,is_wipe.eq.true')
    .gte('ended_at', lo).lt('ended_at', hi)
    .order('id')
    .range(from, to))).filter(e => !listed.has(e.id));

  // One raid's view: a marked fight stays when that raid holds at least half of its damage dealers.
  if (raid && extras.length) {
    const names = new Map<string, string[]>();
    for (const part of chunk(extras.map(e => e.id), ID_CHUNK)) {
      const rows = await selectAll<{ encounter_id: string; character_name: string }>((from, to) => sb.from('encounter_players')
        .select('encounter_id, character_name')
        .in('encounter_id', part)
        .order('encounter_id').order('character_name')
        .range(from, to));
      for (const p of rows) {
        const a = names.get(p.encounter_id);
        if (a) a.push(nameKey(p.character_name)); else names.set(p.encounter_id, [nameKey(p.character_name)]);
      }
    }
    extras = extras.filter(e => {
      const at = Date.parse(e.ended_at ?? e.started_at);
      return Number.isFinite(at) && groupOfFight(raid.index, at, names.get(e.id) ?? []) === raid.id;
    });
  }

  const npcIds = [...new Set(extras.map(e => e.npc_id).filter((n): n is number => typeof n === 'number'))];
  const bossIds = new Set<number>();
  for (const ids of chunk(npcIds, 100)) {
    const { data, error } = await sb.from('bosses_local')
      .select('npc_id')
      .eq('auto_registered', false)
      .in('npc_id', ids)
      .limit(100);   // a literal, equal to the chunk: one row at most per id asked for
    if (error) throw error;
    for (const b of (data ?? []) as { npc_id: number }[]) bossIds.add(b.npc_id);
  }

  // The night's fights are the curated bosses and the named ("#") mobs: the Crypt of Decay chain is named, not curated.
  const fights: FightIn[] = kills.filter(k => k.boss || k.named).map(k => ({
    id: k.id, name: k.name, zone: k.zone, startMs: k.startMs, endMs: k.endMs, durationSec: k.durationSec,
    classification: k.foreign ? 'foreign' : k.wipe ? 'wipe' : null, isWipe: k.wipe,
  }));
  for (const e of extras) {
    const t = Array.isArray(e.eqemu_npc_types) ? e.eqemu_npc_types[0] : e.eqemu_npc_types;
    if (e.npc_id == null || !(bossIds.has(e.npc_id) || String(t?.name ?? '').startsWith('#'))) continue;
    const start = Date.parse(e.started_at);
    if (!Number.isFinite(start)) continue;
    const end = e.ended_at ? Date.parse(e.ended_at) : NaN;
    fights.push({
      id: e.id, name: displayMobName(t?.name) || 'Unknown mob', zone: e.zone_short, startMs: start,
      endMs: Number.isFinite(end) ? end : null, durationSec: e.duration_sec, classification: e.classification, isWipe: e.is_wipe,
    });
  }

  // Deaths of anyone, in every fight of the window (trash included), as bare times.
  const ids = [...kills.map(k => k.id), ...extras.map(e => e.id)];
  const byEnc = new Map<string, (RawDeath[] | null)[]>();
  for (const part of chunk(ids, ID_CHUNK)) {
    const rows = await selectAll<DeathContrib>((from, to) => sb.from('contributions')
      .select('id, encounter_id, deaths:raw_parse->deaths')
      .in('encounter_id', part)
      .order('id')
      .range(from, to));
    for (const r of rows) {
      const d = r.deaths as RawDeath[] | null;
      const a = byEnc.get(r.encounter_id);
      if (a) a.push(d); else byEnc.set(r.encounter_id, [d]);
    }
  }
  const when = (ts: string | number) => (typeof ts === 'number' ? ts : Date.parse(ts));
  const perFight = [...byEnc.values()].flatMap(d => dedupEncounterDeaths(d)).filter(d => playerDeathName(d.name));
  const deaths = dedupNightDeaths(perFight)
    .filter(d => !raid || inGroupAt(raid.index, raid.id, nameKey(d.name), when(d.ts)))   // a name is read to place the death, never returned
    .map(d => when(d.ts))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return { fights: markFights(fights), deaths, mass: massDeaths(deaths) };
}
