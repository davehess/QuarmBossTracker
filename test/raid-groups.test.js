// test/raid-groups.test.js — which raid is which when two or more run at once (DECISIONS §124).
//
// The guild lead, 2026-10-01: two flagging raids, the second an hour after the first, and "mimic should
// be able to report up the raid structure from the Zeal pipe and if that varies from the rest of the
// raiders reporting we should be taking note". Each Mimic's LATEST raid_roster upload names its raid
// leader; uploads naming the same leader are one raid. The old clustering joined raids that shared any
// member across the 15-minute window, so one raider moving across made two raids one.
//
// utils/raidGroups.js (bot) and web/lib/raidGroups.ts (site) are the same logic twice; the parity block
// runs both on the same rows.
//
// Run: npx vitest run test/raid-groups.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as web from '../web/lib/raidGroups.ts';
import { readSource, BOT_INDEX, ROOT, stripJs } from './_source-slice.js';
import path from 'node:path';

const require = createRequire(import.meta.url);
const bot = require('../utils/raidGroups.js');

const NOW = Date.parse('2026-10-02T01:00:00Z');
const at = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
// One Mimic's upload: every row stamped with the same captured_at, as the bot writes them.
const upload = (uploader, secAgo, leader, others) => [
  { name: leader, rank: 'Raid Leader', uploaded_by_discord_id: uploader, captured_at: at(secAgo) },
  ...others.map((n) => ({ name: n, rank: null, uploaded_by_discord_id: uploader, captured_at: at(secAgo) })),
];
const A = ['Brackwyn', 'Corvale', 'Rethlan', 'Tamsk', 'Velka'];        // with Aldenmar leading
const B = ['Zarrin', 'Oswick', 'Pellan'];                               // with Nyssara leading

for (const [label, lib] of [['bot', bot], ['site', web]]) {
  describe(`${label}: groupRaids`, () => {
    it('Zeal\'s rank text marks the leaders; the old \'2\' / \'1\' codes still count', () => {
      expect(lib.isRaidLeader('Raid Leader')).toBe(true);
      expect(lib.isRaidLeader('2')).toBe(true);
      expect(lib.isRaidLeader('Group Leader')).toBe(false);
      expect(lib.isRaidLeader(null)).toBe(false);
      expect(lib.isGroupLeader('Group Leader')).toBe(true);
      expect(lib.isGroupLeader('1')).toBe(true);
      expect(lib.isGroupLeader('Raid Leader')).toBe(false);
    });

    it('one raid is one raid, however many Mimics report it', () => {
      const s = lib.groupRaids([...upload('u1', 3, 'Aldenmar', A), ...upload('u2', 1, 'Aldenmar', A)], { now: NOW });
      expect(s.multi).toBe(false);
      expect(s.raids.map((r) => [r.leader, r.size])).toEqual([['Aldenmar', 6]]);
    });

    it('two leaders are two raids, biggest first, and each requester finds their own', () => {
      const s = lib.groupRaids([
        ...upload('u1', 2, 'Aldenmar', A), ...upload('u2', 1, 'Aldenmar', A), ...upload('u3', 1, 'Nyssara', B),
      ], { now: NOW });
      expect(s.multi).toBe(true);
      expect(s.raids.map((r) => [r.leader, r.size])).toEqual([['Aldenmar', 6], ['Nyssara', 4]]);
      expect(s.raidFor({ discordId: 'u3' }).leader).toBe('Nyssara');
      expect(s.raidFor({ discordId: 'nobody', character: 'corvale' }).leader).toBe('Aldenmar');
      expect(s.raidFor({ discordId: 'nobody', character: 'Stranger' })).toBe(null);
    });

    it('a raider who moved to the other raid does not join the two (the old clustering did)', () => {
      // The upsert never deletes, so u1's row for Corvale (from before they moved) is still in the table,
      // just older than u1's latest upload, which no longer has them.
      const s = lib.groupRaids([
        ...upload('u1', 2, 'Aldenmar', A.filter((n) => n !== 'Corvale')),
        { name: 'Corvale', rank: null, uploaded_by_discord_id: 'u1', captured_at: at(90) },
        ...upload('u3', 1, 'Nyssara', [...B, 'Corvale']),
      ], { now: NOW });
      expect(s.multi).toBe(true);
      expect(s.raidForName('Corvale').leader).toBe('Nyssara');
      expect([...s.raidForUploader('u1').members.keys()]).not.toContain('corvale');
    });

    it('an upload over two minutes old has no say: a raid that ended is not a second raid', () => {
      const s = lib.groupRaids([...upload('u1', 2, 'Aldenmar', A), ...upload('u9', 300, 'Nyssara', B)], { now: NOW });
      expect(s.multi).toBe(false);
      expect(s.raids.map((r) => r.leader)).toEqual(['Aldenmar']);
    });

    it('a leader handing over mid-raid is one raid, named by the newest upload', () => {
      // u2's upload already has the new leader and is missing Velka for a moment (zoning); u1's has not
      // caught up. Without folding the two, Velka alone would read as a second raid.
      const s = lib.groupRaids([
        ...upload('u1', 4, 'Aldenmar', A),
        ...upload('u2', 1, 'Brackwyn', ['Aldenmar', 'Corvale', 'Rethlan', 'Tamsk']),
      ], { now: NOW });
      expect(s.multi).toBe(false);
      expect(s.raids.map((r) => [r.leader, r.size])).toEqual([['Brackwyn', 6]]);
    });

    it('only a Mimic\'s latest upload counts: a leader who camped out, and anyone who left, drop out', () => {
      // The upsert never deletes: u1's rows for Aldenmar (who led, then camped) and Velka (gone) are
      // still in the table, older than u1's latest upload.
      const s = lib.groupRaids([
        { name: 'Aldenmar', rank: 'Raid Leader', uploaded_by_discord_id: 'u1', captured_at: at(60) },
        { name: 'Velka', rank: null, uploaded_by_discord_id: 'u1', captured_at: at(60) },
        ...upload('u1', 1, 'Brackwyn', ['Corvale', 'Rethlan', 'Tamsk']),
      ], { now: NOW });
      expect(s.raids.map((r) => [r.leader, r.size])).toEqual([['Brackwyn', 4]]);
      expect(s.raidForName('Velka')).toBe(null);
    });

    it('an upload naming no leader (a group) or two (a torn frame) names no raid', () => {
      const noLeader = A.map((n) => ({ name: n, rank: null, uploaded_by_discord_id: 'u4', captured_at: at(1) }));
      const twoLeaders = upload('u5', 1, 'Nyssara', B).map((r) => (r.name === 'Zarrin' ? { ...r, rank: 'Raid Leader' } : r));
      const s = lib.groupRaids([...upload('u1', 1, 'Aldenmar', A), ...noLeader, ...twoLeaders], { now: NOW });
      expect(s.multi).toBe(false);
      expect(s.raidForUploader('u4')).toBe(null);
      expect(s.raidForUploader('u5')).toBe(null);
    });
  });
}

describe('the bot and the site agree', () => {
  const cases = [
    [...upload('u1', 2, 'Aldenmar', A), ...upload('u3', 1, 'Nyssara', B)],
    [...upload('u1', 4, 'Aldenmar', A), ...upload('u2', 1, 'Brackwyn', ['Aldenmar', ...A.slice(1)])],
    [...upload('u1', 2, 'Aldenmar', A.slice(0, 2)), ...upload('u3', 1, 'Nyssara', [...B, 'Brackwyn'])],
    [...upload('u1', 200, 'Aldenmar', A), ...upload('u3', 1, 'Nyssara', B)],
  ];
  const shape = (s) => ({
    multi: s.multi,
    raids: s.raids.map((r) => ({ key: r.key, leader: r.leader, size: r.size, members: [...r.members.keys()].sort(), uploaders: [...r.uploaders].sort() })),
  });
  it.each(cases.map((c, i) => [i, c]))('case %i', (_i, rows) => {
    expect(shape(web.groupRaids(rows, { now: NOW }))).toEqual(shape(bot.groupRaids(rows, { now: NOW })));
  });
});

describe('the bot scopes by raid only when there are two or more', () => {
  const src = stripJs(readSource(BOT_INDEX));
  it('the buff queue keeps the requester\'s raid members, and says which raids exist', () => {
    expect(src).toMatch(/const myRaid = raidSplit\.multi \? raidSplit\.raidFor\(\{ discordId: identity\.discord_id, character: bufferCharacter \}\) : null;/);
    expect(src).toMatch(/if \(myRaid && !myRaid\.members\.has\(k\)\) continue;/);
    expect(src).toMatch(/if \(raidSplit\.multi\) out\.raids = raidSplit\.raids\.map/);
  });
  it('Extended Target drops the other raid\'s raiders, keeps raiders in no raid, and says which raids exist', () => {
    expect(src).toMatch(/const myRaid = raidSplit\.multi \? raidSplit\.raidFor\(\{ discordId: identity\.discord_id, character: selfChar \}\) : null;/);
    expect(src).toMatch(/return !theirs \|\| theirs === myRaid;/);
    expect(src).toMatch(/if \(raidSplit\.multi\) extOut\.raids = raidSplit\.raids\.map/);
  });
  it('the site reads raid membership from the same grouping, and the crowns from Zeal\'s rank text', () => {
    const page = stripJs(readSource(path.join(ROOT, 'web/app/raid/page.tsx')));
    const view = stripJs(readSource(path.join(ROOT, 'web/app/raid/RaidView.tsx')));
    expect(page).toMatch(/const raidSplit = groupRaids\(rosterClean\);/);
    expect(view).not.toMatch(/rank === '[12]'/);
    expect(view).toMatch(/isRaidLeader\(row\.rank\) && '👑 '/);
  });
});
