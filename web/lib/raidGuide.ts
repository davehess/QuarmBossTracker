// web/lib/raidGuide.ts — #81 Wolf Pack Raid Guide, pure kernel (unit-tested).
//
// Design: docs/DESIGN-81-raid-guide.md. This module holds the side-effect-free
// logic the Guide pages need; the Supabase queries live in the page server
// components (matching /parses, /rolls, /raid/review). No React/Next imports on
// purpose so the ROOT vitest suite can real-import it — same contract as
// web/lib/raidReview.ts (#80), which this file deliberately does NOT duplicate:
// death dedup, slow matching, span bounding and the Eastern-day window all come
// from there when the Guide needs them.
//
// The load-bearing rules implemented here (each one is a §-reference into the
// design doc, and each one exists because getting it wrong produces a WRONG
// guide, not an empty one):
//
//   §6.1  resolveCatalogRow  — the #171 pick-and-merge. encounters.npc_id often
//         points at a stats-EMPTY shell row (#Emperor_Ssraeshza 162065: no loot
//         table, no spell list, AC 200, 7 min damage) while a sibling row carries
//         the real tuning (Emperor_Ssraeshza_ 162491: AC 700, 283-904, MR 1000,
//         loottable 12791). A limit=1 lookup renders a fictional boss.
//   §6.1  hpCorroboration    — our own median raid damage tells us WHICH row is
//         right: 1,211,014 is 96.9% of 162491's 1.25M pool and 121% of 162065's.
//   §6.2  completeKills      — a DAMAGE floor, not a duration floor. duration>=60
//         still admits an 81s / 198k re-pull fragment against a 1.25M pool.
//   §6.3  soleSourceDrops    — loot_drops is empty and OpenDKP records item->raid,
//         not item->NPC, so boss->loot is only sound for single-source items.
//   §6.4  pairwiseOrder      — average kill-slot ordering is provably wrong
//         (it puts Emperor BEFORE the Blood of Ssraeshza that spawns him);
//         pairwise precedence over shared nights is not.

// ── Catalog row resolution (§6.1) ────────────────────────────────────────────

export type CatalogRow = {
  id: number;
  name: string;
  level?: number | null;
  hp?: number | null;
  ac?: number | null;
  mindmg?: number | null;
  maxdmg?: number | null;
  mr?: number | null; fr?: number | null; cr?: number | null;
  dr?: number | null; pr?: number | null;
  class?: number | null;
  race?: number | null;
  runspeed?: number | null;
  npc_spells_id?: number | null;
  loottable_id?: number | null;
  npcspecialattks?: string | null;
};

// eqemu names carry '#' instance markers, '_' word separators and trailing '_'
// disambiguators. Normalise to a comparable display form. (cleanBossName in
// web/lib/format.ts does the display half; this is the MATCH half and also
// strips the trailing underscore that distinguishes sibling rows.)
export function normalizeNpcName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/#/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Fields where 0 / null means "this row does not carry the fact" rather than
// "the fact is zero". runspeed 0 is a REAL value (Emperor does not move), so it
// is deliberately absent from this list and merged by null-check only.
const ZERO_MEANS_MISSING = new Set([
  'hp', 'ac', 'mindmg', 'maxdmg', 'npc_spells_id', 'loottable_id', 'level',
]);

function rowScore(r: CatalogRow): number {
  // Prefer the row that actually carries the expensive facts. A row with a loot
  // table AND a spell list is the live one; a shell has neither.
  let s = 0;
  if ((r.loottable_id ?? 0) > 0) s += 4;
  if ((r.npc_spells_id ?? 0) > 0) s += 3;
  if ((r.hp ?? 0) > 0) s += 1;
  if ((r.maxdmg ?? 0) > 0) s += 1;
  if ((r.ac ?? 0) > 0) s += 1;
  return s;
}

export type ResolvedCatalog = {
  row: CatalogRow;             // field-wise merge
  primaryId: number;           // id of the highest-scoring source row
  mergedFrom: number[];        // every id that contributed
  usedFallbackRow: boolean;    // true when the keyed row was NOT the best one
};

// Pick-and-merge (#171 rules 1-5). `keyedId` is the id encounters.npc_id points
// at — it stays the identity of the page, but it does not get to be the source
// of truth for stats it does not carry.
export function resolveCatalogRow(
  candidates: (CatalogRow | null | undefined)[] | null | undefined,
  keyedId?: number | null,
): ResolvedCatalog | null {
  const rows = (Array.isArray(candidates) ? candidates : []).filter((r): r is CatalogRow => !!r && Number.isFinite(r.id));
  if (rows.length === 0) return null;

  // Highest score wins; ties break toward the keyed row, then lowest id (stable).
  const ranked = [...rows].sort((a, b) => {
    const d = rowScore(b) - rowScore(a);
    if (d !== 0) return d;
    if (keyedId != null) {
      if (a.id === keyedId) return -1;
      if (b.id === keyedId) return 1;
    }
    return a.id - b.id;
  });
  const primary = ranked[0];

  const merged: CatalogRow = { ...primary };
  const mergedFrom: number[] = [primary.id];
  for (const r of ranked.slice(1)) {
    let contributed = false;
    for (const k of Object.keys(r) as (keyof CatalogRow)[]) {
      if (k === 'id' || k === 'name') continue;
      const cur = merged[k];
      const missing = cur == null || (ZERO_MEANS_MISSING.has(k as string) && Number(cur) === 0);
      const incoming = r[k];
      const incomingUseful = incoming != null && !(ZERO_MEANS_MISSING.has(k as string) && Number(incoming) === 0);
      if (missing && incomingUseful) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[k] = incoming;
        contributed = true;
      }
    }
    if (contributed) mergedFrom.push(r.id);
  }

  return {
    row: merged,
    primaryId: primary.id,
    mergedFrom,
    usedFallbackRow: keyedId != null && primary.id !== keyedId,
  };
}

// ── HP corroboration (§6.1) ──────────────────────────────────────────────────

export type Corroboration = {
  medianDamage: number;
  hp: number;
  ratio: number;          // medianDamage / hp
  agrees: boolean;        // within the plausible band
  verdict: 'agrees' | 'over' | 'under' | 'unknown';
};

// A raid that kills a boss deals just about exactly its HP pool (plus overkill,
// minus any self-heal). So median(total_damage) / hp landing near 1.0 is real
// evidence the catalog row is the right one; >1.15 means the pool is understated
// (the shell-row signature).
export function hpCorroboration(medianDamage: number, hp: number | null | undefined): Corroboration | null {
  if (!Number.isFinite(medianDamage) || medianDamage <= 0) return null;
  if (!hp || !Number.isFinite(hp) || hp <= 0) return null;
  const ratio = medianDamage / hp;
  const verdict: Corroboration['verdict'] =
    ratio > 1.15 ? 'over' : ratio < 0.6 ? 'under' : 'agrees';
  return { medianDamage, hp, ratio, agrees: verdict === 'agrees', verdict };
}

// ── Kill statistics (§6.2) ───────────────────────────────────────────────────

export type GuideEncounter = {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  total_damage: number | null;
  total_dps: number | null;
  classification: string | null;
  player_count?: number | null;
};

export type KillBuckets = {
  complete: GuideEncounter[];      // the only rows that feed a median
  fragments: GuideEncounter[];     // confirmed but below the damage floor
  noParse: GuideEncounter[];       // timer-only rows (0 damage / no uploader)
  engaged: GuideEncounter[];       // ended_at null — never killed (or never seen die)
  excluded: GuideEncounter[];      // classification set (foreign/pvp/live/wipe)
  damageFloor: number;
  floorSource: 'catalog-hp' | 'median-damage';
};

export function median(nums: (number | null | undefined)[]): number | null {
  const xs = (Array.isArray(nums) ? nums : [])
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    .sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// hpPool: the corroborated HP from resolveCatalogRow, when we have one. When we
// do not, fall back to half the median CONFIRMED damage — robust because a
// median ignores the fragment minority (see §6.1 "no circularity").
export function bucketEncounters(
  encs: (GuideEncounter | null | undefined)[] | null | undefined,
  hpPool?: number | null,
): KillBuckets {
  const all = (Array.isArray(encs) ? encs : []).filter((e): e is GuideEncounter => !!e && !!e.id);

  const excluded = all.filter(e => !!e.classification);
  const rest     = all.filter(e => !e.classification);
  const engaged  = rest.filter(e => e.ended_at == null);
  const confirmed = rest.filter(e => e.ended_at != null);

  let damageFloor: number;
  let floorSource: KillBuckets['floorSource'];
  if (hpPool && hpPool > 0) {
    damageFloor = hpPool * 0.5;
    floorSource = 'catalog-hp';
  } else {
    const med = median(confirmed.map(e => e.total_damage)) ?? 0;
    damageFloor = med * 0.5;
    floorSource = 'median-damage';
  }

  const noParse   = confirmed.filter(e => !(e.total_damage && e.total_damage > 0));
  const withParse = confirmed.filter(e => !!(e.total_damage && e.total_damage > 0));
  const complete  = withParse.filter(e => (e.total_damage as number) >= damageFloor);
  const fragments = withParse.filter(e => (e.total_damage as number) < damageFloor);

  return { complete, fragments, noParse, engaged, excluded, damageFloor, floorSource };
}

export type KillStats = {
  engagements: number;
  completeKills: number;
  fragments: number;
  noParse: number;
  engaged: number;
  medianDurationSec: number | null;
  minDurationSec: number | null;
  maxDurationSec: number | null;
  medianDamage: number | null;
  maxDamage: number | null;
  medianDps: number | null;
  medianPlayers: number | null;
  firstAt: string | null;
  lastAt: string | null;
};

export function killStats(b: KillBuckets): KillStats {
  const c = b.complete;
  const durs = c.map(e => e.duration_sec).filter((n): n is number => typeof n === 'number' && n > 0);
  const times = [...b.complete, ...b.fragments, ...b.noParse, ...b.engaged]
    .map(e => e.started_at).filter(Boolean).sort();
  return {
    engagements: b.complete.length + b.fragments.length + b.noParse.length + b.engaged.length,
    completeKills: c.length,
    fragments: b.fragments.length,
    noParse: b.noParse.length,
    engaged: b.engaged.length,
    medianDurationSec: median(durs),
    minDurationSec: durs.length ? Math.min(...durs) : null,
    maxDurationSec: durs.length ? Math.max(...durs) : null,
    medianDamage: median(c.map(e => e.total_damage)),
    maxDamage: c.length ? Math.max(...c.map(e => e.total_damage || 0)) : null,
    medianDps: median(c.map(e => e.total_dps)),
    medianPlayers: median(c.map(e => e.player_count ?? null)),
    firstAt: times[0] ?? null,
    lastAt: times[times.length - 1] ?? null,
  };
}

// ── Loot attribution (§6.3) ──────────────────────────────────────────────────

export type DropRow  = { item_id: number; item_name: string };
export type AwardRow = { item_name: string; character_name?: string | null; dkp?: number | null };

export type GuideLootRow = {
  itemId: number;
  itemName: string;
  soleSource: boolean;
  awards: number;
  avgDkp: number | null;
  maxDkp: number | null;
};

// dropperCounts: item_id -> how many DISTINCT npcs drop it (from eqemu_npc_drops).
// Only sole-source items get prices — a spell scroll on twelve loot tables would
// otherwise put someone else's DKP on this boss's page.
export function attributeLoot(
  drops: (DropRow | null | undefined)[] | null | undefined,
  dropperCounts: Map<number, number> | null | undefined,
  awards: (AwardRow | null | undefined)[] | null | undefined,
): { sole: GuideLootRow[]; shared: GuideLootRow[] } {
  const byName = new Map<string, { n: number; sum: number; max: number }>();
  for (const a of (Array.isArray(awards) ? awards : [])) {
    if (!a || !a.item_name) continue;
    const k = a.item_name.toLowerCase();
    const d = Number(a.dkp) || 0;
    const cur = byName.get(k) || { n: 0, sum: 0, max: 0 };
    cur.n += 1; cur.sum += d; cur.max = Math.max(cur.max, d);
    byName.set(k, cur);
  }

  const sole: GuideLootRow[] = [], shared: GuideLootRow[] = [];
  const seen = new Set<number>();
  for (const d of (Array.isArray(drops) ? drops : [])) {
    if (!d || !d.item_name || seen.has(d.item_id)) continue;
    seen.add(d.item_id);
    const isSole = (dropperCounts?.get(d.item_id) ?? 1) <= 1;
    const agg = byName.get(d.item_name.toLowerCase());
    const row: GuideLootRow = {
      itemId: d.item_id,
      itemName: d.item_name,
      soleSource: isSole,
      awards: isSole ? (agg?.n ?? 0) : 0,
      avgDkp: isSole && agg && agg.n ? Math.round(agg.sum / agg.n) : null,
      maxDkp: isSole && agg ? agg.max : null,
    };
    (isSole ? sole : shared).push(row);
  }
  sole.sort((a, b) => (b.avgDkp ?? -1) - (a.avgDkp ?? -1) || a.itemName.localeCompare(b.itemName));
  shared.sort((a, b) => a.itemName.localeCompare(b.itemName));
  return { sole, shared };
}

// ── Run order (§6.4) ─────────────────────────────────────────────────────────

export type ZoneKill = { bossKey: string; night: string; at: string | number };
export type OrderRow = { bossKey: string; nights: number; score: number; confidence: number };

function ms(t: string | number): number {
  return typeof t === 'number' ? t : Date.parse(t);
}

// Pairwise precedence (Copeland). For every pair appearing on the same night,
// count A-before-B vs B-before-A; a boss's score is its win rate across pairs
// with at least `minShared` shared nights. Average-slot ordering is NOT used —
// it ranks bosses with different sample eras against each other and produces
// impossible orders (Emperor before the Blood of Ssraeshza that spawns him).
export function pairwiseOrder(
  kills: (ZoneKill | null | undefined)[] | null | undefined,
  minShared = 4,
): OrderRow[] {
  // Earliest engagement per (boss, night).
  const firstAt = new Map<string, Map<string, number>>();  // night -> boss -> ms
  const nightsPerBoss = new Map<string, Set<string>>();
  for (const k of (Array.isArray(kills) ? kills : [])) {
    if (!k || !k.bossKey || !k.night) continue;
    const t = ms(k.at);
    if (!Number.isFinite(t)) continue;
    const byBoss = firstAt.get(k.night) || new Map<string, number>();
    const prev = byBoss.get(k.bossKey);
    if (prev == null || t < prev) byBoss.set(k.bossKey, t);
    firstAt.set(k.night, byBoss);
    const ns = nightsPerBoss.get(k.bossKey) || new Set<string>();
    ns.add(k.night);
    nightsPerBoss.set(k.bossKey, ns);
  }

  type Pair = { a: number; b: number; shared: number };
  const pairs = new Map<string, Pair>();
  const key = (a: string, b: string) => a + ' ' + b;
  for (const byBoss of firstAt.values()) {
    const entries = [...byBoss.entries()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        let [x, tx] = entries[i], [y, ty] = entries[j];
        if (x === y) continue;
        if (x > y) { [x, y] = [y, x]; [tx, ty] = [ty, tx]; }
        const k = key(x, y);
        const p = pairs.get(k) || { a: 0, b: 0, shared: 0 };
        p.shared += 1;
        if (tx < ty) p.a += 1; else if (ty < tx) p.b += 1;
        pairs.set(k, p);
      }
    }
  }

  const wins = new Map<string, { w: number; n: number }>();
  for (const [k, p] of pairs) {
    if (p.shared < minShared) continue;
    const [x, y] = k.split(' ');
    const total = p.a + p.b;
    if (total === 0) continue;
    const wx = wins.get(x) || { w: 0, n: 0 };
    const wy = wins.get(y) || { w: 0, n: 0 };
    wx.w += p.a / total; wx.n += 1;
    wy.w += p.b / total; wy.n += 1;
    wins.set(x, wx); wins.set(y, wy);
  }

  const out: OrderRow[] = [];
  for (const [boss, ns] of nightsPerBoss) {
    const w = wins.get(boss);
    out.push({
      bossKey: boss,
      nights: ns.size,
      score: w && w.n ? w.w / w.n : 0.5,     // no comparable pairs → neutral
      confidence: w ? w.n : 0,
    });
  }
  // Higher win rate = killed EARLIER (it "beats" more bosses to the pull).
  return out.sort((a, b) => b.score - a.score || b.nights - a.nights || a.bossKey.localeCompare(b.bossKey));
}

// Direct A-before-B readout for a single pair, for the "Blood first on 6 of 8
// shared nights (75%)" line the run sheet renders next to a chained boss.
export function precedence(
  kills: (ZoneKill | null | undefined)[] | null | undefined,
  a: string, b: string,
): { aFirst: number; bFirst: number; shared: number; rate: number | null } {
  const byNight = new Map<string, { ta?: number; tb?: number }>();
  for (const k of (Array.isArray(kills) ? kills : [])) {
    if (!k || !k.night) continue;
    const t = ms(k.at);
    if (!Number.isFinite(t)) continue;
    const slot = byNight.get(k.night) || {};
    if (k.bossKey === a && (slot.ta == null || t < slot.ta)) slot.ta = t;
    if (k.bossKey === b && (slot.tb == null || t < slot.tb)) slot.tb = t;
    byNight.set(k.night, slot);
  }
  let aFirst = 0, bFirst = 0, shared = 0;
  for (const s of byNight.values()) {
    if (s.ta == null || s.tb == null) continue;
    shared += 1;
    if (s.ta < s.tb) aFirst += 1; else if (s.tb < s.ta) bFirst += 1;
  }
  return { aFirst, bFirst, shared, rate: shared ? aFirst / shared : null };
}

// ── Authored-note staleness (§5.3) ───────────────────────────────────────────

export type GuideFacts = Record<string, number | null | undefined>;

export const STALE_REL_DELTA   = 0.25;   // a watched scalar moved >25%
export const STALE_KILL_GROWTH = 0.50;   // …or the sample grew by >=50%

// Never rewrites anything — returns the list of facts that moved so the page can
// show a banner and offer "mark reviewed" (which re-snapshots, prose untouched).
export function staleFacts(
  writtenWith: GuideFacts | null | undefined,
  now: GuideFacts | null | undefined,
): { key: string; then: number; now: number; delta: number }[] {
  const out: { key: string; then: number; now: number; delta: number }[] = [];
  if (!writtenWith || !now) return out;
  for (const [k, thenRaw] of Object.entries(writtenWith)) {
    const then = Number(thenRaw), cur = Number(now[k]);
    if (!Number.isFinite(then) || !Number.isFinite(cur) || then === 0) continue;
    const delta = (cur - then) / Math.abs(then);
    const threshold = k === 'completeKills' ? STALE_KILL_GROWTH : STALE_REL_DELTA;
    if (Math.abs(delta) >= threshold) out.push({ key: k, then, now: cur, delta });
  }
  return out;
}
