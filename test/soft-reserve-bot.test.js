// test/soft-reserve-bot.test.js — Soft Reserve per raid, the bot half (the guild lead, 2026-10-26; DECISIONS §448).
//
// Everything that is pure runs for real: the reserver line, the roll ranking (reserver rolled / nobody rolled / N
// copies / a pass), the roll sessions and the card text built from them, the loot embed, the lookup against a fake
// Supabase, and the TS twin (web/lib/rolls.ts) on the SAME cases as the JS one. The commands and the monolith only
// import discord.js and the database, so their wiring is read as comment-stripped source (comments quote the code
// and would answer for it).
//
// Names are invented. Run: npx vitest run test/soft-reserve-bot.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, BOT_INDEX } from './_source-slice.js';
import { rankWithReservers as rankTs, mergeRollSets } from '../web/lib/rolls.ts';
import { shownOn as shownOnTs, normalizeRules as normalizeRulesTs } from '../web/lib/softReserve.ts';

const require_ = createRequire(BOT_INDEX);
const SR = require_('./utils/softReserve');
const { buildRollSessions, renderRollLootLines, itemsMatch } = require_('./utils/rollLoot');
const { buildLootAnnounceEmbed } = require_('./utils/loot');

const src = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// First-roll-per-player entries, best first.
const ranked = [
  { name: 'Corvale', value: 981 },
  { name: 'Aldenmar', value: 940 },
  { name: 'Brackwyn', value: 700 },
  { name: 'Nyssara', value: 410 },
  { name: 'Zarrin', value: 120 },
];

describe('the reserver line', () => {
  it('names the reservers with a count', () => {
    expect(SR.reserverLine(['Aldenmar', 'Brackwyn'])).toBe('⭐ Soft Reserve (2): Aldenmar, Brackwyn');
  });
  it('caps the names at 8 and says how many more', () => {
    const names = Array.from({ length: 11 }, (_, i) => `Raider${i + 1}`);
    const line = SR.reserverLine(names);
    expect(line).toBe(`⭐ Soft Reserve (11): ${names.slice(0, 8).join(', ')} +3 more`);
    expect(line).not.toMatch(/Raider9/);
  });
  it('shows only a count when names are withheld, and nothing when nobody reserved', () => {
    expect(SR.reserverLine(['Aldenmar', 'Brackwyn'], 'counts')).toBe('⭐ Soft Reserve (2)');
    expect(SR.reserverLine([])).toBeNull();
    expect(SR.reserverLine(['Aldenmar'], 'none')).toBeNull();
  });
});

describe('rolls with Soft Reserve', () => {
  it('nobody reserved: plain ranking, no sr', () => {
    const r = SR.rankWithReservers(ranked, 1, null);
    expect(r.winners.map(w => w.name)).toEqual(['Corvale']);
    expect(r.sr).toBeNull();
  });
  it('a reserver rolled: only reservers\' rolls count, even a lower one', () => {
    const r = SR.rankWithReservers(ranked, 1, ['Brackwyn', 'Zarrin']);
    expect(r.winners.map(w => w.name)).toEqual(['Brackwyn']);
    expect(r.sr).toEqual({ reservers: 2, rolled: 2, ignored: [{ name: 'Corvale', value: 981 }] });
  });
  it('no reserver rolled (they all passed): everyone counts', () => {
    const r = SR.rankWithReservers(ranked, 1, ['Rethlan']);
    expect(r.winners.map(w => w.name)).toEqual(['Corvale']);
    expect(r.sr).toEqual({ reservers: 1, rolled: 0, ignored: [] });
  });
  it('a reserver who passes sends it to the next reserver', () => {
    const r = SR.rankWithReservers(ranked.filter(x => x.name !== 'Brackwyn'), 1, ['Brackwyn', 'Zarrin']);
    expect(r.winners.map(w => w.name)).toEqual(['Zarrin']);
  });
  it('N copies: the top N rolls among reservers win', () => {
    const r = SR.rankWithReservers(ranked, 2, ['Aldenmar', 'Brackwyn', 'Nyssara']);
    expect(r.winners.map(w => w.name)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(r.sr.rolled).toBe(3);
    expect(r.sr.ignored).toEqual([{ name: 'Corvale', value: 981 }]);
  });
  it('more copies than reservers: the rest go to the raid by roll', () => {
    const r = SR.rankWithReservers(ranked, 3, ['Nyssara']);
    expect(r.winners.map(w => w.name)).toEqual(['Nyssara', 'Corvale', 'Aldenmar']);
    // Brackwyn was third in the plain ranking and lost that copy to the reserver.
    expect(r.sr.ignored).toEqual([{ name: 'Brackwyn', value: 700 }]);
  });
  it('matches names without regard to case', () => {
    expect(SR.rankWithReservers(ranked, 1, ['nyssara']).winners[0].name).toBe('Nyssara');
  });
});

describe('the TS twin ranks the same as the JS one', () => {
  const cases = [
    [1, null], [1, []], [1, ['Brackwyn', 'Zarrin']], [1, ['Rethlan']], [2, ['Aldenmar', 'Brackwyn', 'Nyssara']],
    [3, ['Nyssara']], [2, ['Corvale', 'Aldenmar']], [5, ['Zarrin']], [1, ['nyssara']],
  ];
  for (const [n, reservers] of cases) {
    it(`n=${n} reservers=${JSON.stringify(reservers)}`, () => {
      expect(rankTs(ranked, n, reservers)).toEqual(SR.rankWithReservers(ranked, n, reservers));
    });
  }
  it('merged roll sessions agree on winners and sr, uploader rows and all', () => {
    const t0 = '2026-10-29T01:10:00.000Z';
    const rows = [{
      roll_from: 0, roll_to: 1000, item: 'Circle of Rotting Flesh', qty: 2, zone: 'Crypt of Decay',
      started_at: t0, last_at: '2026-10-29T01:10:40.000Z',
      rolls: ranked.map((r, i) => ({ name: r.name, value: r.value, at: new Date(Date.parse(t0) + i * 1000).toISOString() })),
    }];
    const reservers = ['Brackwyn', 'Nyssara', 'Zarrin'];
    const forJs = SR.makeReserversFor(
      { byItem: new Map([[10241, reservers]]), itemNames: new Map([[10241, 'Circle of Rotting Flesh']]) }, itemsMatch);
    const js = buildRollSessions(rows, [], forJs);
    const ts = mergeRollSets(rows, (item) => (item === 'Circle of Rotting Flesh' ? reservers : null));
    expect(js).toHaveLength(1);
    expect(ts).toHaveLength(1);
    expect(js[0].winners).toEqual(ts[0].winners);
    expect(js[0].winners.map(w => w.name)).toEqual(['Brackwyn', 'Nyssara']);
    expect(js[0].sr).toEqual(ts[0].sr);
  });
  it('no lookup leaves the sessions as they were', () => {
    const rows = [{ roll_from: 0, roll_to: 100, item: 'Cloak of Flames', qty: 1, zone: null,
      started_at: '2026-10-29T01:10:00.000Z', last_at: null,
      rolls: [{ name: 'Corvale', value: 88, at: '2026-10-29T01:10:05.000Z' }, { name: 'Rethlan', value: 41, at: '2026-10-29T01:10:06.000Z' }] }];
    const js = buildRollSessions(rows, []);
    expect(js[0].winners).toEqual([{ name: 'Corvale', value: 88 }]);
    expect(js[0].sr).toBeNull();
    expect(mergeRollSets(rows)[0].sr).toBeUndefined();
  });
  it('the rules twins agree on who sees what and on a bad row', () => {
    for (const v of ['names', 'counts', 'hidden']) for (const s of ['page', 'card', 'officer']) expect(SR.shownOn(v, s)).toBe(shownOnTs(v, s));
    const bad = { visibility: 'all', lock_mode: 'later', locked: 'yes', npc_ids: [5, 'x'] };
    const a = SR.normalizeRules(bad), b = normalizeRulesTs(bad);
    expect([a.visibility, a.lock_mode, a.locked, a.npc_ids]).toEqual([b.visibility, b.lock_mode, b.locked, b.npc_ids]);
  });
});

describe('the rolled-loot card', () => {
  const t0 = '2026-10-29T01:10:00.000Z';
  const rows = [{
    roll_from: 0, roll_to: 1000, item: 'Circle of Rotting Flesh', qty: 1, zone: null, started_at: t0, last_at: null,
    rolls: ranked.map((r, i) => ({ name: r.name, value: r.value, at: new Date(Date.parse(t0) + i * 1000).toISOString() })),
  }];
  const sr = { byItem: new Map([[10241, ['Brackwyn', 'Zarrin']]]), itemNames: new Map([[10241, 'Circle of Rotting Flesh']]) };
  it('says how many reservers rolled and whose rolls it set aside', () => {
    const lines = renderRollLootLines(buildRollSessions(rows, [], SR.makeReserversFor(sr, itemsMatch)));
    expect(lines[0]).toMatch(/🏆 \*\*Brackwyn\*\* \(700\)/);
    expect(lines[0]).toMatch(/⭐ SR · 2 of 2 rolled/);
    expect(lines[0]).toMatch(/Ignored: Corvale \(981\) · Aldenmar \(940\)|Ignored: Corvale \(981\)/);
  });
  it('an item nobody reserved renders exactly as before', () => {
    const lines = renderRollLootLines(buildRollSessions(rows, []));
    expect(lines[0]).not.toMatch(/SR|Ignored/);
    expect(lines[0]).toMatch(/\*\*Corvale\*\* \(981\)/);
  });
});

describe('the loot card', () => {
  const items = (reservers, srShown) => [
    { gameItemId: 10241, name: 'Circle of Rotting Flesh', quantity: 1, rarityLabel: null, dropChance: null, reservers, srShown },
    { gameItemId: 9469, name: 'Radiant Mask of the Disease Lord', quantity: 1, rarityLabel: null, dropChance: null },
  ];
  const text = (embed) => `${embed.data.description}\n${embed.data.fields.map(f => `${f.name}\n${f.value}`).join('\n')}`;
  it('adds the line under the item and the note under Bidding', () => {
    const t = text(buildLootAnnounceEmbed(items(['Aldenmar', 'Brackwyn'], 'names'), 'Bertoxxulous', 3));
    expect(t).toMatch(/Circle of Rotting Flesh[^\n]*\n {2}↳ ⭐ Soft Reserve \(2\): Aldenmar, Brackwyn/);
    expect(t).toMatch(/Reservers bid first; an officer settles\./);
    expect(t.match(/Soft Reserve/g)).toHaveLength(1);
  });
  it('a hidden raid shows only the count', () => {
    const t = text(buildLootAnnounceEmbed(items(['Aldenmar', 'Brackwyn'], 'counts'), null, 3));
    expect(t).toMatch(/⭐ Soft Reserve \(2\)(?!:)/);
    expect(t).not.toMatch(/Aldenmar/);
  });
  it('with no reservers the card is unchanged', () => {
    const t = text(buildLootAnnounceEmbed(items(undefined), null, 3));
    expect(t).not.toMatch(/Soft Reserve|Reservers bid first/);
  });
});

describe('applying reservers to a /loot paste', () => {
  const rules = SR.normalizeRules({ visibility: 'counts' });
  it('marks reserved items by game item id, and shows what the visibility allows on a public card', () => {
    const its = [{ gameItemId: 10241, name: 'a' }, { gameItemId: 99, name: 'b' }];
    const n = SR.applyReservers(its, { rules, byItem: new Map([[10241, ['Aldenmar']]]) });
    expect(n).toBe(1);
    expect(its[0].reservers).toEqual(['Aldenmar']);
    expect(its[0].srShown).toBe('names');
    expect(its[1].reservers).toBeUndefined();
    const hidden = [{ gameItemId: 10241, name: 'a' }];
    SR.applyReservers(hidden, { rules: SR.normalizeRules({ visibility: 'hidden' }), byItem: new Map([[10241, ['Aldenmar']]]) });
    expect(hidden[0].srShown).toBe('counts');
  });
  it('isReserver is case-insensitive', () => {
    expect(SR.isReserver({ reservers: ['Aldenmar'] }, 'aldenmar')).toBe(true);
    expect(SR.isReserver({ reservers: ['Aldenmar'] }, 'Brackwyn')).toBe(false);
    expect(SR.isReserver({}, 'Brackwyn')).toBe(false);
  });
});

describe('loading an event\'s Soft Reserve', () => {
  const fake = ({ rules = [{ enabled: true, visibility: 'counts', lock_mode: 'start', locked: false, npc_ids: [] }], picks = [], rh = [] } = {}) => {
    const calls = { upserts: [], selects: [] };
    return {
      calls,
      isEnabled: () => true,
      guildId: () => 'wolfpack',
      select: async (table, q) => {
        calls.selects.push([table, q]);
        if (table === 'rh_events') return rh;
        if (table === 'sr_rules') return rules;
        if (table === 'eqemu_items') return [{ id: 10241, name: 'Circle of Rotting Flesh' }];
        return [];
      },
      selectAllPaged: async () => picks,
      upsert: async (table, rows, onConflict) => { calls.upserts.push([table, rows, onConflict]); return true; },
    };
  };
  const picks = [
    { character_name: 'Brackwyn', npc_id: 200226, item_id: 10241 },
    { character_name: 'Aldenmar', npc_id: 200226, item_id: 10241 },
    { character_name: 'aldenmar', npc_id: 200226, item_id: 10241 },
  ];

  it('an `rh:` event id is used as it is, without reading rh_events', async () => {
    const sb = fake({ picks });
    const sr = await SR.loadSoftReserve({ id: 'rh:1563158884451876948', startMs: 0 }, sb);
    expect(sr.eventId).toBe('1563158884451876948');
    expect(sb.calls.selects.some(([t]) => t === 'rh_events')).toBe(false);
    expect(sr.byItem.get(10241)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(sr.itemNames.get(10241)).toBe('Circle of Rotting Flesh');
  });
  it('a Discord event id is matched to its Raid-Helper twin by start time, nearest first', async () => {
    const start = Date.parse('2026-10-29T00:30:00Z');
    const sb = fake({ picks, rh: [
      { id: 'far', start_time: new Date(start + 20 * 60000).toISOString() },
      { id: 'near', start_time: new Date(start + 2 * 60000).toISOString() },
    ] });
    expect(await SR.rhEventId({ id: '123456', startMs: start }, sb)).toBe('near');
    const q = sb.calls.selects.find(([t]) => t === 'rh_events')[1];
    expect(q).toMatch(/start_time=gte\./);
    expect(q).toMatch(/start_time=lte\./);
  });
  it('Soft Reserve off for the event: nothing', async () => {
    const sb = fake({ rules: [{ enabled: false }], picks });
    expect(await SR.loadSoftReserve({ id: 'rh:1', startMs: 0 }, sb)).toBeNull();
  });
  it('no event, or a database that throws: nothing, and no throw', async () => {
    expect(await SR.loadSoftReserve(null, fake())).toBeNull();
    const bad = { ...fake(), select: async () => { throw new Error('down'); } };
    expect(await SR.loadSoftReserve({ id: 'rh:1', startMs: 0 }, bad)).toBeNull();
  });
  it('first_loot: the first /loot post locks picks, once, and no other mode does', async () => {
    const sb = fake({ rules: [{ enabled: true, lock_mode: 'first_loot', locked: false }], picks });
    const sr = await SR.loadSoftReserve({ id: 'rh:1', startMs: 0 }, sb);
    expect(await SR.lockOnFirstLoot(sr, sb)).toBe(true);
    expect(sb.calls.upserts).toHaveLength(1);
    expect(sb.calls.upserts[0][0]).toBe('sr_rules');
    expect(sb.calls.upserts[0][1][0]).toMatchObject({ event_id: '1', locked: true });
    expect(sb.calls.upserts[0][2]).toBe('event_id');
    expect(await SR.lockOnFirstLoot(sr, sb)).toBe(false);
    expect(sb.calls.upserts).toHaveLength(1);
    for (const lock_mode of ['start', 'time', 'manual']) {
      const sb2 = fake({ rules: [{ enabled: true, lock_mode, locked: false }], picks });
      const sr2 = await SR.loadSoftReserve({ id: 'rh:1', startMs: 0 }, sb2);
      expect(await SR.lockOnFirstLoot(sr2, sb2)).toBe(false);
      expect(sb2.calls.upserts).toHaveLength(0);
    }
  });
});

describe('the wiring', () => {
  it('/loot looks the event up after enrichLootItems, marks the items, then builds the card', () => {
    const s = src('commands/loot.js');
    const enrich = s.indexOf('enrichLootItems(parsedItems');
    const apply = s.indexOf('SR.applyReservers(enrichedItems');
    const build = s.indexOf('buildLootAnnounceEmbed(enrichedItems');
    expect(enrich).toBeGreaterThan(0);
    expect(apply).toBeGreaterThan(enrich);
    expect(build).toBeGreaterThan(apply);
    expect(s).toMatch(/getRaidNightTarget\(interaction\.client, Date\.now\(\)\)/);
    expect(s).toMatch(/SR\.lockOnFirstLoot\(softReserve/);
  });
  it('the officer wishlist list puts reservers first', () => {
    const s = src('commands/loot.js');
    expect(s).toMatch(/Number\(b\._sr\) - Number\(a\._sr\) \|\| b\._eff - a\._eff/);
  });
  it('the Mimic loot post carries the same line', () => {
    const s = src('index.js');
    expect(s).toMatch(/_sr\.loadSoftReserve\(_t\.event/);
    expect(s).toMatch(/_sr\.reserverLine\(m\.reservers, m\.srShown/);
  });
  it('the event roll card ranks with Soft Reserve', () => {
    const s = src('index.js');
    expect(s).toMatch(/buildRollSessions\(ourRollRows, lootedRows \|\| \[\], _sr\.makeReserversFor\(_srData, _rollItemsMatch\)\)/);
  });
  it('the bot version and its changelog moved together', () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    // Pinned to "the changelog has the current version", not to one number, so the next bump does not break it.
    expect(fs.readFileSync(path.join(ROOT, 'utils/onboarding.js'), 'utf8')).toContain(`'${v}': [`);
  });
});
