// test/kills-tab.test.js — what the session review's Kills tab lists (web/lib/killList.ts, lib/raidSession.ts buildKills,
// lib/raidSessionLoad.ts) and how a review narrows to one raid (the loader's `group`).
// The report (the guild lead, 2026-10-26): "where are the Carprin cycle mobs?" and "the failed Bertoxx attempts", from a tab
// that showed one fight of a window holding a dozen named ones.
//
//   1. NAMED      the default list is curated bosses PLUS every "#" mob, so a chain that is named but not curated appears;
//                 trash stays behind "Show all"; a window with no named fight lists everything.
//   2. WIPES      a wipe is its own row with its death count and is never counted as a kill.
//   3. FOREIGN    another guild's fight is listed with a tag instead of vanishing, and is not counted as a kill.
//   4. ZONE       a fight with no zone_short takes its zone from the NPC id (zoneid * 1000 + n); the row's own zone wins.
//   5. GROUPING   zones in the order the raid first fought in them, fights in time order inside.
//   6. LOADER     the encounters read asks for the listed marks only, names the zone ids it needs, and a review narrowed
//                 to one raid keeps that raid's attendance, fights and loot.
//
// Names are invented tokens. Run: npx vitest run test/kills-tab.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { MINUTE_MS } from '../web/lib/raidReplay.ts';
import { LISTED_MARKS, buildKills, npcZoneId } from '../web/lib/raidSession.ts';
import { clearOptedOutCache } from '../web/lib/raidShareLookup.ts';
import { hasNamed, isKill, killTabCount, listKills, UNKNOWN_ZONE } from '../web/lib/killList.ts';
import { loadSessionReview } from '../web/lib/raidSessionLoad.ts';
import { makeWindow, windowIso } from '../web/lib/raidShare.ts';
import { raidKey } from '../web/lib/sessionGroups.ts';

const T0 = Date.parse('2026-10-23T05:00:00Z');
const at = (min) => new Date(T0 + min * MINUTE_MS).toISOString();

const enc = (id, npc, name, minute, over = {}) => ({
  id, npc_id: npc, started_at: at(minute), ended_at: at(minute + 1), duration_sec: 40, total_damage: 1000,
  zone_short: null, classification: null, is_wipe: false, eqemu_npc_types: { name }, ...over,
});

describe('buildKills', () => {
  const zones = new Map([[200, 'codecay'], [205, 'podisease']]);
  const rows = buildKills([
    enc('a', 200230, '#Corvale_the_Warden', 0),
    enc('b', 200999, 'a_decayed_guard', 2),
    enc('c', 205091, '#Rethlan', 4, { zone_short: 'podisease_x' }),
    enc('d', 200226, '#Nyssara', 6, { classification: 'wipe', is_wipe: true }),
    enc('e', 200016, '#Zarrin', 8, { classification: 'foreign' }),
    enc('f', 200017, '#Brackwyn', 9, { classification: 'foreign', is_wipe: true }),
  ], [], new Set([200016]), new Map(), zones);
  const by = Object.fromEntries(rows.map(r => [r.id, r]));

  it('marks a "#" mob as named whether or not it is curated, and a plain mob as neither', () => {
    expect(by.a).toMatchObject({ named: true, boss: false, name: 'Corvale the Warden' });
    expect(by.b).toMatchObject({ named: false, boss: false });
    expect(by.e).toMatchObject({ named: true, boss: true });
  });
  it('flags wipes (the mark or the flag riding on another mark) and another guild\'s fights', () => {
    expect(by.d).toMatchObject({ wipe: true, foreign: false });
    expect(by.e).toMatchObject({ wipe: false, foreign: true });
    expect(by.f).toMatchObject({ wipe: true, foreign: true });
    expect(by.a).toMatchObject({ wipe: false, foreign: false });
  });
  it('takes the zone from the NPC id when the row has none, and keeps the row\'s own zone when it has one', () => {
    expect(by.a.zone).toBe('codecay');
    expect(by.c.zone).toBe('podisease_x');
    expect(npcZoneId(200230)).toBe(200);
    expect(npcZoneId(null)).toBeNull();
    expect(npcZoneId(12)).toBeNull();   // under 1000 encodes no zone
  });
  it('a zone nobody knows stays null, not a guess', () => {
    expect(buildKills([enc('z', 999001, '#Lost', 0)], [], new Set(), new Map(), zones)[0].zone).toBeNull();
  });
});

describe('the list', () => {
  const kills = buildKills([
    enc('chain1', 200230, '#Fran_Prisoal', 0),
    enc('trash1', 200901, 'a_decayed_guard', 1),
    enc('boss1', 205091, 'Grummus', 2, { zone_short: 'podisease' }),     // curated, no "#"
    enc('chain2', 200225, '#Avhi_Escron', 5),
    enc('wipe1', 200226, '#Bertoxxulous', 8, { classification: 'wipe', is_wipe: true }),
    enc('wipe2', 200226, '#Bertoxxulous', 12, { classification: 'wipe', is_wipe: true }),
    enc('other', 200016, '#Spectre_of_Corruption', 15, { classification: 'foreign' }),
  ], [], new Set([205091]), new Map(), new Map([[200, 'codecay']]));

  it('lists the named chain and the curated boss by default; trash stays behind Show all', () => {
    const ids = listKills(kills, 'named').flatMap(g => g.rows.map(r => r.kill.id));
    expect(ids.sort()).toEqual(['boss1', 'chain1', 'chain2', 'other', 'wipe1', 'wipe2']);
    expect(ids).not.toContain('trash1');
    expect(listKills(kills, 'all').flatMap(g => g.rows).length).toBe(7);
  });
  it('groups by zone in the order the raid first fought in them, fights in time order', () => {
    const g = listKills(kills, 'named');
    expect(g.map(x => x.zone)).toEqual(['codecay', 'podisease']);     // chain1 (minute 0) came before Grummus (minute 2)
    expect(g[0].rows.map(r => r.kill.id)).toEqual(['chain1', 'chain2', 'wipe1', 'wipe2', 'other']);
    expect(g[1].rows.map(r => r.kill.id)).toEqual(['boss1']);
  });
  it('a wipe is its own row with its death count, and is not a kill', () => {
    const deaths = [T0 + 8 * MINUTE_MS + 20_000, T0 + 8 * MINUTE_MS + 30_000, T0 + 9 * MINUTE_MS + 5_000, T0 + 30 * MINUTE_MS];
    const rows = listKills(kills, 'named', deaths).flatMap(g => g.rows);
    expect(rows.find(r => r.kill.id === 'wipe1')).toMatchObject({ result: 'wipe', deaths: 3 });
    expect(rows.find(r => r.kill.id === 'wipe2')).toMatchObject({ result: 'wipe', deaths: 0 });
    expect(rows.find(r => r.kill.id === 'chain1')).toMatchObject({ result: 'kill', deaths: null });
    expect(listKills(kills, 'named', null).flatMap(g => g.rows).find(r => r.kill.id === 'wipe1').deaths).toBeNull();   // shared page: no deaths known
    expect(kills.filter(isKill).map(k => k.id).sort()).toEqual(['boss1', 'chain1', 'chain2', 'trash1']);
  });
  it('another guild\'s fight is listed with its tag and is not a kill', () => {
    const row = listKills(kills, 'named').flatMap(g => g.rows).find(r => r.kill.id === 'other');
    expect(row).toMatchObject({ foreign: true, result: 'kill' });
    expect(isKill(row.kill)).toBe(false);
  });
  it('the tab count is kills among the named: no wipe, no other guild\'s fight, no trash', () => {
    expect(killTabCount(kills)).toBe(3);   // the two chain fights and the curated boss
  });
  it('a window with no named fight lists every fight, and a wipe still does not count', () => {
    const plain = buildKills([enc('t1', 200901, 'a_rat', 0), enc('t2', 200902, 'a_bat', 1, { classification: 'wipe', is_wipe: true })], [], new Set(), new Map());
    expect(hasNamed(plain)).toBe(false);
    expect(listKills(plain, 'named').flatMap(g => g.rows).length).toBe(2);
    expect(killTabCount(plain)).toBe(1);
    expect(listKills(plain, 'named')[0].zone).toBe(UNKNOWN_ZONE);
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

const crew = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
function minuteRow(win, k, parts) {
  const who = [], zones = [], raids = [], f = [0];
  for (const p of parts) {
    let zi = zones.indexOf(p.zone); if (zi < 0) { zi = zones.length; zones.push(p.zone); }
    let ri = -1;
    if (p.tag) { const key = raidKey(p.tag); ri = raids.indexOf(key); if (ri < 0) { ri = raids.length; raids.push(key); } }
    for (const n of p.names) { const i = who.length; who.push([n, 'WAR', 1, 60, ri]); f.push(i, 1, 2, 3, 4, 90, zi); }
  }
  return { minute_at: new Date(win.fromMs + k * MINUTE_MS).toISOString(), night_key: '10/22/2026', zones, raiders: who.length, data: JSON.stringify({ v: 1, step_s: 3, who, zones, f: [f], raids }) };
}

describe('the loader', () => {
  const W = makeWindow(T0 + 3 * 24 * 60 * MINUTE_MS, T0 + 3 * 24 * 60 * MINUTE_MS + 40 * MINUTE_MS);   // its own window: the loader memoizes per window
  const { from } = windowIso(W);
  const A = crew('Aldenmar', 10), B = crew('Brackwyn', 8);
  // 29 rows, under the loader's 30-row page: the fake answers every page with the same rows, so a full page would never end.
  const minutes = Array.from({ length: 29 }, (_, k) => minuteRow(W, k, [{ zone: 'x', tag: 'Corvale', names: A }, { zone: 'x', tag: 'Rethlan', names: B }]));
  const ep = (id, names) => names.map(n => ({ encounter_id: id, character_name: n, total_damage: 100, dps: 1 }));
  const encounters = [
    { ...enc('fa', 200230, '#Fran_Prisoal', 0), started_at: from, ended_at: at(3 * 24 * 60 + 5) },
    { ...enc('fb', 200225, '#Avhi_Escron', 0), started_at: from, ended_at: at(3 * 24 * 60 + 6) },
    { ...enc('fw', 200226, '#Bertoxxulous', 0, { classification: 'wipe', is_wipe: true }), started_at: from, ended_at: at(3 * 24 * 60 + 7) },
  ];
  const tables = {
    characters: [],
    raid_track_minutes: minutes,
    encounters,
    bosses_local: [],
    eqemu_zone: [{ zone_id: 200, short_name: 'codecay' }],
    encounter_players: [...ep('fa', A.slice(0, 5)), ...ep('fb', B.slice(0, 5)), ...ep('fw', A.slice(0, 4))],
    looted_items: [
      { looter_character: A[0], item_name: 'Thing A', zone: 'x', looted_at: at(3 * 24 * 60 + 5), from_own_pet: false },
      { looter_character: B[0], item_name: 'Thing B', zone: 'x', looted_at: at(3 * 24 * 60 + 5), from_own_pet: false },
    ],
  };
  const idOf = (tag) => 'r' + raidKey(tag);

  it('reads the encounters with the listed marks only, and the zone of a fight that has none from the NPC id', async () => {
    clearOptedOutCache();
    const db = fakeDb(tables);
    const out = await loadSessionReview(db, W);
    const q = db.queries.find(x => x.table === 'encounters');
    expect(q.ops.some(o => o[0] === 'or' && o[1] === LISTED_MARKS)).toBe(true);
    expect(q.ops.some(o => o[0] === 'is' && o[1] === 'classification')).toBe(false);
    const z = db.queries.find(x => x.table === 'eqemu_zone');
    expect(z.ops.find(o => o[0] === 'in')[2]).toEqual([200]);
    expect(out.bundle.kills.map(k => k.zone)).toEqual(['codecay', 'codecay', 'codecay']);
    expect(out.bundle.kills.find(k => k.id === 'fw')).toMatchObject({ wipe: true, named: true });
  });
  it('without a group: everyone is in the attendance, and no raid list is built', async () => {
    clearOptedOutCache();
    const out = await loadSessionReview(fakeDb({ ...tables }), W, { breaks: true });
    expect(out.bundle.attendance.length).toBe(A.length + B.length);
    expect(out.groups).toBeUndefined();
  });
  it('lists the raids and, narrowed to one, keeps only its raiders, its fights and its loot', async () => {
    clearOptedOutCache();
    const out = await loadSessionReview(fakeDb({ ...tables }), W, { groups: true, group: idOf('Corvale') });
    expect(out.groups.map(g => g.size)).toEqual([10, 8]);
    expect(out.group).toBe(idOf('Corvale'));
    expect(out.bundle.attendance.map(a => a.name).sort()).toEqual([...A].sort());
    expect(out.bundle.kills.map(k => k.id).sort()).toEqual(['fa', 'fw']);                 // the other raid fought fb
    expect(out.bundle.loot.map(l => l.item)).toEqual(['Thing A']);
    expect(out.bundle.minutesRecorded).toBe(29);
    expect(out.night).not.toBeNull();
  });
  it('a group id the window does not hold is ignored: the whole window, never an empty or a wrong raid', async () => {
    clearOptedOutCache();
    const out = await loadSessionReview(fakeDb({ ...tables }), W, { groups: true, group: 'rdeadbeef' });
    expect(out.group).toBeNull();
    expect(out.bundle.attendance.length).toBe(A.length + B.length);
  });
  it('a part of the window is cut by the raids counted in the whole one (groupWin)', async () => {
    clearOptedOutCache();
    const part = makeWindow(W.fromMs + 10 * MINUTE_MS, W.fromMs + 20 * MINUTE_MS);
    await loadSessionReview(fakeDb({ ...tables }), W, { groups: true });          // counts the raids in the whole window
    const db = fakeDb({ ...tables, raid_track_minutes: minutes.slice(10, 20) });   // the part's own rows
    const out = await loadSessionReview(db, part, { groups: true, group: idOf('Rethlan'), groupWin: W });
    expect(out.group).toBe(idOf('Rethlan'));
    expect(out.bundle.attendance.map(a => a.name).sort()).toEqual([...B].sort());
    expect(out.bundle.minutesRecorded).toBe(10);
  });
});

describe('source', () => {
  const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  it('the Kills tab lists through killList and the page narrows the deaths to the same raid', () => {
    expect(read('web/app/raid/session/SessionReview.tsx')).toMatch(/listKills\(kills, level, deaths\)/);
    expect(read('web/app/raid/session/page.tsx')).toMatch(/loadNightMarks\(admin, win, review\.bundle\.kills, raid\)/);
  });
});
