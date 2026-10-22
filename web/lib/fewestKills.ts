// "How few raiders have we killed this boss with?" for the route planner's off-night targets (the guild lead,
// 2026-10-22: "the goal with those is how few raiders we can accomplish those events with").
//
//   fewestKills(sb, { guildId, zone, npcIds }) -> [{ npc_id, boss, total_kills, kills: [...5 smallest] }]
//
// WHERE THE HEADCOUNT COMES FROM (measured on production 2026-10-22, counts only)
//   encounter_players   who DEALT damage. Always there, back to the first parse. It undercounts: a healer who
//                       never hit the mob is missing, and it also holds names that are not in `characters`
//                       (other guilds' players, pets): 2-9 of every ~50 rows on a raid kill. Those are NOT counted
//                       here, they are reported as `unmatched`.
//   raid_track_minutes  who STOOD in the zone with the raid (the spectator recorder, since 2026-10-06). On a raid
//                       kill it holds every name encounter_players has plus the healers and idle bodies: one
//                       57-name kill read 50 damage dealers and 58 placed raiders. It records only people IN A
//                       RAID, so a group of five outside a raid has no frames at all: of 169 off-night boss kills
//                       since the recorder started, 102 had none and only the damage dealers say who was there.
//   raid_roster         rejected: it keeps the latest row per raider only (about 45 minutes of history).
//   raid_attendance_ticks / opendkp_ticks  rejected: an hourly whole-raid snapshot with no zone, not tied to a kill.
// So the count is the UNION of both, and `source` says whether the recorder contributed. The union is never
// smaller than the damage dealers alone, which is what lets the loader stop reading frames early (below).
//
// PLAYERS, NOT CHARACTERS (CLAUDE.md "Fleet adoption is counted in PLAYERS"). A boxer who brought two characters is
// one player. characters.main_name / main_name_override link a family, characters.discord_id links an owner, and
// the two are joined (union-find) because neither alone is complete: 10 owners hold several families, and 12
// families have some members with no owner on record. A name that is not in `characters` is its own player.
// `characters` is the number of bodies, `players` the number of people; a raid with boxers reads 54 and 46.
//
// OFF-NIGHT: the kill's end is not inside Sun/Wed/Thu 19:30-00:30 Eastern (the guild's raid nights). Wednesday at
// noon is an off-night kill.
//
// READS (every one bounded for the 1,000-row cap, test/db-read-discipline-web.test.js)
//   encounters          the bosses' confirmed kills, paged on id, at most MAX_KILLS_PER_NPC of the newest each.
//   eqemu_npc_types     the boss names, at most MAX_NPCS rows.
//   encounter_players   character_name only, chunked by encounter, paged on (encounter_id, character_name).
//   characters          the whole roster (hundreds of rows), paged on name: needed to link families across kills.
//   raid_track_minutes  only the minutes that could change the answer. A kill's union is never below its damage
//                       dealers, so kills are read in rounds, smallest damage-dealer count first, and a boss stops
//                       once its five smallest are exact and every unread kill is larger than the fifth.
// The answer carries counts and a class mix only, never a name.
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import { decodeRows, overlapsRaidWindow, MINUTE_MS, type MinuteRow } from './raidReplay';
import { normalizeClass } from './class-titles';
import { displayMobName } from './replayBosses';

export const MAX_KILLS_SHOWN = 5;
export const MAX_KILLS_PER_NPC = 40;       // newest first; a boss killed more often than this is trash-grade anyway
export const MAX_NPCS = 30;
const TRACK_SINCE_MS = Date.parse('2026-10-06T00:00:00Z');   // the recorder started 2026-10-06 13:40 UTC
const PAD_MS = 15_000;                     // frames this long before the engage / after the kill still count
const MAX_WINDOW_MS = 20 * MINUTE_MS;      // a fight longer than this reads only its last 20 minutes
const ROUND_BATCH = 5;
const MAX_ROUNDS = 8;
const CHUNK = 40;

/** The slice of the Supabase client this module touches; tests pass a fake. */
export type Db = { from(table: string): any };

export type RosterChar = {
  name: string;
  class: string | null;
  main_name: string | null;
  main_name_override: string | null;
  discord_id: string | null;
};
export type Present = { name: string; cls: string | null };

export type Headcount = {
  players: number;
  characters: number;
  fought_players: number;      // players with a damage row in the parse (the lower bound)
  unmatched: number;           // damage-row names that are not guild characters and were not seen in the raid: not counted
  classes: Record<string, number>;
  track: boolean;              // the recorder placed at least one raider in the zone
};

export type FewestKill = Omit<Headcount, 'track'> & {
  encounter_id: string;
  killed_at: string;
  night_type: 'main' | 'off';
  source: 'track+parse' | 'parse';   // whether the raid recorder placed anyone in the zone, or only the parse says who was there
};
export type FewestBoss = { npc_id: number; boss: string; total_kills: number; kills: FewestKill[] };

// ── pure rules ────────────────────────────────────────────────────────────────

const lower = (s: string) => s.trim().toLowerCase();

/** Linking characters into players: same family root OR same Discord owner, closed transitively. */
export function indexRoster(chars: readonly RosterChar[]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let c = x; c !== r;) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a: string, b: string) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const cls = new Map<string, string | null>();
  for (const c of chars) {
    if (!c.name) continue;
    const n = lower(c.name);
    cls.set(n, normalizeClass(c.class));
    union(`c:${n}`, `f:${lower(c.main_name_override || c.main_name || c.name)}`);
    if (c.discord_id) union(`c:${n}`, `d:${c.discord_id}`);
  }
  return {
    isKnown: (name: string) => cls.has(lower(name)),
    classOf: (name: string) => cls.get(lower(name)) ?? null,
    /** A stable id for the person behind a character; an unknown name is a player of its own. */
    playerOf: (name: string) => (cls.has(lower(name)) ? find(`c:${lower(name)}`) : `n:${lower(name)}`),
  };
}
export type RosterIndex = ReturnType<typeof indexRoster>;

/**
 * One kill's headcount from the damage rows (`fighters`) and the raiders the recorder placed in the zone (`present`).
 * Everyone placed in the zone counts; a damage row counts only when the name is a guild character.
 */
export function headcount(idx: RosterIndex, fighters: readonly string[], present: readonly Present[]): Headcount {
  const seenPresent = new Set(present.map(p => lower(p.name)));
  const body = new Map<string, string | null>();      // lower name -> class
  const fought = new Set<string>();
  let unmatched = 0;
  for (const f of new Set(fighters.map(lower))) {
    if (idx.isKnown(f)) { fought.add(f); body.set(f, idx.classOf(f)); }
    else if (!seenPresent.has(f)) unmatched++;
  }
  for (const p of present) {
    const n = lower(p.name);
    if (!body.has(n) || body.get(n) == null) body.set(n, idx.isKnown(n) ? idx.classOf(n) : normalizeClass(p.cls));
  }
  const classes: Record<string, number> = {};
  for (const c of body.values()) classes[c || 'Unknown'] = (classes[c || 'Unknown'] ?? 0) + 1;
  return {
    players: new Set([...body.keys()].map(idx.playerOf)).size,
    characters: body.size,
    fought_players: new Set([...fought].map(idx.playerOf)).size,
    unmatched,
    classes,
    track: present.length > 0,
  };
}

const ET = 'America/New_York';
const weekdayET = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short' });
const MAIN_DAYS = new Set(['Sun', 'Wed', 'Thu']);

/** 'main' when the kill ended inside a Sun/Wed/Thu raid window (19:30-00:30 Eastern), else 'off'. */
export function nightType(killedMs: number): 'main' | 'off' {
  // the raid night runs past midnight, so the weekday is read six hours back (the same rule as parseTrend.nightKey)
  const day = weekdayET.format(killedMs - 6 * 3600_000);
  return MAIN_DAYS.has(day) && overlapsRaidWindow(killedMs, killedMs + 1) ? 'main' : 'off';
}

const byFewest = (a: { hc: Headcount; endMs: number }, b: { hc: Headcount; endMs: number }) =>
  a.hc.players - b.hc.players || a.hc.characters - b.hc.characters || b.endMs - a.endMs;

// ── the loader ────────────────────────────────────────────────────────────────

type KillRow = { id: string; npc_id: number; started_at: string; ended_at: string };
type Cand = { row: KillRow; startMs: number; endMs: number; fighters: string[]; hc: Headcount; read: boolean };

const chunks = <T,>(a: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export async function fewestKills(
  sb: Db,
  opts: { guildId?: string; zone: string; npcIds: readonly number[] },
): Promise<FewestBoss[]> {
  const guildId = opts.guildId ?? GUILD_TAG;
  const npcIds = [...new Set(opts.npcIds.filter(n => Number.isInteger(n) && n > 0))].slice(0, MAX_NPCS);
  if (!npcIds.length) return [];

  // 1. the confirmed kills, newest MAX_KILLS_PER_NPC per boss
  const kills: KillRow[] = [];
  for (const part of chunks(npcIds, 20)) {
    kills.push(...await selectAll<KillRow>((from, to) => sb.from('encounters')
      .select('id, npc_id, started_at, ended_at')
      .eq('guild_id', guildId)
      .in('npc_id', part)
      .not('ended_at', 'is', null)
      .is('classification', null)
      .order('id')
      .range(from, to)));
  }
  const total = new Map<number, number>();
  const perNpc = new Map<number, KillRow[]>();
  for (const k of kills) {
    total.set(k.npc_id, (total.get(k.npc_id) ?? 0) + 1);
    const a = perNpc.get(k.npc_id);
    if (a) a.push(k); else perNpc.set(k.npc_id, [k]);
  }
  const considered: KillRow[] = [];
  for (const a of perNpc.values()) {
    a.sort((x, y) => Date.parse(y.ended_at) - Date.parse(x.ended_at));
    considered.push(...a.slice(0, MAX_KILLS_PER_NPC));
  }

  // 2. the boss names, the roster, and the damage rows of every considered kill
  const nameRes = await sb.from('eqemu_npc_types').select('id, name').in('id', npcIds).limit(100);
  if (nameRes.error) throw new Error(`eqemu_npc_types: ${nameRes.error.message}`);
  const names = new Map<number, string>((nameRes.data ?? []).map((r: { id: number; name: string | null }) => [r.id, displayMobName(r.name)]));

  const roster = await selectAll<RosterChar>((from, to) => sb.from('characters')
    .select('name, class, main_name, main_name_override, discord_id')
    .eq('guild_id', guildId)
    .order('name')
    .range(from, to));
  const idx = indexRoster(roster);

  const fighters = new Map<string, string[]>();
  for (const part of chunks(considered.map(k => k.id), CHUNK)) {
    const rows = await selectAll<{ encounter_id: string; character_name: string }>((from, to) => sb.from('encounter_players')
      .select('encounter_id, character_name')
      .in('encounter_id', part)
      .order('encounter_id').order('character_name')
      .range(from, to));
    for (const r of rows) {
      const a = fighters.get(r.encounter_id);
      if (a) a.push(r.character_name); else fighters.set(r.encounter_id, [r.character_name]);
    }
  }

  const cands = new Map<number, Cand[]>();
  for (const k of considered) {
    const startMs = Date.parse(k.started_at), endMs = Date.parse(k.ended_at);
    if (!Number.isFinite(endMs)) continue;
    const f = fighters.get(k.id) ?? [];
    const c: Cand = {
      row: k, startMs: Number.isFinite(startMs) ? Math.min(startMs, endMs) : endMs, endMs, fighters: f,
      hc: headcount(idx, f, []),
      read: endMs < TRACK_SINCE_MS,          // nothing was recorded before the recorder existed
    };
    const a = cands.get(k.npc_id);
    if (a) a.push(c); else cands.set(k.npc_id, [c]);
  }

  // 3. the recorder, only where it can change the five smallest
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const batch: Cand[] = [];
    for (const a of cands.values()) {
      a.sort(byFewest);
      const fifth = a[Math.min(MAX_KILLS_SHOWN, a.length) - 1];
      if (!fifth) continue;
      batch.push(...a.filter(c => !c.read && c.hc.players <= fifth.hc.players).slice(0, ROUND_BATCH));
    }
    if (!batch.length) break;
    await readTrack(sb, guildId, opts.zone, batch, idx);
  }

  return npcIds.map(npc => {
    const a = (cands.get(npc) ?? []).sort(byFewest).slice(0, MAX_KILLS_SHOWN);
    return {
      npc_id: npc,
      boss: names.get(npc) || `npc ${npc}`,
      total_kills: total.get(npc) ?? 0,
      kills: a.map(c => {
        const { track, ...hc } = c.hc;
        return { encounter_id: c.row.id, killed_at: c.row.ended_at, ...hc, night_type: nightType(c.endMs), source: track ? 'track+parse' as const : 'parse' as const };
      }),
    };
  });
}

/** Read the recorder's minutes around each kill (merged into as few ranges as possible) and fold them into the headcounts. */
async function readTrack(sb: Db, guildId: string, zone: string, batch: Cand[], idx: RosterIndex): Promise<void> {
  const win = batch.map(c => {
    const to = c.endMs + PAD_MS;
    const from = Math.max(c.startMs - PAD_MS, to - MAX_WINDOW_MS);
    return { c, from, to, lo: Math.floor(from / MINUTE_MS) * MINUTE_MS };
  }).sort((a, b) => a.lo - b.lo);

  const ranges: { lo: number; hi: number }[] = [];
  for (const w of win) {
    const last = ranges[ranges.length - 1];
    if (last && w.lo <= last.hi + MINUTE_MS) last.hi = Math.max(last.hi, w.to);
    else ranges.push({ lo: w.lo, hi: w.to });
  }
  const rows: MinuteRow[] = [];
  for (const r of ranges) {
    rows.push(...await selectAll<MinuteRow>((from, to) => sb.from('raid_track_minutes')
      .select('minute_at, zones, data')
      .eq('guild_id', guildId)
      .contains('zones', [zone])
      .gte('minute_at', new Date(r.lo).toISOString())
      .lte('minute_at', new Date(r.hi).toISOString())
      .order('minute_at')
      .range(from, to), { hardCap: 1500 }));
  }
  const frames = decodeRows(rows);
  for (const w of win) {
    const seen = new Map<string, Present>();
    for (const f of frames) {
      if (f.t < w.from || f.t > w.to) continue;
      for (const r of f.raiders) if (r.zone === zone && !seen.has(lower(r.name))) seen.set(lower(r.name), { name: r.name, cls: r.cls });
    }
    w.c.hc = headcount(idx, w.c.fighters, [...seen.values()]);
    w.c.read = true;
  }
}
