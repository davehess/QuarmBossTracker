// Your pet on the Mimic Map (the guild lead, 2026-11-06: "Pet needs to show up on the mimic map and doesn't unless you
// target them"). Agent half: _mapPetFor, sliced out of packages/wolfpack-logsync/index.js and run as shipped with the real
// _mapPos / _mapServerXY / _mapDist2. Wiring half: the payload builder calls it, Mimic's pipe merge keeps pet_loc, and map.html
// draws P.pet (text assertions strip comments first, CLAUDE.md "comments satisfy text assertions").
//
// Mutation-checked (each makes a test below fail): drop the 60 s limit; drop the pet-id check on the memory; drop the zone
// check on the memory; read pet_loc after the target fallback; stop remembering the targeted spot.
//
// Run: npx vitest run test/map-pet-marker.test.js
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const DEFS = [
  sliceBlock(AGENT, 'function _mapServerXY(loc) {', '  return { x: py, y: px, z: Number.isFinite(pz) ? pz : 0 };\n}'),
  sliceBlock(AGENT, 'const _mapDist2 = ', '\n'),
  sliceBlock(AGENT, 'const _mapPos = ', '\n'),
  sliceBlock(AGENT, 'const MAP_PET_KEEP_MS = ', '    dist: self ? Math.round(_mapDist2(pos, self)) : null };\n}'),
].join('\n');
// eslint-disable-next-line no-new-func
const { _mapPetFor, _mapPetMem } = new Function(DEFS + '\nreturn { _mapPetFor, _mapPetMem };')();

const T0 = 1_000_000;
const SELF = { x: 0, y: 0, z: 0 };
// Pipe order is swapped against the server frame: pipe {x:100, y:30} is server x 30, y 100.
const base = (over) => Object.assign({ pet_id: 77, pet_name: 'Jabber', target_id: null }, over || {});
const fresh = () => { _mapPetMem.clear(); };

describe('pet marker position', () => {
  it('no pet means no marker', () => {
    fresh();
    expect(_mapPetFor('Aldenmar', { pet_id: null }, 'thedeep', SELF, T0)).toBeNull();
  });
  it('Zeal pet_loc gives a live marker, in the server frame, with heading and distance', () => {
    fresh();
    const p = _mapPetFor('Aldenmar', base({ pet_loc: { x: 100, y: 30, z: 5 }, pet_heading: 128 }), 'thedeep', SELF, T0);
    expect(p).toMatchObject({ name: 'Jabber', id: 77, x: 30, y: 100, z: 5, heading: 128, live: true, age_s: 0 });
    expect(p.dist).toBe(104);
  });
  it('targeting the pet places it (live) without pet_loc, and remembers the spot', () => {
    fresh();
    const p = _mapPetFor('Aldenmar', base({ target_id: 77, target_loc: { x: 10, y: 20, z: 1 } }), 'thedeep', SELF, T0);
    expect(p).toMatchObject({ x: 20, y: 10, live: true });
    expect(_mapPetMem.get('aldenmar')).toMatchObject({ id: 77, zone: 'thedeep', x: 20, y: 10 });
  });
  it('untargeted within 60 s: last known spot, not live, with its age', () => {
    fresh();
    _mapPetFor('Aldenmar', base({ target_id: 77, target_loc: { x: 10, y: 20, z: 1 } }), 'thedeep', SELF, T0);
    const p = _mapPetFor('Aldenmar', base({ target_id: 5 }), 'thedeep', SELF, T0 + 25000);
    expect(p).toMatchObject({ x: 20, y: 10, live: false, age_s: 25 });
    const edge = _mapPetFor('Aldenmar', base(), 'thedeep', SELF, T0 + 60000);
    expect(edge).toMatchObject({ live: false, age_s: 60 });
  });
  it('after 60 s the last known spot is gone for good', () => {
    fresh();
    _mapPetFor('Aldenmar', base({ target_id: 77, target_loc: { x: 10, y: 20, z: 1 } }), 'thedeep', SELF, T0);
    expect(_mapPetFor('Aldenmar', base(), 'thedeep', SELF, T0 + 60001)).toBeNull();
    expect(_mapPetFor('Aldenmar', base(), 'thedeep', SELF, T0 + 1000)).toBeNull();
  });
  it('a zone change drops it', () => {
    fresh();
    _mapPetFor('Aldenmar', base({ target_id: 77, target_loc: { x: 10, y: 20, z: 1 } }), 'thedeep', SELF, T0);
    expect(_mapPetFor('Aldenmar', base(), 'nektulos', SELF, T0 + 5000)).toBeNull();
    expect(_mapPetFor('Aldenmar', base(), 'thedeep', SELF, T0 + 6000)).toBeNull();
  });
  it('a different pet id drops it', () => {
    fresh();
    _mapPetFor('Aldenmar', base({ target_id: 77, target_loc: { x: 10, y: 20, z: 1 } }), 'thedeep', SELF, T0);
    expect(_mapPetFor('Aldenmar', base({ pet_id: 78 }), 'thedeep', SELF, T0 + 5000)).toBeNull();
  });
  it('pet_loc wins over the target spot, and each character has its own memory', () => {
    fresh();
    const p = _mapPetFor('Aldenmar', base({ pet_loc: { x: 1, y: 2, z: 0 }, target_id: 77, target_loc: { x: 50, y: 60, z: 0 } }), 'thedeep', SELF, T0);
    expect(p).toMatchObject({ x: 2, y: 1 });
    expect(_mapPetFor('Brackwyn', base(), 'thedeep', SELF, T0 + 1000)).toBeNull();
  });
});

describe('pet marker wiring', () => {
  const agent = stripJs(AGENT);
  it('the map payload carries out.pet from _mapPetFor', () => {
    expect(agent).toMatch(/out\.pet = _mapPetFor\(character, st, zone, self, now\)/);
    expect(agent).toMatch(/target: null, pet: null, timers: \[\]/);
  });
  it('Mimic\'s pipe merge keeps pet_loc and pet_heading', () => {
    const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(main).toMatch(/s\.pet_loc\s*=\s*_pipeLoc\(inner\.pet_loc\)/);
    expect(main).toMatch(/s\.pet_heading\s*=/);
  });
  it('map.html tracks and draws P.pet, dimmed with "last seen" when not live', () => {
    const html = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'map.html')));
    expect(html).toMatch(/if \(p\.pet\) put\('pet', p\.pet\)/);
    expect(html).toMatch(/P\.pet\.live \? 1 : 0\.45/);
    expect(html).toMatch(/' \(last seen ' \+ P\.pet\.age_s \+ 's\)'/);
  });
});
