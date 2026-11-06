// test/death-story.test.js — "How I died": the rolling incoming-hit buffer, the death_story record, and its routes.
// Runs the REAL agent functions against a temp store. Names are invented. Run: npx vitest run test/death-story.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, AGENT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

const T0 = Date.UTC(2026, 10, 6, 1, 0, 0);
const hit = (t, attacker, amount, extra = {}) => ({ type: 'damage', ts: new Date(t).toISOString(), attacker, defender: 'Aldenmar', ability: 'hits', amount, ...extra });
const slain = (t, killer = 'a gnoll') => ({ type: 'death', ts: new Date(t).toISOString(), defender: null, attacker: killer });

let dir, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-death-'));
  store = agent._localStoreOpen(dir);
  agent._localTrackSetStoreForTest(store);
  agent._deathHits.clear(); agent._deathLast.clear();
});
afterEach(() => { agent._localTrackSetStoreForTest(null); fs.rmSync(dir, { recursive: true, force: true }); });

describe('incoming-hit buffer', () => {
  it('keeps only the last 60 s', () => {
    agent._deathNoteEvent('Aldenmar', hit(T0, 'a gnoll', 10));
    agent._deathNoteEvent('Aldenmar', hit(T0 + 30_000, 'a gnoll', 11));
    agent._deathNoteEvent('Aldenmar', hit(T0 + 61_000, 'a gnoll', 12));
    expect(agent._deathHits.get('aldenmar').map(h => h.amount)).toEqual([11, 12]);
  });
  it('is bounded at 400 entries', () => {
    for (let i = 0; i < 450; i++) agent._deathNoteEvent('Aldenmar', hit(T0 + i, 'a gnoll', 1 + i));
    const arr = agent._deathHits.get('aldenmar');
    expect(arr.length).toBe(400);
    expect(arr[arr.length - 1].amount).toBe(450);
  });
  it('ignores hits taken by someone else', () => {
    agent._deathNoteEvent('Aldenmar', hit(T0, 'a gnoll', 10, { defender: 'Brackwyn' }));
    expect(agent._deathHits.get('aldenmar')).toBeUndefined();
  });
});

describe('death story', () => {
  const seed = () => {
    agent._deathNoteEvent('Aldenmar', hit(T0 - 40_000, 'a far orc', 500));          // outside the 30 s window
    agent._deathNoteEvent('Aldenmar', hit(T0 - 20_000, 'a gnoll', 100));
    agent._deathNoteEvent('Aldenmar', hit(T0 - 10_000, 'a gnoll', 300));
    agent._deathNoteEvent('Aldenmar', hit(T0 - 5_000, 'an orc', 150, { ability: 'non-melee', spellName: undefined }));
    agent._deathNoteEvent('Aldenmar', { type: 'damage', ts: new Date(T0 - 2_000).toISOString(), attacker: null, defender: null, ability: 'non-melee', amount: 40 });
    for (let i = 10; i >= 0; i--) {
      agent._deathNoteFrame({ t: T0 - i * 3000, rows: [{ name: 'Aldenmar', x: 100 - i, y: 50, z: 1, h: 64, hp: 10 * (10 - i) + 5 }], mobs: i % 2 ? [{ name: 'a gnoll', x: 90, y: 50, z: 1 }] : [] }, 'Aldenmar');
    }
  };
  it('writes one story with the last 30 s of hits, the attacker summary and the frames', () => {
    seed();
    const s = agent._deathNoteEvent('Aldenmar', slain(T0));
    expect(s.hits.map(h => h.amount)).toEqual([100, 300, 150, 40]);
    expect(s.killer).toBe('a gnoll');
    expect(s.total).toBe(590);
    expect(s.attackers[0]).toMatchObject({ name: 'a gnoll', total: 400, hits: 2, max: 300 });
    expect(s.frames.length).toBe(11);
    expect(s.frames.some(f => f.target && f.target.name === 'a gnoll')).toBe(true);
    // "You died." printed too: still one record
    agent._deathNoteEvent('Aldenmar', { type: 'death', ts: new Date(T0 + 500).toISOString(), defender: null, attacker: null });
    expect(store.scan('death_story')).toHaveLength(1);
    expect(store.scan('death_story')[0].rec.at).toBe(T0);
  });
  it('two characters on this PC dying in the same second keep both stories (one AE on a multibox)', () => {
    agent._deathNoteEvent('Aldenmar', slain(T0));
    agent._deathNoteEvent('Brackwyn', slain(T0));
    const ids = store.scan('death_story').map(e => e.id).sort();
    expect(ids).toEqual([String(T0), String(T0 + 1)]);
    expect(store.scan('death_story').map(e => e.rec.character).sort()).toEqual(['Aldenmar', 'Brackwyn']);
  });
  it('a character set to exclude_from_stats records nothing', () => {
    seed();
    agent._deathPrefsForTest({ aldenmar: { exclude_from_stats: true } });
    try {
      expect(agent._deathNoteEvent('Aldenmar', slain(T0))).toBeNull();
      agent._deathNoteEvent('Aldenmar', hit(T0 + 1000, 'a gnoll', 5));
      expect(store.scan('death_story')).toHaveLength(0);
    } finally { agent._deathPrefsForTest({}); }
  });
});

describe('routes', () => {
  const res = () => { const r = { status: 0, body: '' }; return Object.assign(r, { writeHead: (s) => { r.status = s; }, end: (b) => { r.body = b; } }); };
  const call = (url) => { const r = res(); const handled = agent._localDeathsRoute({ method: 'GET', url }, r); return { handled, status: r.status, json: r.body ? JSON.parse(r.body) : null }; };
  it('lists newest first and returns one story', () => {
    for (const t of [T0, T0 + 600_000]) {
      agent._deathHits.clear();
      agent._deathNoteEvent('Aldenmar', hit(t - 1000, 'a gnoll', 77), {});
      agent._deathNoteEvent('Aldenmar', slain(t));
    }
    const l = call('/api/local/deaths?limit=10');
    expect(l.status).toBe(200);
    expect(l.json.deaths.map(d => d.at)).toEqual([T0 + 600_000, T0]);
    expect(l.json.deaths[0]).toMatchObject({ character: 'Aldenmar', killer: 'a gnoll', total: 77 });
    expect(l.json.deaths[0].top[0]).toEqual({ name: 'a gnoll', total: 77 });
    const one = call('/api/local/deaths/' + T0);
    expect(one.json.hits[0].amount).toBe(77);
    expect(call('/api/local/deaths/999').status).toBe(404);
    expect(call('/api/local/other').handled).toBe(false);
  });
});

describe('source', () => {
  const code = stripJs(readSource(AGENT_INDEX));
  it('is wired after the local guard and never touches the network or queue', () => {
    expect(code.indexOf('_localDeathsRoute(req, res)')).toBeGreaterThan(code.indexOf('if (_localGuardBlock(req, res)) return;'));
    const a = code.indexOf('const DEATH_BUFFER_MS'), b = code.indexOf('// GET /api/local/deaths');
    const block = code.slice(a, code.indexOf('function _localDeathsRoute') + 2500);
    expect(a).toBeGreaterThan(-1); expect(b).toBe(-1);   // the route comment is stripped
    for (const bad of [/enqueueUpload/, /https?\.request/, /\bfetch\s*\(/, /\.send\(/]) expect(block).not.toMatch(bad);
    expect(code).toMatch(/_deathExcluded\(character\)/);
  });
});
