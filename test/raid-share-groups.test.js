// test/raid-share-groups.test.js — a public raid share link limited to a CHOSEN SET of the raids recorded in its window
// (web/lib/sessionGroups.ts set helpers, lib/raidSessionLoad.ts, the share routes, POST /api/raid/shares).
// The call (the guild lead, 2026-11-03): "i'm trying to link externally to [another guild] to share their raid, and NOT
// our raid" and "the selection should be multi-select". One guild's raid can be recorded as several groups when the
// leader hands off, so the review and the link take a SET, and the link must show nothing of the raids left out.
//
//   1. SET        ids parse, validate, dedupe, cap at 12 and sort into one key; an id is a set of one.
//   2. UNION      a set's members are the union of its groups', minute by minute; narrowing cuts every other raid away;
//                 an id the window does not hold narrows to nothing, never to everyone.
//   3. CHECK      the share POST accepts only ids the share's own window holds (1 to 12, well formed), null = whole window.
//   4. LOADER     a review limited to a set (`isolate`) keeps those raids' attendance, fights and loot, leaves out the
//                 window's ticks / rolls / bids, and FAILS CLOSED for ids the window does not hold.
//   5. ROUTES     every share route that returns something about raiders reads the row's group_ids; the geometry routes
//                 (map, mesh) read nothing but the token.
//
// Names are invented tokens. Source assertions run on comment-stripped text.
// Run: npx vitest run test/raid-share-groups.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { MINUTE_MS } from '../web/lib/raidReplay.ts';
import { clearOptedOutCache } from '../web/lib/raidShareLookup.ts';
import { loadGroupFightIds, loadSessionReview } from '../web/lib/raidSessionLoad.ts';
import { makeWindow, windowIso } from '../web/lib/raidShare.ts';
import {
  MAX_GROUP_SET, buildGroups, checkShareGroups, groupIdsOf, groupKey, groupLabels, inGroupAt, inGroupEver, inSet, narrowRows,
  parseGroupIds, raidKey, resolveGroupKey, setMembers, shareGroupKey,
} from '../web/lib/sessionGroups.ts';

const T0 = Date.parse('2026-10-23T05:00:00Z');
const DAY = 24 * 60 * MINUTE_MS;
const crew = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** One minute row: every part's names placed in its zone, the part's `tag` (a leader name) stamped as the raid key. */
function minuteRow(fromMs, k, parts) {
  const who = [], zones = [], raids = [], f = [0];
  for (const p of parts) {
    let zi = zones.indexOf(p.zone); if (zi < 0) { zi = zones.length; zones.push(p.zone); }
    let ri = -1;
    if (p.tag) { const key = raidKey(p.tag); ri = raids.indexOf(key); if (ri < 0) { ri = raids.length; raids.push(key); } }
    for (const n of p.names) { const i = who.length; who.push([n, 'WAR', 1, 60, ri]); f.push(i, 1, 2, 3, 4, 90, zi); }
  }
  return { minute_at: new Date(fromMs + k * MINUTE_MS).toISOString(), night_key: '10/22/2026', zones, raiders: who.length, data: JSON.stringify({ v: 1, step_s: 3, who, zones, f: [f], raids }) };
}

// One guild's raid in two groups (the leader handed off at minute 15), another guild's raid alongside the whole time.
const A = crew('Aldenmar', 10);     // the first guild's crew
const B = crew('Brackwyn', 8);      // the other crew
const FROM = T0 + 4 * DAY;          // its own window: the loader memoizes per window
const rows = Array.from({ length: 29 }, (_, k) => minuteRow(FROM, k, [
  { zone: 'x', tag: k < 15 ? 'Corvale' : 'Rethlan', names: A },
  { zone: 'x', tag: 'Zarrin', names: B },
]));
const idOf = (tag) => 'r' + raidKey(tag);
const X1 = idOf('Corvale'), X2 = idOf('Rethlan'), Y = idOf('Zarrin');

describe('the set of raids', () => {
  it('parses a comma list, drops bad and repeated ids, caps at 12 and keys it sorted', () => {
    expect(parseGroupIds('rbbb,raaa,rbbb,NOPE!,x')).toEqual(['rbbb', 'raaa']);
    expect(groupKey(parseGroupIds('rbbb,raaa'))).toBe('raaa,rbbb');
    expect(parseGroupIds(['r111', 'r222'])).toEqual(['r111', 'r222']);
    expect(parseGroupIds(undefined)).toEqual([]);
    expect(parseGroupIds(42)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `r${String(i).padStart(3, '0')}`);
    expect(parseGroupIds(many.join(',')).length).toBe(MAX_GROUP_SET);
  });
  it('an id is a set of one, and a key names its ids', () => {
    expect(groupIdsOf('raaa')).toEqual(['raaa']);
    expect(groupIdsOf('raaa,rbbb')).toEqual(['raaa', 'rbbb']);
    expect(groupIdsOf(null)).toEqual([]);
    expect(inSet('raaa,rbbb', 'rbbb')).toBe(true);
    expect(inSet('raaa,rbbb', 'rccc')).toBe(false);
    expect(inSet('raaa', null)).toBe(false);
  });
});

describe('the union', () => {
  const idx = buildGroups(rows);
  it('finds the three groups', () => {
    expect(idx.groups.map(g => g.id).sort()).toEqual([X1, X2, Y].sort());
  });
  it('a set holds the raiders of every group in it, minute by minute, and none of the others', () => {
    const key = groupKey([X1, X2]);
    expect(inGroupEver(idx, key, 'aldenmar1')).toBe(true);
    expect(inGroupEver(idx, key, 'brackwyn1')).toBe(false);
    expect(inGroupAt(idx, key, 'aldenmar3', FROM + 3 * MINUTE_MS)).toBe(true);     // the first half
    expect(inGroupAt(idx, key, 'aldenmar3', FROM + 25 * MINUTE_MS)).toBe(true);    // after the hand-off
    expect(inGroupAt(idx, X1, 'aldenmar3', FROM + 25 * MINUTE_MS)).toBe(false);    // one group alone is not the other half
    expect(inGroupAt(idx, key, 'brackwyn3', FROM + 3 * MINUTE_MS)).toBe(false);
    expect(setMembers(idx, key)).toBe(setMembers(idx, key));                       // computed once per index
  });
  it('narrowing cuts every raid outside the set out of every row', () => {
    const got = narrowRows(rows, idx, groupKey([X1, X2]));
    expect(got.length).toBe(rows.length);
    for (const r of got) {
      const who = JSON.parse(r.data).who.map(w => w[0]);
      expect(who.some(n => n.startsWith('Brackwyn'))).toBe(false);
      expect(who.length).toBe(A.length);
    }
    expect(narrowRows(rows, idx, Y).every(r => JSON.parse(r.data).who.every(w => w[0].startsWith('Brackwyn')))).toBe(true);
  });
  it('a single id narrows exactly as before, and an id the window lacks narrows to nothing', () => {
    expect(narrowRows(rows, idx, X1).length).toBe(15);
    expect(narrowRows(rows, idx, 'rdeadbeef')).toEqual([]);
    expect(narrowRows(rows, idx, '')).toEqual([]);
  });
  it('resolves a request to the ids the window holds', () => {
    expect(resolveGroupKey(idx, `${Y},rdeadbeef`)).toBe(Y);
    expect(resolveGroupKey(idx, 'rdeadbeef')).toBeNull();
    expect(groupLabels(idx.groups, [Y, 'rdeadbeef'])[1]).toBe('a raid no longer in this window');
  });
});

describe('the share request', () => {
  const present = new Set([X1, X2, Y]);
  it('no group_ids means the whole window', () => {
    expect(checkShareGroups(undefined, present)).toEqual({ ids: null });
    expect(checkShareGroups(null, present)).toEqual({ ids: null });
  });
  it('takes 1 to 12 ids the window holds, distinct and sorted', () => {
    expect(checkShareGroups([Y, X1, Y], present)).toEqual({ ids: [X1, Y].sort() });
    expect(checkShareGroups([X1], present)).toEqual({ ids: [X1] });
  });
  it('refuses an id the window does not hold, a malformed one, an empty list, too many and a non-list', () => {
    expect(checkShareGroups([X1, 'rdeadbeef'], present)).toHaveProperty('error');
    expect(checkShareGroups(['NOT AN ID'], present)).toHaveProperty('error');
    expect(checkShareGroups([42], present)).toHaveProperty('error');
    expect(checkShareGroups([], present)).toHaveProperty('error');
    expect(checkShareGroups(Array.from({ length: 13 }, (_, i) => `r${String(i).padStart(3, '0')}`), new Set(Array.from({ length: 13 }, (_, i) => `r${String(i).padStart(3, '0')}`)))).toHaveProperty('error');
    expect(checkShareGroups('rabc', present)).toHaveProperty('error');
  });
  it('a stored row: no list is the whole window; a damaged list is a set that matches nobody', () => {
    expect(shareGroupKey({})).toBeNull();
    expect(shareGroupKey({ group_ids: null })).toBeNull();
    expect(shareGroupKey({ group_ids: [Y, X1] })).toBe(groupKey([X1, Y]));
    expect(shareGroupKey({ group_ids: [] })).toBe('');
    expect(shareGroupKey({ group_ids: ['NOPE!'] })).toBe('');
  });
});

// ── the loader, against a fake database ──────────────────────────────────────────────────────────────────────
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

describe('the review limited to a set', () => {
  const W = makeWindow(FROM, FROM + 40 * MINUTE_MS);
  const { from } = windowIso(W);
  const at = (m) => new Date(FROM + m * MINUTE_MS).toISOString();
  const enc = (id, npc, name, minute) => ({
    id, npc_id: npc, started_at: from, ended_at: at(minute), duration_sec: 40, total_damage: 1000,
    zone_short: null, classification: null, is_wipe: false, eqemu_npc_types: { name },
  });
  const ep = (id, names) => names.map(n => ({ encounter_id: id, character_name: n, total_damage: 100, dps: 1 }));
  const tables = {
    characters: [],
    raid_track_minutes: rows,
    encounters: [enc('fa1', 200230, '#Fran_Prisoal', 5), enc('fb', 200225, '#Avhi_Escron', 6), enc('fa2', 200226, '#Bertoxxulous', 20)],
    bosses_local: [],
    eqemu_zone: [{ zone_id: 200, short_name: 'codecay' }],
    encounter_players: [...ep('fa1', A.slice(0, 5)), ...ep('fb', B.slice(0, 5)), ...ep('fa2', A.slice(0, 4))],
    looted_items: [
      { looter_character: A[0], item_name: 'Thing A', zone: 'x', looted_at: at(5), from_own_pet: false },
      { looter_character: B[0], item_name: 'Thing B', zone: 'x', looted_at: at(5), from_own_pet: false },
    ],
    raid_attendance_ticks: [{ id: 't1', description: 'On time', scheduled_for: at(3), names: [...A, ...B] }],
    roll_sets: [{ id: 'r1', roll_from: 1, roll_to: 100, item: 'Thing A', qty: 1, zone: 'x', rolls: [{ name: A[0], value: 77 }], started_at: at(5), last_at: at(5) }],
  };

  it('keeps only the chosen raids\' attendance, fights and loot, and leaves out ticks and rolls', async () => {
    clearOptedOutCache();
    const out = await loadSessionReview(fakeDb({ ...tables }), W, { group: groupKey([X1, X2]), isolate: true });
    expect(out.bundle.attendance.map(a => a.name).sort()).toEqual([...A].sort());
    expect(out.bundle.kills.map(k => k.id).sort()).toEqual(['fa1', 'fa2']);     // both halves of the hand-off, not the other raid's fight
    expect(out.bundle.loot.map(l => l.looter ?? l.name ?? '').join('|')).not.toMatch(/Brackwyn/);
    expect(out.bundle.ticks).toEqual([]);
    expect(out.bundle.rolls).toEqual([]);
    expect(out.bundle.bidders).toEqual([]);
    expect(out.group).toBe(groupKey([X1, X2]));
  });
  it('a set of the other crew shows that crew only', async () => {
    clearOptedOutCache();
    const out = await loadSessionReview(fakeDb({ ...tables }), W, { group: Y, isolate: true });
    expect(out.bundle.attendance.map(a => a.name).sort()).toEqual([...B].sort());
    expect(out.bundle.kills.map(k => k.id)).toEqual(['fb']);
  });
  it('FAILS CLOSED: ids the window does not hold (or an empty set) show nothing, not the whole window', async () => {
    clearOptedOutCache();
    for (const group of ['rdeadbeef', '', null]) {
      const out = await loadSessionReview(fakeDb({ ...tables }), W, { group, isolate: true });
      expect(out.bundle.attendance).toEqual([]);
      expect(out.bundle.kills).toEqual([]);
      expect(out.bundle.loot).toEqual([]);
      expect(out.bundle.minutesRecorded).toBe(0);
    }
  });
  it('without isolate (the members\' page) an id the window lacks still shows the whole window, as before', async () => {
    clearOptedOutCache();
    const out = await loadSessionReview(fakeDb({ ...tables }), W, { groups: true, group: 'rdeadbeef' });
    expect(out.bundle.attendance.length).toBe(A.length + B.length);
  });
  it('lists the ids of the fights that belong to the set, for the routes that list fights alone', async () => {
    const ids = await loadGroupFightIds(fakeDb({ ...tables }), W, groupKey([X1, X2]));
    expect([...ids].sort()).toEqual(['fa1', 'fa2']);
    expect([...await loadGroupFightIds(fakeDb({ ...tables }), W, Y)]).toEqual(['fb']);
    expect((await loadGroupFightIds(fakeDb({ ...tables }), W, 'rdeadbeef')).size).toBe(0);
    expect((await loadGroupFightIds(fakeDb({ ...tables }), W, '')).size).toBe(0);
  });
});

// ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────
const src = (...p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', ...p), 'utf8'));
const SHARE_API = ['app', 'api', 'share', 'raid', '[token]'];

describe('every share route narrows to the link\'s raids', () => {
  for (const r of ['replay', 'bosses', 'timeline', 'parse']) {
    it(`/api/share/raid/<token>/${r} reads the row's group_ids and narrows with them`, () => {
      const s = src(...SHARE_API, r, 'route.ts');
      expect(s).toMatch(/shareGroupKey\(share\.row\)/);
    });
  }
  it('replay cuts the slice with narrowRows before the opt-out scrub, and keys its cache by the set', () => {
    const s = src(...SHARE_API, 'replay', 'route.ts');
    expect(s).toMatch(/if \(groups !== null\) got = narrowRows\(got, await loadGroupIndex\(db, win, anon\), groups\)/);
    expect(s.indexOf('narrowRows(')).toBeLessThan(s.indexOf('scrubMinuteData(r.data'));
    expect(s).toMatch(/groups \?\? ''\]/);
  });
  it('bosses, timeline and parse keep only the fights of the set', () => {
    expect(src(...SHARE_API, 'bosses', 'route.ts')).toMatch(/loadGroupFightIds\(/);
    expect(src(...SHARE_API, 'timeline', 'route.ts')).toMatch(/loadGroupFightIds\(/);
    const p = src(...SHARE_API, 'parse', 'route.ts');
    expect(p).toMatch(/loadGroupFightIds\([^)]*\)\)\.has\(id\)\) return NOT_FOUND\(\)/);
  });
  it('the geometry routes (map, mesh) return a zone\'s walls and read no raid data', () => {
    for (const r of ['map', 'mesh']) {
      const s = src(...SHARE_API, r, 'route.ts');
      expect(s).not.toMatch(/raid_track_minutes|encounters|encounter_players|looted_items/);
    }
  });
  it('the page loads the review limited to the row\'s raids, fails closed and shows nothing when none are left', () => {
    const s = src('app', 'share', 'raid', '[token]', 'page.tsx');
    expect(s).toMatch(/shareGroupKey\(share\.row\)/);
    expect(s).toMatch(/\{ group: groups, isolate: true \}/);
    expect(s).toMatch(/groups === null \|\| chosen > 0/);
  });
  it('the shares POST validates group_ids against the link\'s own window and stores them', () => {
    const s = src('app', 'api', 'raid', 'shares', 'route.ts');
    expect(s).toMatch(/checkShareGroups\(body\.group_ids, present\)/);
    expect(s).toMatch(/loadGroupIndex\(supabaseAdmin\(\), win\)/);
    expect(s).toMatch(/group_ids: groupIds,/);
  });
  it('the members\' page and replay route read a set, not one id', () => {
    expect(src('app', 'raid', 'session', 'page.tsx')).toMatch(/parseGroupIds\(one\(searchParams\.group\)\)/);
    expect(src('app', 'api', 'raid', 'session', 'replay', 'route.ts')).toMatch(/parseGroupIds\(q\.get\('group'\)\)/);
  });
  it('the picker is a set of toggles with aria-pressed and one "Show selected" link', () => {
    const s = src('app', 'raid', 'session', 'RaidPicker.tsx');
    expect(s).toMatch(/aria-pressed=\{on\}/);
    expect(s).toMatch(/Show selected \(\{picked\.length\}\)/);
    expect(src('app', 'raid', 'session', 'SegmentsEditor.tsx')).toMatch(/<RaidPicker /);
    expect(src('app', 'raid', 'session', 'RaidGroupsBar.tsx')).toMatch(/<RaidPicker /);
  });
});
