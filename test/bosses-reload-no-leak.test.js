// test/bosses-reload-no-leak.test.js — the boss list is re-read per call WITHOUT leaking a Module each time.
//
// The old hot-reload (`delete require.cache[...]; return require('./data/bosses.json')`) built a fresh Module
// on every call and pushed it onto the requiring module's `children` array, which Node never trims: every
// call kept a parsed copy of the 72 KB file for the life of the process (getBosses() runs up to 4x per
// encounter upload; the bot grew ~900 MB in a raid hour).
//
// Behaviour first (the helper), then a source check that the call sites really use it.
//
// Run: npx vitest run test/bosses-reload-no-leak.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const readJsonFresh = require('../utils/readJsonFresh');
const BOSSES = path.join(ROOT, 'data', 'bosses.json');

describe('readJsonFresh', () => {
  it('200 reads of bosses.json retain no Module (children does not grow)', () => {
    // vitest's own module wrapper is not a CJS Module, so measure on the helper's module and on this
    // file's require() parent chain: neither may gain a child per call.
    const helperMod = require.cache[require.resolve('../utils/readJsonFresh')];
    const before = helperMod.children.length;
    const cacheBefore = Object.keys(require.cache).length;
    for (let i = 0; i < 200; i++) readJsonFresh(BOSSES);
    expect(helperMod.children.length).toBe(before);
    expect(Object.keys(require.cache).length).toBe(cacheBefore);
  });

  it('the old pattern DOES grow children (the test can fail)', () => {
    const holder = require.cache[require.resolve('../utils/readJsonFresh')];
    const mod = new (holder.constructor)('leak-probe', null);
    mod.filename = path.join(ROOT, 'leak-probe.js');
    mod.paths = holder.paths;
    const before = mod.children.length;
    const localRequire = (p) => mod.require(p);
    for (let i = 0; i < 5; i++) {
      delete require.cache[BOSSES];
      localRequire(BOSSES);
    }
    expect(mod.children.length).toBeGreaterThan(before);
    delete require.cache[BOSSES];
  });

  it('returns a distinct, deep-equal object each call (callers may mutate theirs)', () => {
    const a = readJsonFresh(BOSSES);
    const b = readJsonFresh(BOSSES);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    a.push({ id: 'scribble' });
    a[0].name = 'scribble';
    expect(readJsonFresh(BOSSES)).toEqual(b);
  });

  it('picks up a rewrite of the file on the next read (hot reload still works)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bosses-reload-'));
    const f = path.join(dir, 'x.json');
    try {
      fs.writeFileSync(f, JSON.stringify([{ id: 'one' }]));
      expect(readJsonFresh(f)).toEqual([{ id: 'one' }]);
      fs.writeFileSync(f, JSON.stringify([{ id: 'one' }, { id: 'two' }]));
      expect(readJsonFresh(f)).toEqual([{ id: 'one' }, { id: 'two' }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('call sites no longer re-require bosses.json', () => {
  const files = ['index.js', 'utils/killops.js', 'utils/reconcileKills.js', 'utils/suggestNudge.js'];
  for (const rel of files) {
    it(`${rel} has no require.cache delete for bosses.json`, () => {
      const src = stripJs(readSource(path.join(ROOT, rel)));
      expect(src).not.toMatch(/delete\s+require\.cache\[require\.resolve\(['"][./]+\/data\/bosses\.json['"]\)\]/);
      expect(src).not.toMatch(/require\(['"][./]+\/data\/bosses\.json['"]\)/);
    });
  }

  it('getBosses() reads through readJsonFresh', () => {
    const src = stripJs(readSource(path.join(ROOT, 'index.js')));
    const at = src.indexOf('function getBosses()');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toMatch(/readJsonFresh/);
  });
});
