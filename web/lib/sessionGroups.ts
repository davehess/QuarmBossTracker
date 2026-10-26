// Which raid is which INSIDE one recorded window (the guild lead, 2026-10-26: slicing the night's last stretch "is still
// showing characters from the previous raid in it, because there were multiple raids active at that timeframe").
// Pure (no React, no Supabase, no node), so the loader, the replay route, the page and the tests share one copy.
//
// WHY A TIME WINDOW IS NOT ENOUGH. raid_track_minutes folds every uploader's roster into ONE list per minute. So a
// window holds everyone any of our uploaders saw at any time in it: measured on the 2026-10-23 night's last stretch,
// 77 distinct characters over 3 h 48 min while 21 to 31 stood in a frame at once, and the first crew and the last
// shared 13 of 21. Attendance, deaths, fights and the replay's dots all read "everyone in the window".
//
// WHAT THE RECORDING CARRIES. Per minute: `who` (name, class, group, level), `zones` and, per placed raider, the zone
// index. The recorder (utils/raidTrack.js) also stamps `who[i][4]`, an index into `raids`, naming WHICH raid the
// uploader that saw the raider belonged to (the raid leader of that uploader's Zeal raid list, hashed: `raidKey`).
// raid_roster itself cannot answer this afterwards: it keeps only the latest row per uploader and is swept after an hour.
// Minutes recorded before the stamp have no tag, so the same function falls back to what they do carry: who stood
// together in which zone, minute after minute.
//
// THE METHOD. Per minute, the raiders are bucketed (tagged: by raid key; untagged: by zone). Buckets in neighbouring
// minutes are one raid when they carry the same raid key, or when they share SAME_RAID of the smaller one (the
// bot's utils/raidGroups.js uses the same 0.6). A bucket under MIN_LINK raiders never links by overlap: one raider
// who switched raids sits in both crews' lists and would otherwise weld two raids into one. A connected set of
// buckets is a GROUP; a group under MIN_GROUP raiders or MIN_GROUP_MINUTES minutes is a straggler, not a raid.
//
// WHAT IT CANNOT DO, said plainly: two raids in the SAME zone with no raid key stay one group (the zone copy token
// the map events carry is not in the roster upload, so it cannot split them), and a crew that turns over slowly enough
// to always share 60% with the minute before is one group (raidSplit.ts / liveRaidWindow.ts cut at the turnover).
import { nameKey, anonName, type AnonMap } from './raidSession';

export const SAME_RAID = 0.6;
export const MIN_LINK = 3;
export const MIN_GROUP = 6;
export const MIN_GROUP_MINUTES = 5;
export const LINK_GAP_MIN = 3;     // buckets this many minutes apart (or fewer) can be one raid
export const CORE_SHARE = 0.5;     // a group's core is who is listed in at least this share of its minutes
const MINUTE = 60_000;

export type RaidGroup = {
  id: string;                  // opaque and stable for the same crew: 'r…' from a raid key, 'c…' from the core crew
  size: number;                // the core: raiders listed in at least CORE_SHARE of the group's minutes
  seen: number;                // everyone who was ever listed in it
  fromMs: number;
  toMs: number;                // exclusive: the end of the last minute
  minutes: number;
  zones: string[];             // busiest first
  tagged: boolean;             // the recorder named the raid (a leader), rather than the zone standing in for it
  leader: string | null;       // shown name (an opted-out leader is their label), when the leader was placed in a frame
};

export type GroupIndex = {
  groups: RaidGroup[];
  /** group id -> minute start (ms) -> nameKeys listed in the group that minute */
  members: Map<string, Map<number, Set<string>>>;
};

/** FNV-1a 32-bit of the lower-cased name, as 8 hex digits: utils/raidTrack.js writes the same key. */
export function raidKey(leaderName: string): string {
  let h = 0x811c9dc5;
  const s = String(leaderName).trim().toLowerCase();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const shortHash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(6, '0').slice(0, 7);
};

type Bucket = { minute: number; key: string; tag: string | null; zone: string | null; names: Set<string> };
type Decoded = { who?: unknown; zones?: unknown; raids?: unknown; f?: unknown };

/** One minute row's buckets: raiders placed in a frame, by raid key when stamped, else by zone. */
function bucketsOf(minute: number, data: string): Bucket[] {
  const out = new Map<string, Bucket>();
  let d: Decoded;
  try { d = JSON.parse(data); } catch { return []; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.who) || !Array.isArray(d.f)) return [];
  const who = d.who as unknown[];
  const zones = Array.isArray(d.zones) ? (d.zones as unknown[]) : [];
  const raids = Array.isArray(d.raids) ? (d.raids as unknown[]) : [];
  const tagOf = (i: number): string | null => {
    const w = who[i];
    const ri = Array.isArray(w) ? w[4] : null;
    const t = typeof ri === 'number' && ri >= 0 ? raids[ri] : null;
    return typeof t === 'string' && t ? t : null;
  };
  for (const fr of d.f as unknown[]) {
    if (!Array.isArray(fr)) continue;
    for (let k = 1; k + 6 < fr.length; k += 7) {
      const i = Number(fr[k]), zi = Number(fr[k + 6]);
      const w = who[i];
      if (!Array.isArray(w) || typeof w[0] !== 'string' || !w[0].trim()) continue;
      const tag = tagOf(i);
      const zone = zi >= 0 && typeof zones[zi] === 'string' ? (zones[zi] as string) : null;
      const key = tag ? `r:${tag}` : `z:${zone ?? '?'}`;
      let b = out.get(key);
      if (!b) { b = { minute, key, tag, zone, names: new Set() }; out.set(key, b); }
      const nk = nameKey(w[0]);
      b.names.add(nk);
    }
  }
  return [...out.values()];
}

const overlap = (a: Set<string>, b: Set<string>): number => {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const x of s) if (l.has(x)) n++;
  return s.size ? n / s.size : 0;
};

/**
 * The raid groups of a window's minute rows, and who was in each, minute by minute. `anon` renames an opted-out
 * leader; nothing else here carries a name out (members are nameKeys, used for filtering only).
 */
export function buildGroups(rows: readonly { minute_at: string; data: string }[], anon: AnonMap = new Map()): GroupIndex {
  const all: Bucket[] = [];
  const leaderName = new Map<string, string>();         // raid key -> the leader's recorded name, when they were placed
  for (const r of rows) {
    const t = Date.parse(r.minute_at);
    if (!Number.isFinite(t)) continue;
    const minute = Math.floor(t / MINUTE);
    const buckets = bucketsOf(minute, r.data);
    all.push(...buckets);
    if (buckets.some(b => b.tag)) {   // the leader is whoever hashes to the raid key, when they were placed in a frame
      try {
        const d = JSON.parse(r.data) as { who?: unknown[] };
        for (const w of d.who ?? []) if (Array.isArray(w) && typeof w[0] === 'string') leaderName.set(raidKey(w[0]), w[0]);
      } catch { /* bucketsOf already skipped it */ }
    }
  }

  // Union-find over buckets; each is compared with those of the minutes just before it.
  const parent = all.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { const x = find(a), y = find(b); if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); };
  const byMinute = new Map<number, number[]>();
  all.forEach((b, i) => { const a = byMinute.get(b.minute); if (a) a.push(i); else byMinute.set(b.minute, [i]); });
  all.forEach((b, i) => {
    for (let m = b.minute - LINK_GAP_MIN; m < b.minute; m++) {
      for (const j of byMinute.get(m) ?? []) {
        const o = all[j];
        if (b.tag && o.tag) { if (b.tag === o.tag) union(i, j); continue; }   // two named raids never merge by overlap
        if (Math.min(b.names.size, o.names.size) < MIN_LINK) continue;
        if (overlap(b.names, o.names) >= SAME_RAID) union(i, j);
      }
    }
  });

  const comps = new Map<number, Bucket[]>();
  all.forEach((b, i) => { const r = find(i); const a = comps.get(r); if (a) a.push(b); else comps.set(r, [b]); });

  const groups: RaidGroup[] = [];
  const members = new Map<string, Map<number, Set<string>>>();
  const taken = new Set<string>();
  for (const bs of comps.values()) {
    const minutes = new Set(bs.map(b => b.minute));
    const seenCount = new Map<string, number>();
    const perMinute = new Map<number, Set<string>>();
    const zoneCount = new Map<string, number>();
    const tagCount = new Map<string, number>();
    for (const b of bs) {
      let set = perMinute.get(b.minute);
      if (!set) { set = new Set(); perMinute.set(b.minute, set); }
      for (const n of b.names) set.add(n);
      if (b.zone) zoneCount.set(b.zone, (zoneCount.get(b.zone) ?? 0) + b.names.size);
      if (b.tag) tagCount.set(b.tag, (tagCount.get(b.tag) ?? 0) + b.names.size);
    }
    for (const set of perMinute.values()) for (const n of set) seenCount.set(n, (seenCount.get(n) ?? 0) + 1);
    if (seenCount.size < MIN_GROUP || minutes.size < MIN_GROUP_MINUTES) continue;
    const needed = Math.max(1, Math.ceil(CORE_SHARE * minutes.size));
    const core = [...seenCount].filter(([, c]) => c >= needed).map(([n]) => n).sort();
    const topTag = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    let id = topTag ? `r${topTag}` : `c${shortHash(core.join('|') || [...seenCount.keys()].sort().join('|'))}`;
    for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
    taken.add(id);
    const from = Math.min(...minutes) * MINUTE;
    const lead = topTag ? leaderName.get(topTag) : undefined;
    groups.push({
      id, size: core.length, seen: seenCount.size, fromMs: from, toMs: (Math.max(...minutes) + 1) * MINUTE, minutes: minutes.size,
      zones: [...zoneCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([z]) => z),
      tagged: !!topTag, leader: lead ? anonName(anon, lead) : null,
    });
    members.set(id, perMinute);
  }
  groups.sort((a, b) => b.size - a.size || a.fromMs - b.fromMs || a.id.localeCompare(b.id));
  return { groups, members };
}

/** More than one group on the ground at the same time anywhere in the window. */
export function hasConcurrent(groups: readonly RaidGroup[]): boolean {
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (Math.min(groups[i].toMs, groups[j].toMs) - Math.max(groups[i].fromMs, groups[j].fromMs) >= MIN_GROUP_MINUTES * MINUTE) return true;
    }
  }
  return false;
}

/**
 * The raids that stood during `span` for at least MIN_GROUP_MINUTES of it, biggest first. Two or more means the span
 * holds simultaneous raids (or one replacing another), and each can be opened on its own.
 */
export function raidsIn<G extends Pick<RaidGroup, 'fromMs' | 'toMs'>>(groups: readonly G[], span: { fromMs: number; toMs: number }): G[] {
  return groups.filter(g => Math.min(g.toMs, span.toMs) - Math.max(g.fromMs, span.fromMs) >= MIN_GROUP_MINUTES * MINUTE);
}

/**
 * A raid's id means something only against the window its raiders were counted in: an untagged id is a hash of the
 * crew, and a smaller window holds a smaller crew. So a link to a part of a window names the whole window the raids were
 * found in (`gf`, `gt`), and the page and the replay route count the raids there, then cut the part by the minutes.
 */
export function groupQuery(group: string | null | undefined, parent?: { fromMs: number; toMs: number } | null): string {
  if (!group) return '';
  const p = parent ? `&gf=${encodeURIComponent(new Date(parent.fromMs).toISOString())}&gt=${encodeURIComponent(new Date(parent.toMs).toISOString())}` : '';
  return `&group=${encodeURIComponent(group)}${p}`;
}

/** "Raid of 31 · led by <leader>" (or "· in codecay" when the recorder named no leader). */
export function groupLabel(g: Pick<RaidGroup, 'size' | 'leader' | 'zones'>): string {
  const tail = g.leader ? ` · led by ${g.leader}` : g.zones.length ? ` · in ${g.zones[0]}` : '';
  return `Raid of ${g.size}${tail}`;
}

/** Is `nk` (a nameKey) listed in the group in the minute of `ms` or the minute either side of it? */
export function inGroupAt(index: GroupIndex, id: string, nk: string, ms: number): boolean {
  const per = index.members.get(id);
  if (!per) return false;
  const m = Math.floor(ms / MINUTE);
  for (let k = m - 1; k <= m + 1; k++) if (per.get(k)?.has(nk)) return true;
  return false;
}

/** Is `nk` in the group at any time? */
export function inGroupEver(index: GroupIndex, id: string, nk: string): boolean {
  for (const set of index.members.get(id)?.values() ?? []) if (set.has(nk)) return true;
  return false;
}

/** Which group (if any) a fight belongs to: the one that holds at least half of its named damage dealers. Players: nameKeys. */
export function groupOfFight(index: GroupIndex, fightMs: number, players: readonly string[]): string | null {
  const ps = [...new Set(players)];
  if (!ps.length) return null;
  let best: { id: string; n: number } | null = null;
  for (const g of index.groups) {
    const n = ps.filter(p => inGroupAt(index, g.id, p, fightMs)).length;
    if (n > (best?.n ?? 0)) best = { id: g.id, n };
  }
  return best && best.n * 2 >= ps.length ? best.id : null;
}

/**
 * One minute's `data` with only the group's raiders in it: the `who` list and each frame's tuples. A minute in which
 * the group has nobody comes back null (the caller drops the row). Mobs the raid targeted (`mf`) stay: they are
 * monsters, and the targets are counts, not people. `keep` is the group's nameKeys in that minute.
 */
export function filterMinuteData(data: string, keep: ReadonlySet<string> | undefined): string | null {
  if (!keep || !keep.size) return null;
  let d: Decoded & { [k: string]: unknown };
  try { d = JSON.parse(data); } catch { return null; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.who) || !Array.isArray(d.f)) return null;
  const remap = new Map<number, number>();
  const who: unknown[] = [];
  (d.who as unknown[]).forEach((w, i) => {
    if (Array.isArray(w) && typeof w[0] === 'string' && keep.has(nameKey(w[0]))) { remap.set(i, who.length); who.push(w); }
  });
  const f: unknown[] = [];
  for (const fr of d.f as unknown[]) {
    if (!Array.isArray(fr)) continue;
    const next: unknown[] = [fr[0]];
    for (let k = 1; k + 6 < fr.length; k += 7) {
      const ni = remap.get(Number(fr[k]));
      if (ni === undefined) continue;
      next.push(ni, fr[k + 1], fr[k + 2], fr[k + 3], fr[k + 4], fr[k + 5], fr[k + 6]);
    }
    if (next.length > 1) f.push(next);
  }
  if (!who.length || !f.length) return null;
  return JSON.stringify({ ...d, who, f });
}

/** Rows (any shape with minute_at + data) narrowed to one group; rows the group is absent from are dropped. */
export function narrowRows<T extends { minute_at: string; data: string }>(rows: readonly T[], index: GroupIndex, id: string): T[] {
  const per = index.members.get(id);
  const out: T[] = [];
  for (const r of rows) {
    const t = Date.parse(r.minute_at);
    if (!Number.isFinite(t)) continue;
    const data = filterMinuteData(r.data, per?.get(Math.floor(t / MINUTE)));
    if (data) out.push({ ...r, data });
  }
  return out;
}
