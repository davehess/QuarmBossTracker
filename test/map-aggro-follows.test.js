// A pulled mob's aggro ring follows the mob, not its spawn point (the guild lead, 2026-10-21, Map screenshot of red rings
// round the spawn points of "a horror hobgoblin": "When this mob was pulled, its initial aggro radius should not be
// displayed at its spawnpoint, it should follow the mob").
//
// Overlay half: movedMob / movedFade in apps/mimic/map.html, sliced and run as written. Agent half: _mapSeenPos (the
// `pos` on each seen row) from packages/wolfpack-logsync/index.js. Text assertions strip comments first.
//
// Mutation-checked: dropping the `age > MOVE_DROP_MS` clause makes "stale drops the moving circle" fail.
//
// Run: npx vitest run test/map-aggro-follows.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const AGENT = readSource(AGENT_INDEX);

const H = new Function(
  sliceBlock(MAP_HTML, "// A pulled mob's aggro ring follows the mob", ': Math.max(0.35, 1 - 0.65 * (ageMs - MOVE_FRESH_MS) / (MOVE_DROP_MS - MOVE_FRESH_MS));\n  }')
  + '\nreturn { movedMob, movedFade, MOVE_FRESH_MS, MOVE_DROP_MS, MOVE_AWAY };')();

const A = new Function('MAP_PIN_MAX',
  sliceBlock(AGENT, 'const MAP_POS_KEEP_MS = 60000;', '    if (best && now - best.at <= MAP_POS_KEEP_MS) s.pos = { x: best.x, y: best.y, z: best.z, at: best.at };\n  }\n}')
  + '\nreturn { _mapPosNote, _mapSeenPos, _mapPosMem, MAP_POS_KEEP_MS };')(500);

const HOME = { id: 7, x: 100, y: 200, z: 0 };       // the spawn point
const UP = { name: 'a horror hobgoblin', spawn_id: 4411 };
const NOW = 1_000_000;
const AWAY = { x: 100, y: 500, z: 0 };               // 300 units from home

describe('movedMob: where a pulled mob\'s aggro ring is drawn', () => {
  it('a hurt mob is drawn at its latest known position, not at its spawn point', () => {
    const sn = { spawn_id: 4411, hp_pct: 60, pos: { ...AWAY, at: NOW - 2000 } };
    const m = H.movedMob(HOME, UP, sn, { target: null }, {}, NOW, NOW);
    expect(m).toMatchObject({ x: 100, y: 500, target: false });
    expect(m.age).toBe(2000);
  });
  it('your live target that is away from home is the position (and is drawn by the target\'s own rings)', () => {
    const P = { target: { id: 4411, point_id: 7, type: 1, x: 130, y: 420, hp_pct: 100, tot: { id: 9, name: 'Tank' } } };
    expect(H.movedMob(HOME, UP, null, P, {}, NOW, NOW)).toMatchObject({ x: 130, y: 420, age: 0, target: true });
  });
  it('a mob chasing someone counts as pulled even at full health and next to home', () => {
    const P = { target: { id: 4411, point_id: 7, type: 1, x: 105, y: 205, hp_pct: 100, tot: { id: 9, name: 'Tank' } } };
    expect(H.movedMob(HOME, UP, null, P, {}, NOW, NOW)).not.toBeNull();
  });
  it('an idle, un-pulled spawn keeps its ring at the spawn point', () => {
    const near = { spawn_id: 4411, hp_pct: 100, pos: { x: 103, y: 204, z: 0, at: NOW - 500 } };
    expect(H.movedMob(HOME, UP, near, { target: null }, {}, NOW, NOW)).toBeNull();
    expect(H.movedMob(HOME, UP, { spawn_id: 4411, hp_pct: null }, { target: null }, {}, NOW, NOW)).toBeNull();
    const P = { target: { id: 4411, point_id: 7, type: 1, x: 101, y: 201, hp_pct: 100, tot: null } };
    expect(H.movedMob(HOME, UP, null, P, {}, NOW, NOW)).toBeNull();
    expect(H.movedMob(HOME, null, null, { target: null }, {}, NOW, NOW)).toBeNull();
  });
  it('a trail with the mob far from home is a position when nothing fresher exists', () => {
    const trails = { 't:4411': { pts: [{ x: 100, y: 300, t: NOW - 9000 }, { x: 100, y: 450, t: NOW - 3000 }] } };
    const m = H.movedMob(HOME, UP, { spawn_id: 4411, hp_pct: 100 }, { target: null }, trails, NOW, NOW);
    expect(m).toMatchObject({ x: 100, y: 450, age: 3000 });
  });
  it('the fresher of the agent position and the trail wins', () => {
    const sn = { spawn_id: 4411, hp_pct: 50, pos: { x: 100, y: 600, z: 0, at: NOW - 1000 } };
    const trails = { 't:4411': { pts: [{ x: 100, y: 450, t: NOW - 3000 }] } };
    expect(H.movedMob(HOME, UP, sn, { target: null }, trails, NOW, NOW).y).toBe(600);
  });
  it('a stale position drops the moving circle (and a dead mob\'s trail or health never draws one)', () => {
    const old = { spawn_id: 4411, hp_pct: 40, pos: { ...AWAY, at: NOW - H.MOVE_DROP_MS - 1 } };
    expect(H.movedMob(HOME, UP, old, { target: null }, {}, NOW, NOW)).toBeNull();
    const edge = { spawn_id: 4411, hp_pct: 40, pos: { ...AWAY, at: NOW - H.MOVE_DROP_MS } };
    expect(H.movedMob(HOME, UP, edge, { target: null }, {}, NOW, NOW)).not.toBeNull();
    const dead = { 't:4411': { dead: NOW - 1000, pts: [{ x: 100, y: 450, t: NOW - 1000 }] } };
    expect(H.movedMob(HOME, UP, { spawn_id: 4411, hp_pct: 100 }, { target: null }, dead, NOW, NOW)).toBeNull();
    const corpse = { target: { id: 4411, point_id: 7, type: 1, x: 100, y: 450, hp_pct: 0, tot: null } };
    expect(H.movedMob(HOME, UP, null, corpse, {}, NOW, NOW)).toBeNull();
  });
  it('fades after 10 s and bottoms out at a third', () => {
    expect(H.movedFade(0)).toBe(1);
    expect(H.movedFade(H.MOVE_FRESH_MS)).toBe(1);
    expect(H.movedFade(35000)).toBeLessThan(1);
    expect(H.movedFade(35000)).toBeGreaterThan(0.35);
    expect(H.movedFade(H.MOVE_DROP_MS)).toBeCloseTo(0.35);
  });
});

describe('map.html draws it: the spawn point loses the ring, the mob gets it', () => {
  const src = stripJs(MAP_HTML);
  it('the spawn point is skipped for a moved mob and the ring is drawn at the mob\'s own position, faded', () => {
    expect(src).toMatch(/if \(movedBy\[String\(ap\.id\)\]\) continue;/);
    expect(src).toMatch(/var mun = upNpc\(mb\.p, mb\.up\), mq = wpt\(mb\.mv\.x, mb\.mv\.y\);/);
    expect(src).toMatch(/\* movedFade\(mb\.mv\.age\)/);
  });
});

describe('agent: _mapSeenPos puts a position on a seen row', () => {
  const NOWA = 5_000_000;
  const fresh = () => { A._mapPosMem.zone = null; A._mapPosMem.m.clear(); };
  it('remembers where your target stood, per spawn id', () => {
    fresh();
    A._mapPosNote('lavastorm', 4411, { x: 1, y: 2, z: 3 }, NOWA - 5000);
    const seen = [{ spawn_id: 4411 }, { spawn_id: 99 }, { spawn_id: null }];
    A._mapSeenPos(seen, null, null, 'lavastorm', NOWA);
    expect(seen[0].pos).toEqual({ x: 1, y: 2, z: 3, at: NOWA - 5000 });
    expect(seen[1].pos).toBeUndefined();
    expect(seen[2].pos).toBeUndefined();
  });
  it('a position older than a minute, or from another zone, is not sent', () => {
    fresh();
    A._mapPosNote('lavastorm', 4411, { x: 1, y: 2, z: 3 }, NOWA - A.MAP_POS_KEEP_MS - 1);
    const old = [{ spawn_id: 4411 }];
    A._mapSeenPos(old, null, null, 'lavastorm', NOWA);
    expect(old[0].pos).toBeUndefined();
    A._mapPosNote('lavastorm', 5, { x: 1, y: 2, z: 3 }, NOWA);
    const other = [{ spawn_id: 5 }];
    A._mapSeenPos(other, null, null, 'nektulos', NOWA);
    expect(other[0].pos).toBeUndefined();
  });
  it('the raid\'s shared target and your live target beat an older memory', () => {
    fresh();
    A._mapPosNote('lavastorm', 4411, { x: 1, y: 1, z: 0 }, NOWA - 30000);
    const shared = { pulledAt: NOWA - 1000, rows: [{ id: 4411, x: 50, y: 60, z: 0, age: 4000 }] };
    const a = [{ spawn_id: 4411 }];
    A._mapSeenPos(a, null, shared, 'lavastorm', NOWA);
    expect(a[0].pos).toEqual({ x: 50, y: 60, z: 0, at: NOWA - 5000 });
    const b = [{ spawn_id: 4411 }];
    A._mapSeenPos(b, { id: 4411, type: 1, x: 70, y: 80, z: 0 }, shared, 'lavastorm', NOWA);
    expect(b[0].pos).toEqual({ x: 70, y: 80, z: 0, at: NOWA });
  });
  it('is wired into the payload and fed by every Zeal frame', () => {
    const code = stripJs(AGENT);
    expect(code).toMatch(/_mapSeenPos\(out\.seen, out\.target, _mapSync\.targets\[zone\], zone, now\);/);
    expect(code).toMatch(/_mapPosNote\(zone, next\.target_id, tl, now\);/);
  });
});
