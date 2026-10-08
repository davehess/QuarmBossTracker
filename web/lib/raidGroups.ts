// Which raid is which when the guild runs more than one at once — the site's copy of
// utils/raidGroups.js (the bot's). The site imports nothing from outside web/ (the Vercel skip-build
// rule in CLAUDE.md), so the logic is ported; test/raid-groups.test.js runs both on the same rows
// and fails if they ever disagree. Read the bot file's header for the why; in short, each Mimic's
// LATEST raid_roster upload names its raid leader, and uploads naming the same leader are one raid.

export type RaidRosterRow = {
  name: string;
  rank: string | null;
  uploaded_by_discord_id: string | null;
  captured_at: string | null;
};

export type Raid<R extends RaidRosterRow = RaidRosterRow> = {
  key: string;            // lower-cased leader name, stable while the leader is
  leader: string;
  size: number;
  members: Map<string, R>;
  uploaders: string[];
  last_at: number;
};

export const RAID_LIVE_MS = 2 * 60 * 1000;
export const SAME_RAID_OVERLAP = 0.6;

// Zeal sends "Raid Leader" / "Group Leader"; the first readers looked for '2' / '1'.
export function isRaidLeader(rank: string | null | undefined): boolean {
  if (rank == null) return false;
  const s = String(rank).trim();
  return s === '2' || /^raid\s*leader$/i.test(s);
}
export function isGroupLeader(rank: string | null | undefined): boolean {
  if (rank == null) return false;
  const s = String(rank).trim();
  return s === '1' || /^group\s*leader$/i.test(s);
}

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : 0;
};

export function groupRaids<R extends RaidRosterRow>(
  rows: R[],
  opts: { now?: number; liveMs?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const liveMs = opts.liveMs ?? RAID_LIVE_MS;

  const latestAt = new Map<string, number>();
  for (const r of rows || []) {
    if (!r || !r.name) continue;
    const up = String(r.uploaded_by_discord_id || '');
    const t = ms(r.captured_at);
    if (!latestAt.has(up) || t > latestAt.get(up)!) latestAt.set(up, t);
  }
  const snaps = new Map<string, R[]>();
  for (const r of rows || []) {
    if (!r || !r.name) continue;
    const up = String(r.uploaded_by_discord_id || '');
    const last = latestAt.get(up)!;
    if (now - last > liveMs) continue;
    if (ms(r.captured_at) !== last) continue;
    if (!snaps.has(up)) snaps.set(up, []);
    snaps.get(up)!.push(r);
  }

  let raids: Raid<R>[] = [];
  const byKey = new Map<string, Raid<R>>();
  for (const [up, snap] of snaps) {
    const leaders = snap.filter(r => isRaidLeader(r.rank));
    if (leaders.length !== 1) continue;
    const key = String(leaders[0].name).toLowerCase();
    let raid = byKey.get(key);
    if (!raid) {
      raid = { key, leader: String(leaders[0].name), size: 0, members: new Map(), uploaders: [], last_at: 0 };
      byKey.set(key, raid);
      raids.push(raid);
    }
    raid.uploaders.push(up);
    raid.last_at = Math.max(raid.last_at, latestAt.get(up)!);
    for (const r of snap) {
      const k = String(r.name).toLowerCase();
      const prev = raid.members.get(k);
      if (!prev || ms(r.captured_at) > ms(prev.captured_at)) raid.members.set(k, r);
    }
  }

  for (let merged = true; merged && raids.length > 1;) {
    merged = false;
    outer:
    for (let i = 0; i < raids.length; i++) {
      for (let j = i + 1; j < raids.length; j++) {
        const a = raids[i], b = raids[j];
        let shared = 0;
        for (const k of a.members.keys()) if (b.members.has(k)) shared++;
        if (shared / Math.min(a.members.size, b.members.size) < SAME_RAID_OVERLAP) continue;
        const [keep, gone] = a.last_at >= b.last_at ? [a, b] : [b, a];
        for (const [k, r] of gone.members) {
          const prev = keep.members.get(k);
          if (!prev || ms(r.captured_at) > ms(prev.captured_at)) keep.members.set(k, r);
        }
        keep.uploaders.push(...gone.uploaders);
        raids = raids.filter(x => x !== gone);
        merged = true;
        break outer;
      }
    }
  }

  const raidOfName = new Map<string, Raid<R>>();
  for (const raid of raids) {
    for (const [k, r] of raid.members) {
      const cur = raidOfName.get(k);
      if (!cur || ms(r.captured_at) > ms(cur.members.get(k)!.captured_at)) raidOfName.set(k, raid);
    }
  }
  for (const raid of raids) {
    for (const k of [...raid.members.keys()]) if (raidOfName.get(k) !== raid) raid.members.delete(k);
    raid.size = raid.members.size;
  }
  raids = raids.filter(r => r.size > 0);
  raids.sort((a, b) => (b.size - a.size) || a.key.localeCompare(b.key));

  const raidOfUploader = new Map<string, Raid<R>>();
  for (const raid of raids) for (const up of raid.uploaders) raidOfUploader.set(up, raid);
  const raidForUploader = (id: string | null | undefined) => (id != null ? raidOfUploader.get(String(id)) : undefined) ?? null;
  const raidForName = (name: string | null | undefined) => (name ? raidOfName.get(String(name).toLowerCase()) : undefined) ?? null;
  return {
    raids,
    multi: raids.length > 1,
    raidForUploader,
    raidForName,
    raidFor: ({ discordId, character }: { discordId?: string | null; character?: string | null } = {}) =>
      raidForUploader(discordId) ?? raidForName(character),
  };
}
