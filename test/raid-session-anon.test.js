// test/raid-session-anon.test.js — an opted-out raider is their CLASS on the raid session review and the public share
// page, and a bid winner is never anonymized (the guild lead, 2026-10-17: "if someone opts out, just put their class on
// that spot to anonymize them. do not anonymize bid winners, but link all of those with a unique handle that shows
// what they all bid on").
//
//   1. LABELS     "<Class> <n>": class-based, deterministic, numbered by a salted opaque key (never by name),
//                 "Raider <n>" when the class is unknown, a pet takes its owner's label.
//   2. SUBSTITUTION  the loaders hand the browser labels, never the name: bundle, a fight's parse, a replay row.
//   3. WINNERS    anyone who won in the window is shown by name even when opted out, in every one of those.
//   4. BIDS       the winners' view lists wins plus CLOSED losing bids, never an open auction, and reads bids only
//                 for closed auction ids.
//   5. CACHE      a cached review is rebuilt when the opt-outs change, so an opt-out leaves within the minute.
//   6. SOURCE     the routes pass the window to the labeller; the page carries no name in a tooltip or attribute.
//
// Source assertions run on comment-stripped text (stripJs): this repo's comments explain exactly the behaviour
// under test, so a match on raw text would pass on the comment alone.
//
// Run: npx vitest run test/raid-session-anon.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { makeWindow } from '../web/lib/raidShare.ts';
import { MINUTE_MS, decodeMinute } from '../web/lib/raidReplay.ts';
import {
  anonLabels, anonName, anonSig, exemptWinners, opaqueKey, scrubMinuteData, attendanceFromMinutes, buildKills,
} from '../web/lib/raidSession.ts';
import { buildBidders, winnerKeys, winsOf, loadBidders, clearWinnerMemo } from '../web/lib/raidSessionBids.ts';
import { loadAnon, clearOptedOutCache } from '../web/lib/raidShareLookup.ts';
import { loadSessionReview } from '../web/lib/raidSessionLoad.ts';
import { loadFightParse } from '../web/lib/raidSessionParse.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const hasOp = (q, name, ...args) => q.ops.some(o => o[0] === name && args.every((a, i) => o[i + 1] === a));

// A recording fake of the slice of PostgREST the code uses (the same one test/raid-share.test.js drives): every
// chained call is logged; awaiting hands back the table's canned rows. Filters are NOT applied, so a test that
// needs a filter to bite proves it on the logged ops.
function fakeDb(tables = {}) {
  const queries = [];
  return {
    queries,
    from(table) {
      const q = { table, ops: [] };
      queries.push(q);
      const rec = (op) => (...args) => { q.ops.push([op, ...args]); return b; };
      const b = {
        select: rec('select'), eq: rec('eq'), is: rec('is'), not: rec('not'), or: rec('or'), in: rec('in'),
        gte: rec('gte'), lt: rec('lt'), order: rec('order'), range: rec('range'), limit: rec('limit'),
        maybeSingle() { q.ops.push(['maybeSingle']); return Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null }); },
        then(res, rej) { return Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej); },
      };
      return b;
    },
  };
}

beforeEach(() => { clearOptedOutCache(); clearWinnerMemo(); });

const T0 = Date.parse('2026-10-14T13:08:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-10-18T00:00:00.000Z');
const PAST = iso(T0 + 30 * MINUTE_MS);
const FUTURE = '2999-01-01T00:00:00.000Z';

// ── 1. LABELS ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the label: "<Class> <n>"', () => {
  const clerics = ['Aaron', 'Bella', 'Cedric', 'Dana', 'Edric', 'Fenna', 'Garin', 'Hilda', 'Ivor', 'Jenna', 'Kell', 'Lora'];
  const rows = [
    ...clerics.map(name => ({ name, class: 'Cleric', exclude_from_stats: true })),
    { name: 'Mox', class: 'Shadow Knight', exclude_inventory: true },
    { name: 'Nyx', class: 'Shadow Knight', exclude_from_stats: true },
    { name: 'Orrin', class: null, exclude_from_stats: true },
    { name: 'Pell', class: '   ', exclude_from_stats: true },
    { name: 'Visible', class: 'Cleric', exclude_from_stats: false, exclude_inventory: false },
  ];

  it('is the class and a number counted within the class, from 1', () => {
    const m = anonLabels(rows, 'salt');
    expect(m.size).toBe(clerics.length + 4);   // Visible has neither flag
    expect(m.has('visible')).toBe(false);
    const nums = clerics.map(n => Number(m.get(n.toLowerCase()).label.replace('Cleric ', ''))).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(m.get('mox').label).toMatch(/^Shadow Knight [12]$/);
    expect(new Set([m.get('mox').label, m.get('nyx').label]).size).toBe(2);
    expect(m.get('mox').cls).toBe('Shadow Knight');
  });
  it('falls back to "Raider <n>" when the class is unknown or blank, numbered together', () => {
    const m = anonLabels(rows, 'salt');
    expect([m.get('orrin').label, m.get('pell').label].sort()).toEqual(['Raider 1', 'Raider 2']);
    expect(m.get('orrin').cls).toBeNull();
  });
  it('is deterministic: the same people give the same labels whatever order the rows arrive in', () => {
    const a = anonLabels(rows, 'salt');
    const b = anonLabels(rows.slice().reverse(), 'salt');
    expect([...a].sort()).toEqual([...b].sort());
    expect(anonSig(a)).toBe(anonSig(b));
  });
  it('numbers by the salted opaque key, NOT by name: it is not alphabetical, and the salt changes it', () => {
    const labelOf = (salt) => clerics.map(n => Number(anonLabels(rows, salt).get(n.toLowerCase()).label.replace('Cleric ', '')));
    const alphabetical = clerics.map((_, i) => i + 1);
    expect(labelOf('salt')).not.toEqual(alphabetical);
    expect(labelOf('salt')).not.toEqual(alphabetical.slice().reverse());
    expect(labelOf('another salt')).not.toEqual(labelOf('salt'));
    // and the number IS the rank of the opaque key
    const byKey = clerics.slice().sort((a, b) => (opaqueKey('salt', a.toLowerCase()) < opaqueKey('salt', b.toLowerCase()) ? -1 : 1));
    byKey.forEach((n, i) => expect(anonLabels(rows, 'salt').get(n.toLowerCase()).label).toBe(`Cleric ${i + 1}`));
  });
  it('a pet takes its owner\'s label; a name that is not opted out is untouched; no map changes nothing', () => {
    const m = anonLabels([{ name: 'Hushed', class: 'Wizard', exclude_from_stats: true }]);
    expect(anonName(m, 'Hushed')).toBe('Wizard 1');
    expect(anonName(m, 'hushed`s pet')).toBe('Wizard 1`s pet');
    expect(anonName(m, 'Aldenmar')).toBe('Aldenmar');
    expect(anonName(new Map(), 'Hushed')).toBe('Hushed');
  });
  it('exemptWinners takes the winners out of the map and leaves the rest', () => {
    const m = anonLabels([{ name: 'Hushed', class: 'Wizard', exclude_from_stats: true }, { name: 'Quiet', class: 'Monk', exclude_from_stats: true }]);
    const e = exemptWinners(m, new Set(['hushed']));
    expect(anonName(e, 'Hushed')).toBe('Hushed');
    expect(anonName(e, 'Quiet')).toBe('Monk 1');
    expect(m.has('hushed')).toBe(true);   // the base map is not changed
  });
});

// ── fixtures shared by the loader tests ──────────────────────────────────────────────────────────────────────
// Hushed (Wizard, opted out of stats, OpenDKP id 7), Quietone (Monk, opted out of inventory, id 8), Brackwyn (Cleric, id 9).
const minuteData = JSON.stringify({
  v: 1, step_s: 3, zones: ['x'],
  who: [['Aldenmar', 'Cleric', 1, 60], ['Hushed', 'Wizard', 1, 60], ['Quietone', 'Monk', 2, 60]],
  f: [[0, 0, 1, 2, 3, 4, 90, 0, 1, 5, 6, 7, 8, 80, 0, 2, 9, 9, 9, 9, 70, 0]],
});
const characters = () => [
  { name: 'Hushed', class: 'Wizard', exclude_from_stats: true, exclude_inventory: false, opendkp_id: 7 },
  { name: 'Quietone', class: 'Monk', exclude_from_stats: false, exclude_inventory: true, opendkp_id: 8 },
  { name: 'Brackwyn', class: 'Cleric', exclude_from_stats: false, exclude_inventory: false, opendkp_id: 9 },
];
const dbWith = (W, extra = {}) => fakeDb({
  characters: characters(),
  raid_track_minutes: [{ minute_at: iso(W.fromMs), night_key: '10/14/2026', zones: ['x'], raiders: 3, data: minuteData }],
  encounters: [{ id: 'e1', npc_id: 5, started_at: iso(W.fromMs), ended_at: iso(W.fromMs), duration_sec: 30, total_damage: 100, zone_short: 'x', eqemu_npc_types: { name: 'A_Mob' } }],
  bosses_local: [{ npc_id: 5 }],
  encounter_players: [
    { encounter_id: 'e1', character_name: 'Aldenmar', total_damage: 90, dps: 3 },
    { encounter_id: 'e1', character_name: 'Hushed', total_damage: 99, dps: 4 },
    { encounter_id: 'e1', character_name: 'Quietone', total_damage: 50, dps: 2 },
  ],
  looted_items: [{ looter_character: 'Quietone', item_name: 'Rusty Helm', zone: 'x', looted_at: iso(W.fromMs) }],
  ...extra,
});
// An auction Hushed won (closed), one Brackwyn won that Hushed bid on and lost (closed), and one still open.
const auctions = () => [
  { auction_id: 1, item_name: 'Cloak of Shadows', winner: 'hushed_login', winner_character_id: 7, bid_amount: 100, end_at: PAST },
  { auction_id: 2, item_name: 'Ruby Ring', winner: 'brack_login', winner_character_id: 9, bid_amount: 60, end_at: PAST },
  { auction_id: 3, item_name: 'Sealed Staff', winner: 'quiet_login', winner_character_id: 8, bid_amount: 75, end_at: FUTURE },
];
const bids = () => [
  { auction_id: 1, character_id: 7, character_name: 'hushed_login', value: 100 },
  { auction_id: 1, character_id: 9, character_name: 'brack_login', value: 90 },
  { auction_id: 2, character_id: 9, character_name: 'brack_login', value: 60 },
  { auction_id: 2, character_id: 7, character_name: 'hushed_login', value: 30 },
  { auction_id: 2, character_id: 7, character_name: 'hushed_login', value: 40 },      // a raised bid: the highest counts
  { auction_id: 2, character_id: 8, character_name: 'quiet_login', value: 20 },       // never won anything: not named
  { auction_id: 3, character_id: 7, character_name: 'hushed_login', value: 70 },      // on the OPEN auction: sealed
  { auction_id: 3, character_id: 8, character_name: 'quiet_login', value: 75 },
];

// ── 2. SUBSTITUTION, in the loaders ──────────────────────────────────────────────────────────────────────────
describe('the loaders hand the browser labels, never the name', () => {
  const W = makeWindow(T0 + 1 * MINUTE_MS, T0 + 91 * MINUTE_MS);

  it('the bundle carries "Wizard 1" and "Monk 1" in the attendance, the parses and the loot, and no real name', async () => {
    const out = await loadSessionReview(dbWith(W), W);
    expect(out.bundle.attendance.map(a => a.name).sort()).toEqual(['Aldenmar', 'Monk 1', 'Wizard 1']);
    expect(out.bundle.kills[0].top.map(p => p.name)).toEqual(['Wizard 1', 'Aldenmar', 'Monk 1']);
    expect(out.bundle.loot.find(l => l.item === 'Rusty Helm').who).toBe('Monk 1');
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/Hushed|Quietone/);
  });
  it('the same person has the same label in the attendance, the parse table and the replay row', async () => {
    const db = dbWith(W, { encounters: [{ id: '0b9a6d3e-1c2f-4a5b-8c7d-123456789abc', started_at: iso(W.fromMs), ended_at: iso(W.fromMs), duration_sec: 30 }] });
    const review = await loadSessionReview(db, W);
    const parse = await loadFightParse(db, '0b9a6d3e-1c2f-4a5b-8c7d-123456789abc', { guild: 'wolfpack', win: W });
    const replay = decodeMinute({ minute_at: iso(W.fromMs), data: scrubMinuteData(minuteData, await loadAnon(db, 'wolfpack', W)) });
    const attendance = review.bundle.attendance.map(a => a.name).sort();
    expect(parse.players.map(p => p.name).sort()).toEqual(attendance);
    expect(replay[0].raiders.map(r => r.name).sort()).toEqual(attendance);
    expect(replay[0].raiders.find(r => r.name === 'Wizard 1')).toMatchObject({ cls: 'Wizard' });   // the dot keeps its class and place
    expect(replay[0].raiders.length).toBe(3);                                                      // nobody is dropped from the picture
  });
  it('a fight\'s parse names no opted-out character, takes the class from the label, and counts their damage', async () => {
    const db = dbWith(W, { encounters: [{ id: '0b9a6d3e-1c2f-4a5b-8c7d-123456789abc', started_at: iso(W.fromMs), ended_at: iso(W.fromMs), duration_sec: 30 }] });
    const p = await loadFightParse(db, '0b9a6d3e-1c2f-4a5b-8c7d-123456789abc', { guild: 'wolfpack', win: W });
    expect(p.players.map(x => [x.name, x.cls])).toEqual([['Wizard 1', 'Wizard'], ['Aldenmar', null], ['Monk 1', 'Monk']]);
    expect(p.totalDamage).toBe(239);                     // Hushed's 99 and Quietone's 50 are in it
    expect(Math.round(p.players[0].pct)).toBe(41);
    expect(JSON.stringify(p)).not.toMatch(/Hushed|Quietone/);
  });
  it('a replay row has the name swapped inside the JSON, so it is in no field of the response', async () => {
    const anon = await loadAnon(dbWith(W), 'wolfpack', W);
    const s = scrubMinuteData(minuteData, anon);
    expect(s).not.toMatch(/Hushed|Quietone/);
    expect(s).toMatch(/Wizard 1/);
    expect(scrubMinuteData(minuteData, new Map())).toBe(minuteData);
  });
  it('without a window nobody is exempt, so every opted-out character is a label', async () => {
    const db = dbWith(W, { opendkp_auctions: auctions() });
    const anon = await loadAnon(db, 'wolfpack');
    expect(anonName(anon, 'Hushed')).toBe('Wizard 1');
  });
});

// ── 3. WINNERS are shown by name ─────────────────────────────────────────────────────────────────────────────
describe('a bid winner is shown by name even when opted out', () => {
  const W = makeWindow(T0 + 2 * MINUTE_MS, T0 + 92 * MINUTE_MS);
  const wonDb = () => dbWith(W, {
    opendkp_auctions: auctions(),
    opendkp_auction_bids: bids(),
    loot_observations: [{ item_name: 'Belt', winner_character: 'Quietone', dkp_amount: 5, posted_at: PAST }],
  });

  it('the auction winner is a name; the opted-out raider who won nothing stays a label', async () => {
    const db = dbWith(W, { opendkp_auctions: auctions(), opendkp_auction_bids: bids() });
    const out = await loadSessionReview(db, W);
    expect(out.bundle.attendance.map(a => a.name).sort()).toEqual(['Aldenmar', 'Hushed', 'Monk 1']);
    expect(out.bundle.kills[0].top.map(p => p.name)).toEqual(['Hushed', 'Aldenmar', 'Monk 1']);
    expect(JSON.stringify(out)).not.toContain('Quietone');
  });
  it('winning in an observed award counts too (and the open auction\'s leader does not)', async () => {
    const out = await loadSessionReview(wonDb(), W);
    // Quietone led the OPEN auction (sealed) AND won the Belt award: shown by name through the award alone
    expect(out.bundle.attendance.map(a => a.name)).toContain('Quietone');
    const open = winnerKeys({ observed: [], auctions: auctions(), chars: [] }, NOW);
    expect([...open].sort()).toEqual(['hushed_login', 'brack_login'].sort());
    expect(open.has('quiet_login')).toBe(false);
  });
  it('the parse and the replay agree with the bundle: the winner is a name there too', async () => {
    const db = dbWith(W, { opendkp_auctions: auctions(), encounters: [{ id: '0b9a6d3e-1c2f-4a5b-8c7d-123456789abc', started_at: iso(W.fromMs), ended_at: iso(W.fromMs), duration_sec: 30 }] });
    const p = await loadFightParse(db, '0b9a6d3e-1c2f-4a5b-8c7d-123456789abc', { guild: 'wolfpack', win: W });
    expect(p.players.map(x => x.name)).toEqual(['Hushed', 'Aldenmar', 'Monk 1']);
    const anon = await loadAnon(db, 'wolfpack', W);
    const s = scrubMinuteData(minuteData, anon);
    expect(s).toMatch(/Hushed/);
    expect(s).not.toMatch(/Quietone/);
  });
  it('a character is exempt through its OpenDKP id, not only by an exact login match', () => {
    const inp = { observed: [], auctions: auctions(), chars: [{ opendkp_id: 7, name: 'Hushed', class: 'Wizard' }] };
    expect(winnerKeys(inp, NOW).has('hushed')).toBe(true);
  });
});

// ── 4. BIDS ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('the winners\' bids view', () => {
  const chars = [
    { opendkp_id: 7, name: 'Hushed', class: 'Wizard' },
    { opendkp_id: 9, name: 'Brackwyn', class: 'Cleric' },
    { opendkp_id: 8, name: 'Quietone', class: 'Monk' },
  ];
  const inp = { observed: [], auctions: auctions(), chars };
  const view = () => buildBidders(inp, bids(), [], 'salt', NOW);
  const of = (name) => view().find(b => b.name === name);

  it('lists what a winner WON, with what they paid', () => {
    expect(of('Hushed').wins).toEqual([{ item: 'Cloak of Shadows', dkp: 100, atMs: Date.parse(PAST) }]);
    expect(of('Brackwyn').wins.map(w => [w.item, w.dkp])).toEqual([['Ruby Ring', 60]]);
  });
  it('lists the CLOSED auctions they bid on and lost: their highest bid, and who won', () => {
    expect(of('Hushed').losses).toEqual([{ item: 'Ruby Ring', bid: 40, winner: 'Brackwyn', atMs: Date.parse(PAST) }]);
    expect(of('Brackwyn').losses).toEqual([{ item: 'Cloak of Shadows', bid: 90, winner: 'Hushed', atMs: Date.parse(PAST) }]);
  });
  it('never shows an auction still open: no win, no bid, no leader, no item name', () => {
    const json = JSON.stringify(view());
    expect(json).not.toContain('Sealed Staff');
    expect(json).not.toContain('"bid":70');
    expect(json).not.toContain('"bid":75');
    expect(view().some(b => b.name === 'Quietone')).toBe(false);   // their only win would be the open auction
    expect(buildBidders({ observed: [], auctions: [auctions()[2]], chars }, bids(), [], 'salt', NOW)).toEqual([]);
  });
  it('an auction with no end time cannot be shown to be closed', () => {
    const open = { observed: [], auctions: [{ ...auctions()[0], end_at: null }], chars };
    expect(winsOf(open, NOW).size).toBe(0);
  });
  it('someone who bid but never won has no entry (they are not named)', () => {
    expect(view().map(b => b.name).sort()).toEqual(['Brackwyn', 'Hushed']);
    expect(JSON.stringify(view())).not.toContain('Quietone');
  });
  it('an observed award counts as a win, and the same win seen twice counts once', () => {
    const withObs = { ...inp, observed: [
      { item_name: 'Ruby Ring', winner_character: 'Brackwyn', dkp_amount: 60, posted_at: PAST },     // the auction's own win
      { item_name: 'Belt', winner_character: 'Brackwyn', dkp_amount: 5, posted_at: PAST },
    ] };
    const b = buildBidders(withObs, bids(), [], 'salt', NOW).find(x => x.name === 'Brackwyn');
    expect(b.wins.map(w => w.item).sort()).toEqual(['Belt', 'Ruby Ring']);
  });
  it('the handle is opaque, unique, stable and carries no name', () => {
    const hs = view().map(b => b.handle);
    expect(new Set(hs).size).toBe(hs.length);
    for (const b of view()) expect(b.handle.toLowerCase()).not.toContain(b.name.toLowerCase());
    expect(buildBidders(inp, bids(), [], 'salt', NOW).map(b => b.handle)).toEqual(hs);
    expect(buildBidders(inp, bids(), [], 'other', NOW).map(b => b.handle)).not.toEqual(hs);
  });
  it('the read asks for bids of the CLOSED auctions only', async () => {
    const W = makeWindow(T0 + 3 * MINUTE_MS, T0 + 93 * MINUTE_MS);
    const db = fakeDb({ opendkp_auctions: auctions(), characters: characters(), opendkp_auction_bids: bids(), loot_observations: [] });
    const out = await loadBidders(db, 'wolfpack', W, 'salt', NOW);
    const q = db.queries.find(x => x.table === 'opendkp_auction_bids');
    expect(q.ops.find(o => o[0] === 'in')[2].sort()).toEqual([1, 2]);   // auction 3 is open: its bids are never read
    expect(out.map(b => b.name).sort()).toEqual(['Brackwyn', 'Hushed']);
    // and the auctions themselves are read for this window, on their end time
    const a = db.queries.find(x => x.table === 'opendkp_auctions');
    expect(hasOp(a, 'gte', 'end_at', new Date(W.fromMs).toISOString())).toBe(true);
    expect(hasOp(a, 'lt', 'end_at', new Date(W.toMs).toISOString())).toBe(true);
  });
  it('the bundle carries the bidders', async () => {
    const W = makeWindow(T0 + 4 * MINUTE_MS, T0 + 94 * MINUTE_MS);
    const out = await loadSessionReview(dbWith(W, { opendkp_auctions: auctions(), opendkp_auction_bids: bids() }), W);
    expect(out.bundle.bidders.map(b => b.name).sort()).toEqual(['Brackwyn', 'Hushed']);
  });
});

// ── 5. CACHE ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('a cached review is rebuilt when the opt-outs change', () => {
  it('a newly opted-out raider is a label on the next load, not after the five-minute cache', async () => {
    const W = makeWindow(T0 + 5 * MINUTE_MS, T0 + 95 * MINUTE_MS);
    const rows = characters();
    rows[2].exclude_from_stats = false;
    rows[0].exclude_from_stats = false;   // nobody opted out to start with
    rows[1].exclude_inventory = false;
    const db = dbWith(W, { characters: rows });
    const first = await loadSessionReview(db, W);
    expect(first.bundle.attendance.map(a => a.name).sort()).toEqual(['Aldenmar', 'Hushed', 'Quietone']);
    rows[0].exclude_from_stats = true;                  // Hushed opts out
    clearOptedOutCache();                               // the minute passes
    const second = await loadSessionReview(db, W);
    expect(second.bundle.attendance.map(a => a.name).sort()).toEqual(['Aldenmar', 'Quietone', 'Wizard 1']);
    expect(JSON.stringify(second)).not.toContain('Hushed');
  });
  it('an unchanged opt-out list reuses the review', async () => {
    const W = makeWindow(T0 + 6 * MINUTE_MS, T0 + 96 * MINUTE_MS);
    const db = dbWith(W);
    const a = await loadSessionReview(db, W);
    clearOptedOutCache();
    const b = await loadSessionReview(db, W);
    expect(b).toBe(a);
  });
});

// ── 6. SOURCE ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the surfaces', () => {
  const shareReplay = read('web', 'app', 'api', 'share', 'raid', '[token]', 'replay', 'route.ts');
  const memberReplay = read('web', 'app', 'api', 'raid', 'session', 'replay', 'route.ts');
  const memberParse = read('web', 'app', 'api', 'raid', 'session', 'parse', 'route.ts');
  const view = read('web', 'app', 'raid', 'session', 'SessionReview.tsx');

  it('both replay routes label with the window the winners belong to, and scrub every row', () => {
    expect(shareReplay).toMatch(/loadAnon\(db, guild, win\)/);
    expect(shareReplay).toMatch(/win = share\.win/);
    expect(shareReplay).toMatch(/scrubMinuteData\(r\.data, anon\)/);
    expect(memberReplay).toMatch(/loadAnon\(db, GUILD_TAG, win\)/);
    expect(memberReplay).toMatch(/scrubMinuteData\(r\.data, anon\)/);
    expect(memberReplay).toMatch(/auth\.getUser\(\)/);
  });
  it('the members\' parse call names the review\'s window for the winners without letting it bound the read', () => {
    expect(memberParse).toMatch(/anonWin: win/);
    expect(memberParse).not.toMatch(/guild: GUILD_TAG, win\b/);   // `win:` would also bound the read to the window
  });
  it('the members\' board reads the labelled replay route, not the replay page\'s', () => {
    expect(view).toMatch(/\/api\/raid\/session\/replay\?/);
    expect(view).not.toMatch(/api\/spectator\/replay\?night/);
  });
  it('a name is in no tooltip, data attribute or URL: the link is the opaque handle', () => {
    expect(view).not.toMatch(/data-[a-z-]+=\{[^}]*name/i);
    expect(view).not.toMatch(/title=\{[^}]*(name|\.who|winner)/i);
    expect(view).toMatch(/history\.replaceState\(null, '', `#bids-\$\{handle\}`\)/);
    expect(view).toMatch(/id=\{`bids-\$\{b\.handle\}`\}/);
  });
  it('attendance and kills use the shared labeller, so no stage drops a character any more', () => {
    const lib = read('web', 'lib', 'raidSession.ts');
    expect(lib).not.toMatch(/dropOptedOut|isOptedOut|optedOutSet|whoHidden|winnerHidden/);
    const rows = [{ minute_at: iso(T0), data: minuteData }];
    expect(attendanceFromMinutes(rows, anonLabels([{ name: 'Hushed', class: 'Wizard', exclude_from_stats: true }])).length).toBe(3);
    expect(buildKills([], [], new Set(), new Map())).toEqual([]);
  });
});
