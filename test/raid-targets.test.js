// utils/raidTargets.js — the raid's targets and the shared escort trails for the Mimic Map (the guild lead,
// 2026-10-14: "also important for MA" and "for these types of babysitting escort quests").
//
// The module is pure apart from an injected supabase / clock / timer, so every rule below runs for real: ingest,
// raid scoping, the trail rules, bot_kv batching. The two routes that call it live in the index.js monolith and
// are checked as TEXT with comments stripped (stripJs).
//
// Mutation-checked (2026-10-14): id-0 guard removed, player/corpse filter removed, scope 'multi' check removed,
// group/zone fail-closed flipped to fail-open, the 100-unit shown gate removed, the jump / gap breaks removed, the
// 800 cap removed, the 12 h drop removed, the save batching removed (a write per sample), the load-before-write
// guard removed, the live-state wiring and the map-sync wiring removed — each turns at least one test red.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const RT = nodeRequire('./utils/raidTargets');
const { cleanSample, keepSample, shownStretches, create, normName } = RT;

const T0 = Date.UTC(2026, 9, 14, 20, 0, 0);
const rec = (over = {}) => ({ character: 'Aldenmar', zone: 'ponightmare', target_id: 4321, target_name: 'a gnoll pup',
  target_type: 1, target_map: { x: 100, y: 200, z: 3 }, ...over });
const THELIN = (over = {}) => rec({ target_name: 'Thelin Poxbourne', target_id: 77, ...over });

function clock(t = T0) { const c = { t, now: () => c.t, adv: (ms) => { c.t += ms; } }; return c; }
function fakeTimers() {
  const q = [];
  return { q, setTimer: (fn, ms) => { const h = { fn, ms, cleared: false, unref() {} }; q.push(h); return h; },
    clearTimer: (h) => { h.cleared = true; }, fire: () => { const h = q.shift(); if (h && !h.cleared) h.fn(); } };
}
function fakeSupabase({ stored = null, selectResult } = {}) {
  const calls = { select: [], upsert: [] };
  return { calls, isEnabled: () => true, guildId: () => 'wolfpack',
    select: async (t, q) => { calls.select.push([t, q]); return selectResult !== undefined ? selectResult : (stored ? [{ value: stored }] : []); },
    upsert: async (t, rows, on) => { calls.upsert.push([t, rows, on]); return rows; } };
}
const mk = (over = {}) => { const c = clock(); const tm = fakeTimers(); return { c, tm, rt: create({ now: c.now, setTimer: tm.setTimer, clearTimer: tm.clearTimer, log: { warn() {} }, ...over }) }; };
const RAID = (key, multi = false) => ({ mode: 'raid', raidKey: key, multi });
const flush = () => new Promise(r => setImmediate(r));

describe('cleanSample', () => {
  it('takes a placeable NPC target', () => {
    expect(cleanSample(rec())).toEqual({ character: 'Aldenmar', zone: 'ponightmare', id: 4321, name: 'a gnoll pup', type: 1, x: 100, y: 200, z: 3 });
  });
  it('treats target id 0 (and a missing id) as no target', () => {
    expect(cleanSample(rec({ target_id: 0 }))).toBeNull();
    expect(cleanSample(rec({ target_id: null }))).toBeNull();
    expect(cleanSample(rec({ target_id: -5 }))).toBeNull();
    expect(cleanSample(rec({ target_id: 1.5 }))).toBeNull();
  });
  it('drops players, corpses, a missing position and an odd zone', () => {
    expect(cleanSample(rec({ target_type: 0 }))).toBeNull();
    expect(cleanSample(rec({ target_type: 2 }))).toBeNull();
    expect(cleanSample(rec({ target_name: "a gnoll pup's corpse" }))).toBeNull();
    expect(cleanSample(rec({ target_map: null }))).toBeNull();
    expect(cleanSample(rec({ target_map: { x: 'a', y: 1 } }))).toBeNull();
    expect(cleanSample(rec({ target_map: { x: 1e9, y: 1 } }))).toBeNull();
    expect(cleanSample(rec({ zone: 'Bad Zone' }))).toBeNull();
    expect(cleanSample(rec({ character: '' }))).toBeNull();
  });
  it('accepts a missing type (an older Zeal) as an NPC', () => {
    expect(cleanSample(rec({ target_type: undefined }))).not.toBeNull();
  });
});

describe('normName', () => {
  it('lowercases, drops a leading #, turns _ into a space, drops the possessive corpse and duplicate number', () => {
    expect(normName('#Thelin_Poxbourne')).toBe('thelin poxbourne');
    expect(normName('Garadain Glacierbane00')).toBe('garadain glacierbane');
    expect(normName("Thelin Poxbourne's corpse")).toBe('thelin poxbourne');
  });
});

describe('targetsFor: ingest and aggregation', () => {
  it('serves each targeted NPC once with how many raiders are on it and the latest position', () => {
    const { c, rt } = mk();
    const own = new Set();
    rt.noteSample(rec({ character: 'Aldenmar', target_map: { x: 1, y: 1, z: 0 } }));
    c.adv(2000);
    rt.noteSample(rec({ character: 'Brackwyn', target_map: { x: 50, y: 60, z: 0 } }));
    rt.noteSample(rec({ character: 'Corvale', target_id: 9, target_name: 'a orc', target_map: { x: 9, y: 9, z: 0 } }));
    const out = rt.targetsFor({ zone: 'ponightmare', scope: RAID('r1'), raidForName: () => 'r1', own });
    expect(out.map(t => [t.id, t.n, t.x, t.y])).toEqual([[4321, 2, 50, 60], [9, 1, 9, 9]]);
    expect(out[0]).toMatchObject({ name: 'a gnoll pup', type: 1, at: T0 + 2000 });
  });
  it('serves only the asked zone', () => {
    const { rt } = mk();
    rt.noteSample(rec()); rt.noteSample(rec({ character: 'Brackwyn', zone: 'cazicthule' }));
    expect(rt.targetsFor({ zone: 'cazicthule', scope: RAID('r1'), raidForName: () => 'r1', own: new Set() }).length).toBe(1);
  });
  it('a record with no usable target clears that character\'s sample', () => {
    const { rt } = mk();
    rt.noteSample(rec());
    rt.noteSample(rec({ target_id: 0, target_name: null, target_map: null }));
    expect(rt.targetsFor({ zone: 'ponightmare', scope: RAID('r1'), raidForName: () => 'r1', own: new Set() })).toEqual([]);
  });
  it('forgets a sample after 90 s', () => {
    const { c, rt } = mk();
    rt.noteSample(rec());
    c.adv(90 * 1000 + 1);
    expect(rt.targetsFor({ zone: 'ponightmare', scope: RAID('r1'), raidForName: () => 'r1', own: new Set() })).toEqual([]);
    expect(rt._samples.size).toBe(0);
  });
  it('forget() drops a character at once', () => {
    const { rt } = mk();
    rt.noteSample(rec()); rt.forget('ALDENMAR');
    expect(rt._samples.size).toBe(0);
  });
});

describe('scope: another raid\'s targets never show', () => {
  const raidForName = (n) => ({ aldenmar: 'rA', brackwyn: 'rA', corvale: 'rB' }[n] || null);
  const seed = (rt) => {
    rt.noteSample(rec({ character: 'Aldenmar', target_id: 1, target_name: 'a mob one' }));
    rt.noteSample(rec({ character: 'Corvale', target_id: 2, target_name: 'a mob two' }));
    rt.noteSample(rec({ character: 'Nyssara', target_id: 3, target_name: 'a mob three' }));   // in no raid
  };
  const ids = (rt, scope, own = new Set()) => rt.targetsFor({ zone: 'ponightmare', scope, raidForName, own }).map(t => t.id).sort();

  it('two raids live: the other raid\'s target is excluded, a raider in no raid stays (fail open, as Extended Target)', () => {
    const { rt } = mk(); seed(rt);
    expect(ids(rt, RAID('rA', true))).toEqual([1, 3]);
    expect(ids(rt, RAID('rB', true))).toEqual([2, 3]);
  });
  it('one raid: everyone in the zone', () => {
    const { rt } = mk(); seed(rt);
    expect(ids(rt, RAID('rA', false))).toEqual([1, 2, 3]);
  });
  it('a group sees its own group and nobody else', () => {
    const { rt } = mk(); seed(rt);
    expect(ids(rt, { mode: 'group', names: new Set(['aldenmar', 'nyssara']) })).toEqual([1, 3]);
  });
  it('no raid and no group (or the kill switch) shows only your own characters', () => {
    const { rt } = mk(); seed(rt);
    expect(ids(rt, { mode: 'zone' }, new Set(['corvale']))).toEqual([2]);
    expect(ids(rt, { mode: 'legacy' }, new Set())).toEqual([]);
    expect(ids(rt, null, new Set())).toEqual([]);
  });
  it('your own character is always yours, whatever the scope', () => {
    expect(keepSample({ mode: 'group', names: new Set() }, 'Aldenmar', { own: new Set(['aldenmar']) })).toBe(true);
  });
});

describe('escort trail rules', () => {
  const walk = (rt, c, from, n, stepUnits = 20, stepMs = 5000, over = {}) => {
    for (let i = 0; i < n; i++) { rt.noteSample(THELIN({ target_map: { x: from + i * stepUnits, y: 0, z: 0 }, ...over })); c.adv(stepMs); }
  };
  const trail = (rt) => rt._trails.get('ponightmare|thelin poxbourne');

  it('only listed escorts are trailed, matched on zone + name (never the spawn id)', () => {
    const { rt } = mk();
    rt.noteSample(rec());                                                  // a gnoll pup: not an escort
    rt.noteSample(THELIN({ zone: 'cazicthule' }));                         // right name, wrong zone
    expect(rt._trails.size).toBe(0);
    rt.noteSample(THELIN({ target_id: 1 })); rt.noteSample(THELIN({ target_id: 99999, target_map: { x: 50, y: 0, z: 0 } }));
    expect(trail(rt).pts.length).toBe(2);                                  // two different ids, one trail
  });
  it('keeps a point only every 12+ units', () => {
    const { rt } = mk();
    rt.noteSample(THELIN({ target_map: { x: 0, y: 0, z: 0 } }));
    rt.noteSample(THELIN({ target_map: { x: 11, y: 0, z: 0 } }));
    rt.noteSample(THELIN({ target_map: { x: 12, y: 0, z: 0 } }));
    expect(trail(rt).pts.map(p => p[0])).toEqual([0, 12]);
  });
  it('breaks the line after a 20 s gap and after a 400-unit jump, not before', () => {
    const { c, rt } = mk();
    rt.noteSample(THELIN({ target_map: { x: 0, y: 0, z: 0 } })); c.adv(20000);
    rt.noteSample(THELIN({ target_map: { x: 30, y: 0, z: 0 } }));          // exactly 20 s: no break
    c.adv(20001);
    rt.noteSample(THELIN({ target_map: { x: 60, y: 0, z: 0 } }));          // over 20 s: break
    c.adv(1000);
    rt.noteSample(THELIN({ target_map: { x: 460, y: 0, z: 0 } }));         // exactly 400 away: no break
    c.adv(1000);
    rt.noteSample(THELIN({ target_map: { x: 861, y: 0, z: 0 } }));         // 401 away: break
    expect(trail(rt).pts.map(p => p[4])).toEqual([0, 0, 1, 0, 1]);
  });
  it('a watched-but-standing escort does not open a gap (the look refreshes the clock)', () => {
    const { c, rt } = mk();
    rt.noteSample(THELIN({ target_map: { x: 0, y: 0, z: 0 } }));
    for (let i = 0; i < 6; i++) { c.adv(10000); rt.noteSample(THELIN({ target_map: { x: 1, y: 0, z: 0 } })); }
    rt.noteSample(THELIN({ target_map: { x: 40, y: 0, z: 0 } }));
    expect(trail(rt).pts.map(p => p[4])).toEqual([0, 0]);
  });
  it('keeps at most 800 points, newest', () => {
    const { c, rt } = mk();
    walk(rt, c, 0, 850, 13, 1000);
    expect(trail(rt).pts.length).toBe(800);
    expect(trail(rt).pts[799][0]).toBe(849 * 13);
  });
  it('drops a trail not added to for 12 h', () => {
    const { c, rt } = mk();
    walk(rt, c, 0, 10, 20, 1000);
    c.adv(12 * 3600 * 1000 + 1);
    rt.noteSample(THELIN({ target_map: { x: 5000, y: 0, z: 0 } }));
    expect(trail(rt).pts.length).toBe(1);
  });
});

describe('trailsFor: what is served', () => {
  const nodes = (rt, c, xs, over = {}) => { for (const x of xs) { rt.noteSample(THELIN({ target_map: { x, y: 0, z: 0 }, ...over })); c.adv(3000); } };

  it('an idle copy that never moved 100 units is not served', async () => {
    const { c, rt } = mk();
    nodes(rt, c, [0, 13, 26, 39, 52, 65, 78, 91]);
    expect(await rt.trailsFor('ponightmare', 0)).toEqual({});
  });
  it('is served once it has moved 100 units, with the name, live flag and points', async () => {
    const { c, rt } = mk();
    nodes(rt, c, [0, 30, 60, 90, 120]);
    const r = await rt.trailsFor('ponightmare', 0);
    expect(r['thelin poxbourne'].name).toBe('Thelin Poxbourne');
    expect(r['thelin poxbourne'].pts.map(p => p[0])).toEqual([0, 30, 60, 90, 120]);
    expect(r['thelin poxbourne'].live).toBe(true);
    c.adv(16000);
    expect((await rt.trailsFor('ponightmare', 0))['thelin poxbourne'].live).toBe(false);
  });
  it('a stationary town copy is dropped, the walker beyond a jump is kept', async () => {
    const { c, rt } = mk();
    nodes(rt, c, [0, 13]);                                        // idle town copy
    nodes(rt, c, [2000, 2030, 2060, 2090, 2120]);                 // the walker, far away (a break)
    const pts = (await rt.trailsFor('ponightmare', 0))['thelin poxbourne'].pts;
    expect(pts.map(p => p[0])).toEqual([2000, 2030, 2060, 2090, 2120]);
  });
  it('a reader past tsince gets only newer points, but a stretch that just qualified comes whole', async () => {
    const { c, rt } = mk();
    nodes(rt, c, [0, 30, 60]);                                    // not 100 yet
    const mid = c.t;
    expect(await rt.trailsFor('ponightmare', 0)).toEqual({});
    nodes(rt, c, [90, 120]);                                       // crosses 100 after `mid`
    const whole = (await rt.trailsFor('ponightmare', mid))['thelin poxbourne'].pts;
    expect(whole.map(p => p[0])).toEqual([0, 30, 60, 90, 120]);
    const had = (await rt.trailsFor('ponightmare', 0))['thelin poxbourne'].pts;
    nodes(rt, c, [150]);
    const delta = (await rt.trailsFor('ponightmare', had[had.length - 1][3]))['thelin poxbourne'].pts;
    expect(delta.map(p => p[0])).toEqual([150]);
  });
  it('serves nothing for a zone with no escorts', async () => {
    const { rt } = mk();
    expect(await rt.trailsFor('lavastorm', 0)).toEqual({});
  });
});

describe('shownStretches', () => {
  it('splits at breaks and keeps a stretch only once it is 100 away from its start', () => {
    const p = (x, t, brk = 0) => [x, 0, 0, t, brk];
    const s = shownStretches([p(0, 1), p(50, 2), p(0, 3, 1), p(120, 4)]);
    expect(s.length).toBe(1);
    expect(s[0].pts.length).toBe(2);
    expect(shownStretches([p(0, 1), p(99, 2)])).toEqual([]);
    expect(shownStretches([p(0, 1), p(100, 2)])[0].qt).toBe(2);
  });
});

describe('bot_kv: batched, per guild + zone + name', () => {
  it('writes the first change at once, then at most once per 10 s per trail', async () => {
    const sb = fakeSupabase();
    const { c, tm, rt } = mk({ supabase: sb });
    rt.noteSample(THELIN({ target_map: { x: 0, y: 0, z: 0 } }));
    await flush();                                    // the load comes back; the waiting change is written
    expect(sb.calls.upsert.length).toBe(1);
    for (let i = 1; i <= 8; i++) { c.adv(1000); rt.noteSample(THELIN({ target_map: { x: i * 20, y: 0, z: 0 } })); }
    await flush();
    expect(sb.calls.upsert.length).toBe(1);           // eight samples in eight seconds: still one write
    c.adv(2000);
    tm.fire(); await flush();
    expect(sb.calls.upsert.length).toBe(2);           // the burst lands when the interval ends
    expect(sb.calls.upsert[1][1][0].value.pts.length).toBe(9);
  });
  it('keys the row by guild, zone and normalised name; the value carries no character', async () => {
    const sb = fakeSupabase();
    const { rt } = mk({ supabase: sb });
    rt.noteSample(THELIN({ character: 'Aldenmar', target_name: '#Thelin_Poxbourne' }));
    await flush();
    const [table, rows, on] = sb.calls.upsert[0];
    expect(table).toBe('bot_kv'); expect(on).toBe('guild_id,key');
    expect(rows[0].guild_id).toBe('wolfpack');
    expect(rows[0].key).toBe('escort_trail:ponightmare:thelin_poxbourne');
    expect(JSON.stringify(rows[0].value)).not.toMatch(/aldenmar/i);
    expect(sb.calls.select[0][1]).toContain('key=eq.escort_trail%3Aponightmare%3Athelin_poxbourne');
  });
  it('writes nothing until a read has succeeded, then retries the read a minute later', async () => {
    const sb = fakeSupabase({ selectResult: null });
    const { c, rt } = mk({ supabase: sb });
    rt.noteSample(THELIN({ target_map: { x: 0, y: 0, z: 0 } }));
    await flush();
    expect(sb.calls.upsert.length).toBe(0);
    c.adv(30000); rt.noteSample(THELIN({ target_map: { x: 40, y: 0, z: 0 } })); await flush();
    expect(sb.calls.select.length).toBe(1);           // not yet a minute
    sb.select = async (t, q) => { sb.calls.select.push([t, q]); return []; };
    c.adv(31000); rt.noteSample(THELIN({ target_map: { x: 80, y: 0, z: 0 } })); await flush();
    expect(sb.calls.upsert.length).toBe(1);
    expect(sb.calls.upsert[0][1][0].value.pts.length).toBe(3);
  });
  it('a restart picks the stored trail up and joins the new points to it (a break if too long a gap)', async () => {
    const stored = { name: 'Thelin Poxbourne', at: T0 - 5000, pts: [[0, 0, 0, T0 - 65000, 0], [60, 0, 0, T0 - 5000, 0]] };
    const sb = fakeSupabase({ stored });
    const { rt } = mk({ supabase: sb });
    rt.noteSample(THELIN({ target_map: { x: 120, y: 0, z: 0 } }));
    await flush();
    expect(rt._trails.get('ponightmare|thelin poxbourne').pts.map(p => [p[0], p[4]])).toEqual([[0, 0], [60, 0], [120, 0]]);
    const r = await rt.trailsFor('ponightmare', 0);
    expect(r['thelin poxbourne'].pts.length).toBe(3);
  });
  it('a restart after a long wait marks the join as a break', async () => {
    const stored = { name: 'Thelin Poxbourne', at: T0 - 60000, pts: [[0, 0, 0, T0 - 90000, 0], [60, 0, 0, T0 - 60000, 0]] };
    const { rt } = mk({ supabase: fakeSupabase({ stored }) });
    rt.noteSample(THELIN({ target_map: { x: 120, y: 0, z: 0 } }));
    await flush();
    expect(rt._trails.get('ponightmare|thelin poxbourne').pts.map(p => p[4])).toEqual([0, 0, 1]);
  });
  it('a stored trail older than 12 h is ignored', async () => {
    const sb = fakeSupabase({ stored: { name: 'Thelin Poxbourne', at: T0 - 13 * 3600 * 1000, pts: [[0, 0, 0, T0 - 13 * 3600 * 1000, 0]] } });
    const { rt } = mk({ supabase: sb });
    rt.noteSample(THELIN({ target_map: { x: 60, y: 0, z: 0 } }));
    await flush();
    expect(rt._trails.get('ponightmare|thelin poxbourne').pts.length).toBe(1);
  });
  it('flush() does not write a trail whose read has not succeeded either', async () => {
    const sb = fakeSupabase({ selectResult: null });
    const { rt } = mk({ supabase: sb });
    rt.noteSample(THELIN({ target_map: { x: 0, y: 0, z: 0 } })); await flush();
    await rt.flush();
    expect(sb.calls.upsert.length).toBe(0);
  });
  it('flush() writes whatever is waiting', async () => {
    const sb = fakeSupabase();
    const { c, rt } = mk({ supabase: sb });
    rt.noteSample(THELIN({ target_map: { x: 0, y: 0, z: 0 } })); await flush();
    c.adv(1000); rt.noteSample(THELIN({ target_map: { x: 40, y: 0, z: 0 } }));
    expect(sb.calls.upsert.length).toBe(1);
    await rt.flush();
    expect(sb.calls.upsert.length).toBe(2);
  });
  it('without Supabase everything still works from memory', async () => {
    const { c, rt } = mk();
    for (let i = 0; i < 6; i++) { rt.noteSample(THELIN({ target_map: { x: i * 30, y: 0, z: 0 } })); c.adv(1000); }
    expect(Object.keys(await rt.trailsFor('ponightmare', 0))).toEqual(['thelin poxbourne']);
  });
});

describe('the routes (text, comments stripped)', () => {
  const src = stripJs(readSource(BOT_INDEX));
  const live = src.slice(src.indexOf('async function _handleAgentLiveState('), src.indexOf('async function _handleAgentAriLead('));
  const get = src.slice(src.indexOf('async function _handleAgentMapSyncGet('), src.indexOf('async function _raidTargetsFor('));

  it('live-state hands each record\'s target fields to the store and keeps them off the upserted row', () => {
    expect(live).toMatch(/_raidTargets\(\)\.noteSample\(\{[^}]*target_id: targetId[^}]*target_name: targetName[^}]*target_map: st\?\.target_map/);
    const rowBlock = live.slice(live.indexOf('rows.push({'), live.indexOf('if (rows.length === 0 && swaps.length === 0)'));
    expect(rowBlock).not.toMatch(/target_map|target_zone|target_type/);
  });
  it('live-state forgets a character that swapped away', () => {
    expect(live).toMatch(/swaps\.push\(\{[^}]*\}\);\s*_raidTargets\(\)\.forget\(character\);/);
  });
  it('map-sync GET adds targets and trails to the events, failing soft', () => {
    expect(get).toMatch(/Object\.assign\(out, await _raidTargetsFor\(identity, zone, sp\)\)/);
    expect(get).toMatch(/catch \(err\)/);
    expect(get).toMatch(/events: hit\.events\.filter\(e => e\.at > since\)/);
  });
  it('_raidTargetsFor scopes by the requester\'s raid, group and own characters, and passes tsince', () => {
    const f = src.slice(src.indexOf('async function _raidTargetsFor('), src.indexOf('let _whoOverrideCache'));
    expect(f).toMatch(/_groupScopeInputs\(identity\.discord_id\)/);
    expect(f).toMatch(/_groupScope\.scopeFor\(/);
    expect(f).toMatch(/raidForName: inp\.split \? inp\.split\.raidForName : null/);
    expect(f).toMatch(/own: new Set\(inp\.characters/);
    expect(f).toMatch(/sp\.get\('tsince'\)/);
  });
});
