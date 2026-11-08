// test/raid-hails.test.js — who hailed each flag NPC inside a raid session's window (web/lib/raidHails.ts, the loader
// loadWindowHails in lib/raidSessionLoad.ts, the card in app/raid/session/HailCard.tsx).
// The ask (the guild lead, 2026-11-03): show who was able to flag from a raid, or at least who hailed.
//
//   1. EVENTS   hails of one NPC within 20 minutes of the previous one are one event; a longer gap is a second event;
//               two NPCs are two events; a character witnessed by several uploaders counts once; first-hail order.
//   2. NARROW   a raid set keeps only hailers standing in it; an event nobody in the set hailed disappears.
//   3. NAMES    an opted-out character is shown as their label, never their name.
//   4. LOADER   one windowed, guild-scoped select of four columns; a closed isolated review has no hails.
//   5. SOURCE   the share page hands the share's group key to the loader.
//
// Names are invented tokens. Source assertions run on comment-stripped text.
// Run: npx vitest run test/raid-hails.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { buildHailEvents, HAIL_EVENT_GAP_MS, npcLabel } from '../web/lib/raidHails.ts';
import { loadSessionReview } from '../web/lib/raidSessionLoad.ts';
import { makeWindow } from '../web/lib/raidShare.ts';
import { buildGroups, groupKey } from '../web/lib/sessionGroups.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-11-02T01:00:00.000Z');
const at = (min) => new Date(T0 + min * MIN).toISOString();
const row = (character, min, npc = 'A Planar Projection', zone = '208') => ({ character, npc, zone, earned_at: at(min) });
const NO_ANON = new Map();

describe('events', () => {
  it('clusters hails within 20 minutes of the previous one, once per character, first hail first', () => {
    const ev = buildHailEvents([
      row('Brackwyn', 10), row('Aldenmar', 1), row('Aldenmar', 2), row('Corvale', 19),
    ], NO_ANON);
    expect(ev).toHaveLength(1);
    expect(ev[0].names).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    expect(ev[0].npc).toBe('Planar Projection');
    expect(ev[0].fromMs).toBe(T0 + 1 * MIN);
    expect(ev[0].toMs).toBe(T0 + 19 * MIN);
  });
  it('chains: each hail only needs to be near the one before it', () => {
    const ev = buildHailEvents([row('Aldenmar', 0), row('Brackwyn', 19), row('Corvale', 38)], NO_ANON);
    expect(ev).toHaveLength(1);
    expect(ev[0].names).toHaveLength(3);
  });
  it('starts a second event after a gap of more than 20 minutes', () => {
    expect(HAIL_EVENT_GAP_MS).toBe(20 * MIN);
    const ev = buildHailEvents([row('Aldenmar', 0), row('Aldenmar', 21), row('Brackwyn', 22)], NO_ANON);
    expect(ev).toHaveLength(2);
    expect(ev[0].names).toEqual(['Aldenmar']);
    expect(ev[1].names).toEqual(['Aldenmar', 'Brackwyn']);   // the same character may appear in a later event
  });
  it('keeps two NPCs (and the same NPC in two zones) apart, oldest event first', () => {
    const ev = buildHailEvents([
      row('Aldenmar', 5, 'A Planar Projection', '208'),
      row('Brackwyn', 3, 'Trial Keeper', '211'),
      row('Corvale', 4, 'A Planar Projection', '211'),
    ], NO_ANON, { zoneName: z => (z === '208' ? 'Plane of Valor' : z === '211' ? 'Halls of Honor' : null) });
    expect(ev.map(e => [e.npc, e.zoneName])).toEqual([['Trial Keeper', 'Halls of Honor'], ['Planar Projection', 'Halls of Honor'], ['Planar Projection', 'Plane of Valor']]);
  });
  it('drops rows with no name, no NPC or no usable time', () => {
    const ev = buildHailEvents([row('', 1), { ...row('Aldenmar', 1), npc: null }, { ...row('Aldenmar', 1), earned_at: 'nope' }], NO_ANON);
    expect(ev).toEqual([]);
  });
  it('strips the article from the NPC name', () => {
    expect(npcLabel('A Planar Projection')).toBe('Planar Projection');
    expect(npcLabel('An Old Guide')).toBe('Old Guide');
    expect(npcLabel('Aerin`Dar')).toBe('Aerin`Dar');
  });
});

describe('narrowing to a raid set', () => {
  const inSet = new Set(['aldenmar', 'corvale']);
  const keep = (nk) => inSet.has(nk);
  it('keeps only hailers in the set and drops an event nobody in the set hailed', () => {
    const ev = buildHailEvents([
      row('Aldenmar', 1), row('Brackwyn', 2), row('Corvale', 3),
      row('Brackwyn', 5, 'Trial Keeper', '211'),
    ], NO_ANON, { keep });
    expect(ev).toHaveLength(1);
    expect(ev[0].names).toEqual(['Aldenmar', 'Corvale']);
  });
  it('a set that matches nobody gives no events (fail closed)', () => {
    expect(buildHailEvents([row('Aldenmar', 1)], NO_ANON, { keep: () => false })).toEqual([]);
  });
  it('is asked about the hail by name key and time', () => {
    const calls = [];
    buildHailEvents([row('Aldenmar', 7)], NO_ANON, { keep: (nk, ms) => { calls.push([nk, ms]); return true; } });
    expect(calls).toEqual([['aldenmar', T0 + 7 * MIN]]);
  });
});

describe('opt-outs', () => {
  it('shows an opted-out character as their label, once, and never their name', () => {
    const anon = new Map([['brackwyn', { label: 'Cleric 2', cls: 'Cleric' }]]);
    const ev = buildHailEvents([row('Brackwyn', 1), row('Aldenmar', 2), row('Brackwyn', 3)], anon);
    expect(ev[0].names).toEqual(['Cleric 2', 'Aldenmar']);
    expect(JSON.stringify(ev)).not.toMatch(/Brackwyn/);
  });
});

// ── the loader, against a recording fake of PostgREST ────────────────────────────────────────────────────────
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
        gte: rec('gte'), lt: rec('lt'), lte: rec('lte'), gt: rec('gt'), order: rec('order'), range: rec('range'), limit: rec('limit'),
        maybeSingle() { return Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null }); },
        then(res, rej) { return Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej); },
      };
      return b;
    },
  };
}
// Two crews of eight, each listed for ten minutes; the second crew's names start with "Z".
const crew = (names) => JSON.stringify({ who: names.map(n => [n, 'Cleric', 1, 60, 0]), zones: ['codecay'], raids: ['aaaa1111'], f: [[0, ...names.flatMap((_, i) => [i, 0, 0, 0, 0, 0, 0])]] });
const A = ['Aldenmar', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Brackwyn', 'Aldenmar2', 'Corvale2'];
const minuteRows = Array.from({ length: 10 }, (_, i) => ({ minute_at: at(i), night_key: 'n', zones: [], raiders: A.length, data: crew(A) }));
const WIN = makeWindow(T0, T0 + 60 * MIN);

describe('the loader', () => {
  const tables = () => ({
    raid_track_minutes: minuteRows,
    pop_flags: [{ id: 1, character: 'Aldenmar', npc: 'A Planar Projection', zone: '208', earned_at: at(3) }, { id: 2, character: 'Outsider', npc: 'A Planar Projection', zone: '208', earned_at: at(4) }],
  });
  it('reads pop_flags once: the guild, hails only, the window, four columns plus the order key', async () => {
    const db = fakeDb(tables());
    const out = await loadSessionReview(db, WIN);
    const qs = db.queries.filter(q => q.table === 'pop_flags');
    expect(qs).toHaveLength(1);
    const ops = qs[0].ops;
    expect(ops.find(o => o[0] === 'select')[1]).toBe('id, character, npc, zone, earned_at');
    expect(ops.some(o => o[0] === 'eq' && o[1] === 'flag_key' && o[2] === 'hail')).toBe(true);
    expect(ops.some(o => o[0] === 'eq' && o[1] === 'guild_id')).toBe(true);
    expect(ops.some(o => o[0] === 'gte' && o[1] === 'earned_at')).toBe(true);
    expect(ops.some(o => o[0] === 'lt' && o[1] === 'earned_at')).toBe(true);
    expect(out.bundle.hails[0].names).toEqual(['Aldenmar', 'Outsider']);
    expect(out.bundle.hails[0].zoneName).toBe('Plane of Valor');
  });
  it('a review narrowed to a raid keeps only hailers who stood in it', async () => {
    const idx = buildGroups(minuteRows);
    const id = idx.groups[0].id;
    const out = await loadSessionReview(fakeDb(tables()), WIN, { groups: true, group: id });
    expect(out.group).toBe(groupKey([id]));
    expect(out.bundle.hails[0].names).toEqual(['Aldenmar']);
  });
  it('an isolated review whose raids the window does not hold shows no hails', async () => {
    const out = await loadSessionReview(fakeDb(tables()), WIN, { group: 'rdeadbeef', isolate: true });
    expect(out.bundle.hails).toEqual([]);
  });
});

describe('the share page', () => {
  it('hands the share row group key to the loader, with isolate', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/share/raid/[token]/page.tsx'), 'utf8'));
    expect(src).toMatch(/const groups = shareGroupKey\(share\.row\)/);
    expect(src).toMatch(/loadSessionReview\(sb, share\.win, groups === null \? \{\} : \{ group: groups, isolate: true \}\)/);
  });
  it('the review renders the hail card from the bundle', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/raid/session/SessionReview.tsx'), 'utf8'));
    expect(src).toMatch(/<HailCard events=\{bundle\.hails\} \/>/);
  });
});
