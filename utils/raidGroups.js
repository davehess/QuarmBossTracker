// utils/raidGroups.js — which raid is which, when the guild runs more than one at once.
//
// The guild lead, 2026-10-01: "earlier tonight we had two concurrent raids running for flagging our
// members. the second raid started nearly an hour or so after the first one. mimic should be able to
// report up the raid structure from the Zeal pipe and if that varies from the rest of the raiders
// reporting we should be taking note." docs/DESIGN-multi-raid.md is the contract (§2 identity, §3 the
// single-raid path stays as it is); DECISIONS-2026-09-21.md §124 records what shipped.
//
// Every Mimic uploads its raid window (Zeal type 5) to raid_roster, and every row of one upload carries
// the same captured_at. So an uploader's LATEST upload is the raid they are in now, and its
// "Raid Leader" row names that raid: uploaders naming the same leader read the same raid window.
//
// Why not member overlap, which /raid and the buff queue used: raid_roster rows are upserted, never
// deleted, so a raider who moves from one raid to the other stays in the first raid's uploads for the
// 15-minute read window. One move joined the two raids into one for 15 minutes, and that night several
// raiders moved (measured 2026-10-01: 6 uploaders held both leaders' rows).
//
// Pure — no I/O. The bot (index.js) and the site (web/lib/raidGroups.ts, a port kept in step by
// test/raid-groups.test.js) both call it on the rows they already read.

// An uploader whose latest upload is older than this has left the raid or closed Mimic: it has no say
// in which raids exist. Live uploaders send at least every few seconds while the raid window is open.
const RAID_LIVE_MS = 2 * 60 * 1000;
// Two raids whose members are mostly the same are one raid caught mid leader-change: for a few seconds
// some uploads name the old leader and some the new one (DESIGN-multi-raid.md §2, the 60% rule).
const SAME_RAID_OVERLAP = 0.6;

// Zeal sends the rank as text: "Raid Leader", "Group Leader", or nothing. The first readers were
// written for '2' / '1' and never matched (measured 2026-10-01: 48 "Raid Leader" rows, 0 '2'), so
// the crown never showed. Both spellings are accepted.
function isRaidLeader(rank) {
  if (rank == null) return false;
  const s = String(rank).trim();
  return s === '2' || /^raid\s*leader$/i.test(s);
}
function isGroupLeader(rank) {
  if (rank == null) return false;
  const s = String(rank).trim();
  return s === '1' || /^group\s*leader$/i.test(s);
}

const _ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

// rows: raid_roster rows with at least { name, rank, uploaded_by_discord_id, captured_at }.
// Returns { raids, multi, raidForUploader(id), raidForName(name), raidFor({ discordId, character }) }.
//   raids: biggest first, each { key, leader, size, members: Map(lower → row), uploaders: [id], last_at }
//   multi: two or more live raids. With one (or none) every caller keeps its old code path.
function groupRaids(rows, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const liveMs = opts.liveMs != null ? opts.liveMs : RAID_LIVE_MS;

  const latestAt = new Map();          // uploader → newest captured_at (ms)
  for (const r of rows || []) {
    if (!r || !r.name) continue;
    const up = String(r.uploaded_by_discord_id || '');
    const t = _ms(r.captured_at);
    if (!latestAt.has(up) || t > latestAt.get(up)) latestAt.set(up, t);
  }
  const snaps = new Map();             // uploader → rows of its latest upload
  for (const r of rows || []) {
    if (!r || !r.name) continue;
    const up = String(r.uploaded_by_discord_id || '');
    const last = latestAt.get(up);
    if (now - last > liveMs) continue;
    if (_ms(r.captured_at) !== last) continue;
    if (!snaps.has(up)) snaps.set(up, []);
    snaps.get(up).push(r);
  }

  // One raid per named leader. An upload naming no leader (a group, an old Zeal) or two (a torn
  // frame) has no say; its rows still reach every caller through the old path.
  let raids = [];
  const byKey = new Map();
  for (const [up, snap] of snaps) {
    const leaders = snap.filter(r => isRaidLeader(r.rank));
    if (leaders.length !== 1) continue;
    const key = String(leaders[0].name).toLowerCase();
    let raid = byKey.get(key);
    if (!raid) {
      raid = { key, leader: String(leaders[0].name), members: new Map(), uploaders: [], last_at: 0 };
      byKey.set(key, raid);
      raids.push(raid);
    }
    raid.uploaders.push(up);
    raid.last_at = Math.max(raid.last_at, latestAt.get(up));
    for (const r of snap) {
      const k = String(r.name).toLowerCase();
      const prev = raid.members.get(k);
      if (!prev || _ms(r.captured_at) > _ms(prev.captured_at)) raid.members.set(k, r);
    }
  }

  // Mid leader-change: fold a raid into one sharing most of its members. The newest upload's
  // leader names the result.
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
          if (!prev || _ms(r.captured_at) > _ms(prev.captured_at)) keep.members.set(k, r);
        }
        keep.uploaders.push(...gone.uploaders);
        raids = raids.filter(x => x !== gone);
        merged = true;
        break outer;
      }
    }
  }

  // A raider in two raids' uploads (they moved in the last few seconds) belongs to the raid whose
  // upload saw them last.
  const raidOfName = new Map();
  for (const raid of raids) {
    for (const [k, r] of raid.members) {
      const cur = raidOfName.get(k);
      if (!cur || _ms(r.captured_at) > _ms(cur.members.get(k).captured_at)) raidOfName.set(k, raid);
    }
  }
  for (const raid of raids) {
    for (const k of [...raid.members.keys()]) if (raidOfName.get(k) !== raid) raid.members.delete(k);
    raid.size = raid.members.size;
  }
  raids = raids.filter(r => r.size > 0);
  raids.sort((a, b) => (b.size - a.size) || a.key.localeCompare(b.key));

  const raidOfUploader = new Map();
  for (const raid of raids) for (const up of raid.uploaders) raidOfUploader.set(up, raid);
  const raidForUploader = (id) => (id != null ? raidOfUploader.get(String(id)) : null) || null;
  const raidForName = (name) => (name ? raidOfName.get(String(name).toLowerCase()) : null) || null;
  return {
    raids,
    multi: raids.length > 1,
    raidForUploader,
    raidForName,
    // The requester's own upload names their raid; failing that, the raid their character is in.
    raidFor: ({ discordId, character } = {}) => raidForUploader(discordId) || raidForName(character),
  };
}

// The compact form agents and pages get: no rows, just enough to say which raid is whose.
function raidSummary(raid, mine) {
  return { key: raid.key, leader: raid.leader, size: raid.size, mine: !!mine };
}

module.exports = { groupRaids, raidSummary, isRaidLeader, isGroupLeader, RAID_LIVE_MS, SAME_RAID_OVERLAP };
