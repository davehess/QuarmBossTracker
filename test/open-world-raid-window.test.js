// test/open-world-raid-window.test.js — Quarm patch 2026-10-28: open-world raid targets (through Luclin)
// respawn on a random 7 to 11 day timer after the kill. Earthquakes and guild instances work as before, and
// Plane of Power open-world respawns have their own switch, which is off.
//
// The open-world kill track is utils/state.js recordPvpKill (+ the pvp_boss_kills mirror that feeds
// https://wolfpack.quest/pvp). It used to open every window at base timer x 0.8 and close it at x 1.2. These tests run
// the REAL recordPvpKill / applyQuakeToAllPvpKills / recordKill source (state held in memory, no file) and the real
// mirrorPvpBossKill (fetch stubbed), so they fail if the rule moves.
// Server rule: EQMacEmu zone/spawn2.cpp, Spawn2::resetTimer, commit f6e20a0 (#489); PoP switch commit 243f101 (#490).

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import path from 'node:path';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const timer = require('../utils/timer.js');
const bosses = require('../data/bosses.json');
const byId = (id) => bosses.find((b) => b.id === id);
const H = 3600000;
const D = 24 * H;
const KILL = Date.parse('2026-10-29T02:00:00Z');

function makeState() {
  const src = readSource(path.join(ROOT, 'utils', 'state.js'));
  const pvp = sliceBlock(src, 'function pvpMobKey(', '\n') + sliceBlock(src, 'function recordPvpKill(', '\n}\n');
  const quake = sliceBlock(src, 'function applyQuakeToAllPvpKills(', '\n}\n');
  const S = { pvpKills: {}, bosses: {}, dailyKills: [] };
  const api = new Function('S', 'require', `const loadState = () => S; const saveState = () => {};
    const getAllPvpKills = () => S.pvpKills;
    ${pvp}\n${quake}\nreturn { recordPvpKill, applyQuakeToAllPvpKills, getAllPvpKills };`)(S, (m) => require(m.startsWith('./') ? path.join(ROOT, 'utils', m) : m));
  return { ...api, S };
}

function record(st, id, killedAt = KILL) {
  const b = byId(id);
  expect(b, id).toBeTruthy();
  const key = st.recordPvpKill(b.name, b.timerHours, 'auto:test', b.id, false, killedAt, b.expansion);
  return st.getAllPvpKills()[key];
}

describe('open-world raid targets through Luclin: a 7 to 11 day window', () => {
  it('Kunark target (Trakanon, 66h board timer): earliest kill+7d, latest kill+11d', () => {
    const st = makeState();
    const e = record(st, 'trakanon');
    expect(byId('trakanon').expansion).toBe('Kunark');
    expect(e.nextSpawn - e.killedAt).toBe(7 * D);
    expect(e.nextSpawnLatest - e.killedAt).toBe(11 * D);
  });

  it('Velious target (King Tormax, 162h board timer) gets the same window, not 162h +/-20%', () => {
    const st = makeState();
    const e = record(st, 'king_tormax');
    expect(byId('king_tormax').expansion).toBe('Velious');
    expect(e.nextSpawn - e.killedAt).toBe(7 * D);
    expect(e.nextSpawnLatest - e.killedAt).toBe(11 * D);
  });

  it('every Classic, Kunark, Velious and Luclin board boss gets the window; none of them is PoP', () => {
    const st = makeState();
    const ids = bosses.filter((b) => ['Classic', 'Kunark', 'Velious', 'Luclin'].includes(b.expansion));
    expect(ids.length).toBeGreaterThan(100);
    for (const b of ids) {
      const e = record(st, b.id);
      expect(e.nextSpawn - e.killedAt, b.id).toBe(7 * D);
      expect(e.nextSpawnLatest - e.killedAt, b.id).toBe(11 * D);
    }
  });

  it('the kill card says so (7 to 11 days, not a base timer with a variance)', () => {
    expect(timer.openWorldSpawnWindow(66, 'Kunark').label).toBe('7 to 11 days');
    expect(timer.openWorldSpawnWindow(66, 'PoP').label).toBe('66h (±20%)');
  });
});

describe('what does NOT change', () => {
  it('a Plane of Power open-world kill keeps base timer +/-20% (the PoP switch is off)', () => {
    const st = makeState();
    const b = byId('terris_thule');
    expect(b.expansion).toBe('PoP');
    const e = record(st, 'terris_thule');
    expect(e.nextSpawn - e.killedAt).toBe(b.timerHours * H * 0.8);
    expect(e.nextSpawnLatest - e.killedAt).toBe(b.timerHours * H * 1.2);
  });

  it('a kill recorded with no expansion keeps the old window rather than guessing', () => {
    const st = makeState();
    st.recordPvpKill('A Thing', 66, 'u', 'a_thing', false, KILL);
    const e = st.getAllPvpKills().a_thing;
    expect(e.nextSpawn - KILL).toBe(66 * H * 0.8);
    expect(e.nextSpawnLatest - KILL).toBe(66 * H * 1.2);
  });

  it('a quake still opens the window now and leaves the latest edge and kill time alone', () => {
    const st = makeState();
    const k = record(st, 'trakanon');
    const p = record(st, 'terris_thule');
    const killedAt = k.killedAt;
    const quakeAt = KILL + 2 * D;
    st.applyQuakeToAllPvpKills(quakeAt);
    expect(k.nextSpawn).toBe(quakeAt);
    expect(k.nextSpawnLatest - killedAt).toBe(11 * D);
    expect(k.killedAt).toBe(killedAt);
    expect(p.nextSpawn).toBe(quakeAt);
    expect(p.nextSpawnLatest - killedAt).toBe(byId('terris_thule').timerHours * H * 1.2);
  });

  it('a guild-instance kill (the main board, recordKill) still runs the boss timer exactly', () => {
    const src = readSource(path.join(ROOT, 'utils', 'state.js'));
    const inner = sliceBlock(src, 'function recordKill(', '\n}\n');
    const wrapper = sliceBlock(src, 'const _killListeners = [];', '  return entry;\n}\n');
    const S = { bosses: {}, dailyKills: [] };
    const rk = new Function('S', 'slowMode', 'potime',
      `const loadState = () => S; const saveState = () => {};\n${inner}\n${wrapper}\nreturn recordKillNotifying;`)(S, require('../utils/slowMode.js'), require('../utils/potimeCycle.js'));
    const b = byId('trakanon');
    const e = rk(b.id, b.timerHours, 'u', KILL);
    expect(e.nextSpawn - e.killedAt).toBe(b.timerHours * H);
  });
});

describe('the web board mirror (pvp_boss_kills) uses the same window', () => {
  const saved = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  afterEach(() => {
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  });

  async function mirrored(id) {
    process.env.SUPABASE_URL = 'https://example.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    let body = null;
    globalThis.fetch = async (_u, opts) => {
      body = JSON.parse(opts.body);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const sb = require('../utils/supabase.js');
    const b = byId(id);
    await sb.mirrorPvpBossKill({
      boss_id: b.id, boss_name: b.name, zone: b.zone, expansion: b.expansion, timer_hours: b.timerHours,
      killed_at: new Date(KILL).toISOString(), source: 'slash_command',
    });
    return Array.isArray(body) ? body[0] : body;
  }

  it('an open-world Velious target is mirrored as kill+7d to kill+11d', async () => {
    const row = await mirrored('king_tormax');
    expect(Date.parse(row.spawn_earliest) - KILL).toBe(7 * D);
    expect(Date.parse(row.spawn_latest) - KILL).toBe(11 * D);
  });

  it('a PoP boss is mirrored as base +/-20%', async () => {
    const row = await mirrored('terris_thule');
    const h = byId('terris_thule').timerHours;
    expect(Date.parse(row.spawn_earliest) - KILL).toBe(h * H * 0.8);
    expect(Date.parse(row.spawn_latest) - KILL).toBe(h * H * 1.2);
  });
});
