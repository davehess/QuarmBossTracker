// Zeal 1.5.0 pipe type 7, `death` (the guild lead, 2026-11-06: "ingest the pipe data").
//
// Mimic half: _zealAbsorb accepts type 7, validates it (_pipeDeath) and keeps a ring on the snapshot. Agent half:
// _zealDeathsFromState hands each death, once, to the spawn map, Target Info's kill log, the charm tracker and the debuff
// timers. Both halves run the SHIPPED functions (Mimic sliced out of main.js; the agent required, the map core sliced).
// Mutation-checked: dropping the dedupe, the type guard, the charm removal or the type-7 branch each fails a test below.
//
// Run: npx vitest run test/zeal-death-events.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const AGENT = readSource(AGENT_INDEX);

// ── Mimic: _zealAbsorb, type 7 ────────────────────────────────────────────────────────────────────────────────
const ABSORB_SRC = sliceBlock(MAIN, 'function _pipeSpawnId(v) {', "\n}\n\n// Discover the player's OWN current/max HP");
function loadAbsorb() {
  // eslint-disable-next-line no-new-func
  return new Function(`const _zealLiveByChar = new Map();\n${ABSORB_SRC}\nreturn { _zealAbsorb, _zealLiveByChar, _pipeDeath };`)();
}
const frame = (character, type, data) => ({ character, type, data: typeof data === 'string' ? data : JSON.stringify(data) });

describe('Mimic absorbs pipe type 7 (death)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-06T20:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('keeps a valid death on the snapshot, marks it dirty, and stamps the zone', () => {
    const m = loadAbsorb();
    m._zealAbsorb(frame('Aldenmar', 3, { zone: 164, autoattack: false }), 10);
    m._zealLiveByChar.get('Aldenmar').dirty = false;
    m._zealAbsorb(frame('Aldenmar', 7, { spawn_id: 1234, name: ' a gnoll pup ', type: 1, level: 12, killer_id: 567, killer_name: 'Brackwyn' }), 10);
    const cur = m._zealLiveByChar.get('Aldenmar');
    expect(cur.dirty).toBe(true);
    expect(cur.snapshot.deaths).toEqual([{ spawn_id: 1234, name: 'a gnoll pup', type: 1, level: 12, killer_id: 567, killer_name: 'Brackwyn',
      at: Date.now(), zone: 164 }]);
  });

  it('a death with the optional fields omitted still lands (killer 0 = none, e.g. a DoT tick)', () => {
    const m = loadAbsorb();
    m._zealAbsorb(frame('Aldenmar', 7, { spawn_id: 9, killer_id: 0 }), 10);
    expect(m._zealLiveByChar.get('Aldenmar').snapshot.deaths[0]).toMatchObject({ spawn_id: 9, name: null, type: null, level: null, killer_id: null, killer_name: null });
  });

  it('drops malformed ones: no/zero/non-numeric spawn id, junk JSON, a non-object', () => {
    const m = loadAbsorb();
    for (const bad of [{ name: 'x' }, { spawn_id: 0 }, { spawn_id: '12' }, { spawn_id: NaN }, { spawn_id: -3 }, 'not json{', '"str"', 'null', '[]']) {
      m._zealAbsorb(frame('Aldenmar', 7, bad), 10);
    }
    const cur = m._zealLiveByChar.get('Aldenmar');
    expect(cur.snapshot.deaths).toBeUndefined();
    expect(cur.dirty).toBe(false);
  });

  it('sanitizes fields: strings trimmed and cut to 64, numbers must be finite and in range', () => {
    const m = loadAbsorb();
    const d = m._pipeDeath({ spawn_id: 5.9, name: 'n'.repeat(100), type: 99, level: 'x', killer_id: Infinity, killer_name: '   ' }, 1);
    expect(d.spawn_id).toBe(5);
    expect(d.name).toHaveLength(64);
    expect(d.type).toBeNull();
    expect(d.level).toBeNull();
    expect(d.killer_id).toBeNull();
    expect(d.killer_name).toBeNull();
  });

  it('keeps the last 50, and nothing older than 5 minutes', () => {
    const m = loadAbsorb();
    m._zealAbsorb(frame('Aldenmar', 7, { spawn_id: 1 }), 10);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    for (let i = 2; i < 70; i++) m._zealAbsorb(frame('Aldenmar', 7, { spawn_id: i }), 10);
    const deaths = m._zealLiveByChar.get('Aldenmar').snapshot.deaths;
    expect(deaths).toHaveLength(50);
    expect(deaths[0].spawn_id).toBe(20);
    expect(deaths[49].spawn_id).toBe(69);
  });

  it('an older Zeal (no type 7 ever sent) leaves the snapshot without a deaths field', () => {
    const m = loadAbsorb();
    m._zealAbsorb(frame('Aldenmar', 3, { zone: 164, autoattack: true }), 10);
    expect(m._zealLiveByChar.get('Aldenmar').snapshot).not.toHaveProperty('deaths');
  });

  it('the type-7 branch is in the shipped absorber (comments stripped)', () => {
    expect(stripJs(ABSORB_SRC)).toMatch(/type === 7\)[\s\S]{0,700}s\.deaths\s*=/);
  });
});

// ── Agent: the dispatcher and the tracker consumers ───────────────────────────────────────────────────────────
let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
const NOW = Date.UTC(2026, 10, 6, 20, 0, 0);
beforeEach(() => {
  if (!agent) return;
  agent._zealDeathSeen.clear();
  agent._tgtHistResetForTest();
  agent._charmTickTracker.clear();
});

const gnoll = (extra) => Object.assign({ spawn_id: 55, name: 'a gnoll pup', type: 1, level: 12, killer_id: 7, killer_name: 'Brackwyn', at: NOW, zone: 164 }, extra || {});
const seedTarget = (character, id, name, hp = 40) => agent._tgtHistNoteFromState(character, null,
  { zone: 164, target_name: name, target_id: id, target_type: 1, target_hp_pct: hp }, NOW - 5000);

describe('agent: kill log (Target Info Recent tab)', () => {
  it('a death for a mob you targeted marks it killed, with the killer', () => {
    seedTarget('Aldenmar', 55, 'a gnoll pup');
    const n = agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll()] }, NOW);
    expect(n).toBe(1);
    const e = agent._tgtHistForTest()[0];
    expect(e).toMatchObject({ id: 55, killedHow: 'zeal-death', killer: 'Brackwyn' });
    expect(e.killedMs).toBe(NOW);
  });

  it('adds the killer to an entry the log already marked killed', () => {
    seedTarget('Aldenmar', 55, 'a gnoll pup');
    agent._tgtHistForTest()[0].killedMs = NOW - 1000;
    agent._tgtHistForTest()[0].killedHow = 'slain';
    agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll()] }, NOW);
    expect(agent._tgtHistForTest()[0]).toMatchObject({ killedHow: 'slain', killedMs: NOW - 1000, killer: 'Brackwyn' });
  });

  it('a mob nobody targeted gets no row (the list is the mobs you looked at), unless one of our characters killed it', () => {
    agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll({ spawn_id: 90 })] }, NOW);
    expect(agent._tgtHistForTest()).toHaveLength(0);
    expect(agent._tgtHistNoteZealDeath(gnoll({ spawn_id: 91 }), 164, NOW, true)).toBe(true);
    expect(agent._tgtHistForTest()[0]).toMatchObject({ id: 91, name: 'a gnoll pup', killedHow: 'zeal-death', killer: 'Brackwyn' });
  });

  it('a player or a corpse (type 0 / 2 / 3) is never a kill-log row', () => {
    seedTarget('Aldenmar', 55, 'a gnoll pup');
    agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll({ type: 0 }), gnoll({ type: 3 })] }, NOW);
    expect(agent._tgtHistForTest()[0].killedMs).toBeNull();
  });
});

describe('agent: charm tracker', () => {
  const charm = (over) => Object.assign({ pet: 'a gnoll pup', owner: 'Aldenmar', pet_id: 55, last_tick_at: NOW - 3000, last_event: 'land', is_active: true, broke_at: null }, over);

  it('the death of a tracked charm pet removes it as DIED: no break is recorded, nothing lingers', () => {
    agent._charmTickTracker.set('a gnoll pup', charm());
    agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll()] }, NOW);
    expect(agent._charmTickTracker.has('a gnoll pup')).toBe(false);   // a break would leave last_event 'break' + broke_at lingering
  });

  it('another spawn dying, or one with the same name but another id, leaves the pet alone', () => {
    agent._charmTickTracker.set('a gnoll pup', charm());
    agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll({ spawn_id: 56 })] }, NOW);
    expect(agent._charmTickTracker.get('a gnoll pup')).toMatchObject({ is_active: true, last_event: 'land', pet_id: 55 });
  });

  it('a pet whose charm already broke (lingering) is cleared when the mob then dies', () => {
    agent._charmTickTracker.set('a gnoll pup', charm({ is_active: false, last_event: 'break', broke_at: NOW - 2000 }));
    agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll()] }, NOW);
    expect(agent._charmTickTracker.has('a gnoll pup')).toBe(false);
  });
});

describe('agent: each death is handled once', () => {
  it('the same death heard by two characters on one PC (and the ring re-sent every frame) counts once', () => {
    seedTarget('Aldenmar', 55, 'a gnoll pup');
    const d = gnoll();
    expect(agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [d] }, NOW)).toBe(1);
    expect(agent._zealDeathsFromState('Brackwyn', { zone: 164, deaths: [{ ...d, at: NOW + 400 }] }, NOW + 500)).toBe(0);
    expect(agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [d] }, NOW + 900)).toBe(0);
  });

  it('the same spawn id dying again later (an id is reused) is a new death', () => {
    expect(agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll()] }, NOW)).toBe(1);
    expect(agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll({ at: NOW + 30_000 })] }, NOW + 30_000)).toBe(1);
  });

  it('a different name or zone on the same id is not the same death', () => {
    expect(agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll(), gnoll({ name: 'a gnoll' }), gnoll({ zone: 165 })] }, NOW)).toBe(3);
  });

  it('a death older than 5 minutes is ignored', () => {
    expect(agent._zealDeathsFromState('Aldenmar', { zone: 164, deaths: [gnoll({ at: NOW - 6 * 60_000 })] }, NOW)).toBe(0);
  });
});

describe('agent: an older Zeal changes nothing', () => {
  it('a frame with no deaths (or an empty / malformed ring) touches no consumer', () => {
    seedTarget('Aldenmar', 55, 'a gnoll pup');
    agent._charmTickTracker.set('a gnoll pup', { pet: 'a gnoll pup', owner: 'Aldenmar', pet_id: 55, is_active: true, last_event: 'land' });
    for (const st of [{ zone: 164 }, { zone: 164, deaths: [] }, { zone: 164, deaths: 'x' }, { zone: 164, deaths: [null, {}, { spawn_id: 0 }] }, null]) {
      expect(agent._zealDeathsFromState('Aldenmar', st, NOW)).toBe(0);
    }
    expect(agent._tgtHistForTest()[0].killedMs).toBeNull();
    expect(agent._charmTickTracker.get('a gnoll pup').is_active).toBe(true);
  });

  it('the /api/zeal-state handler calls the dispatcher after the map hook', () => {
    expect(stripJs(AGENT)).toMatch(/_mapNoteState\(character, prevState, _zealState\[character\], Date\.now\(\)\);[^\n]*\n\s*try \{ _zealDeathsFromState\(character, _zealState\[character\], Date\.now\(\)\);/);
  });
});

// ── Agent: the spawn map (the real core, sliced as test/spawn-map.test.js does) ────────────────────────────────
const CORE = sliceBlock(AGENT, '// ── Spawn map core (Mimic 2.9', '// ── end Spawn map core ──');
const CON_DEFS = AGENT.slice(AGENT.indexOf('const CON_STANDINGS = ['), AGENT.indexOf('\n', AGENT.indexOf('const _CON_RX = ')));
const LULL_DEFS = sliceBlock(AGENT, '// ── Pacify / lull line (SPA 30', 'return PACIFY_AE.has(String(name).toLowerCase().replace(/`/g, "\'").trim());\n}');
const MAIN_TARGET_DEF = sliceBlock(AGENT, 'function _resolveMainTarget(activeCharacter) {', 'raider_count: best.raider_count || 0 } : null;\n}');
const MEZ_DEF = sliceBlock(AGENT, 'function _isMezSpell(name) {', "includes('mez'));\n}");
const NPC = (name) => ({ name, level: 50, chance: 100, named: false, raid_target: false, badges: [], aggro: 60, fac: 1, assist: null, pf: 0 });
const ZONE_BODY = {
  zone: 'thedeep', long_name: 'The Deep', generated_at: '2026-10-12T00:00:00Z',
  points: [
    { id: 1, x: 100, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_decaying_skeleton')] },
    { id: 2, x: 4000, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_decaying_skeleton')] },
  ],
  map: { bands: [0, 20], segs: [[0, 0, 100, 0, 0]], bounds: { minX: -100, maxX: 5000, minY: -100, maxY: 1000 } },
};
const T0 = Date.UTC(2026, 9, 12, 20, 0, 0);
let dir, core;
function loadCore() {
  const prelude = `
    const STATS_FILE = path.join(__tmp, 'logsync.stats.json');
    let _uploadOpts = __opts;
    function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
    function _controlStandDown() { return { down: false }; }
    const AGENT_VERSION = 'test';
    const _zealState = {};
    let _lastRaidPipe = null;
    function _zoneName(id) { return id === 164 ? 'The Deep' : null; }
    function _eqSetupDirs() { return []; }
    const whoData = new Map();
    function _classOf(c) { const w = whoData.get(String(c || '').toLowerCase()); return w && w.class ? w.class : null; }
    const _buffLandingsByTarget = new Map();
    const _spellByNameLower = new Map();
    ${LULL_DEFS}
    ${MEZ_DEF}
    ${CON_DEFS}
    const _mobInfoByName = new Map();
    const MOB_INFO_TTL_MS = 6 * 60 * 60 * 1000;
    function _mobInfoCacheKey(name, zoneId) { return String(name).toLowerCase() + '|' + (zoneId != null ? zoneId : '*'); }
    function fetchMobInfo() {}
    const _extTargetCache = new Map();
    function fetchExtendedTarget() {}
    ${MAIN_TARGET_DEF}
  `;
  const noNet = { request() { throw new Error('no network in this test'); } };
  // eslint-disable-next-line no-new-func
  const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__tmp', '__opts',
    prelude + '\n' + CORE + '\nreturn { _mapEnsureZone, _mapNoteState, _mapNoteZealDeath, _mapZoneDoc, _mapSaveNow, _mapSyncStop, _mapPaths, _zealState };');
  const c = f(fs, path, noNet, noNet, zlib, dir, dir, { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' });
  c._mapPaths.cache = path.join(dir, 'zone-spawns-cache');
  c._mapPaths.timers = path.join(dir, 'map_timers.json');
  c._mapPaths.brewall = null;
  return c;
}
describe('agent: spawn map', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zealdeath-'));
    fs.mkdirSync(path.join(dir, 'zone-spawns-cache'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'zone-spawns-cache', 'thedeep.json'), JSON.stringify({ etag: '"v1"', fetched_at: T0, body: ZONE_BODY }));
    core = loadCore();
    core._mapEnsureZone('thedeep', 164, T0);
    core._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
  });
  afterEach(() => { try { core._mapSaveNow(); core._mapSyncStop(); } catch { /* nothing to flush */ } fs.rmSync(dir, { recursive: true, force: true }); });

  // The target window sees the skeleton alive at the first point (pipe x/y are swapped against the server frame).
  const seeAlive = () => core._mapNoteState('Aldenmar', null,
    { zone: 164, target_name: 'a decaying skeleton', target_id: 77, target_type: 1, target_hp_pct: 80, target_loc: { x: 200, y: 100, z: 0 } }, T0 + 1000);

  it('a death for a mapped spawn proves it dead: the respawn timer starts on its own point', () => {
    seeAlive();
    expect(core._mapZoneDoc('thedeep').timers['1']).toBeUndefined();
    expect(core._mapNoteZealDeath('thedeep', 'Aldenmar', { spawn_id: 77, name: 'a decaying skeleton', type: 1 }, T0 + 9000)).toBe(true);
    const t = core._mapZoneDoc('thedeep').timers['1'];
    expect(t).toMatchObject({ point_id: 1, died_at: T0 + 9000, source: 'seen' });
  });

  it('works with the name omitted (Zeal did not know the spawn): the map reads it back from the sighting', () => {
    seeAlive();
    expect(core._mapNoteZealDeath('thedeep', 'Aldenmar', { spawn_id: 77 }, T0 + 9000)).toBe(true);
    expect(core._mapZoneDoc('thedeep').timers['1']).toBeDefined();
  });

  it('a death with no position and no history adds nothing (no "?" marker for every trash mob)', () => {
    expect(core._mapNoteZealDeath('thedeep', 'Aldenmar', { spawn_id: 4242, name: 'a decaying skeleton', type: 1 }, T0 + 9000)).toBe(false);
    const zd = core._mapZoneDoc('thedeep');
    expect(Object.keys(zd.timers)).toHaveLength(0);
    expect(zd.unassigned).toHaveLength(0);
  });

  it('a player or a corpse dying (type 0 / 2 / 3) is not a spawn', () => {
    seeAlive();
    for (const type of [0, 2, 3]) expect(core._mapNoteZealDeath('thedeep', 'Aldenmar', { spawn_id: 77, name: 'a decaying skeleton', type }, T0 + 9000)).toBe(false);
    expect(Object.keys(core._mapZoneDoc('thedeep').timers)).toHaveLength(0);
  });

  it('the same death twice leaves one timer, not two', () => {
    seeAlive();
    core._mapNoteZealDeath('thedeep', 'Aldenmar', { spawn_id: 77, name: 'a decaying skeleton', type: 1 }, T0 + 9000);
    core._mapNoteZealDeath('thedeep', 'Aldenmar', { spawn_id: 77, name: 'a decaying skeleton', type: 1 }, T0 + 9500);
    expect(Object.keys(core._mapZoneDoc('thedeep').timers)).toEqual(['1']);
    expect(core._mapZoneDoc('thedeep').timers['1'].died_at).toBe(T0 + 9000);
  });
});
