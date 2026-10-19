// test/setup-share-parity.test.js — the bot's bundle gate is the same file Mimic ships.
//
// utils/portableSetup.js and apps/mimic/portableSetup.js (on the beta branch) are meant to be BYTE-IDENTICAL: both sides
// rebuild a whole-setup bundle from the same whitelist and refuse the same private things, and a sharer who is told "that
// is fine" by Mimic must not be told "no" by the bot. Both require './portableLayout', which each directory resolves to
// its own copy of the same layout validator (test/gallery-portable.test.js keeps those two honest).
//
// Same pattern as test/gallery-portable.test.js: when origin/beta is readable (a full clone) and already carries the file,
// the two are compared verbatim and run on a corpus; otherwise the comparison is skipped, loudly, and the always-on tests
// in test/setup-share.test.js carry the load.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const botSrc = fs.readFileSync(path.join(ROOT, 'utils', 'portableSetup.js'), 'utf8');

function readBeta() {
  try {
    return execFileSync('git', ['show', 'origin/beta:apps/mimic/portableSetup.js'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}
const betaSrc = readBeta();
const bothThere = betaSrc ? it : it.skip;

function readBetaFile(f) {
  try {
    return execFileSync('git', ['show', 'origin/beta:apps/mimic/' + f], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}
const betaBundle = readBetaFile('setupBundle.js');

describe('always: a setup Mimic\'s build() produced passes the bot\'s gate unchanged', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'portable-setup.json'), 'utf8'));
  const bot = require('../utils/portableSetup.js');

  it('accepts it and hands back the identical document', () => {
    for (const [name, doc] of Object.entries(fixture.docs)) {
      const r = bot.validate(doc);
      expect(r.ok, `${name}: ${r.error}`).toBe(true);
      expect(r.setup, name).toEqual(doc);
    }
  });

  it('the fixture is a real whole setup: layouts, options, HUD, triggers and rules, characters as numbers only', () => {
    const d = fixture.docs.full;
    expect(d.layouts).toHaveLength(2);
    expect(Object.keys(d.options).length).toBeGreaterThan(1);
    expect(d.hud.length).toBeGreaterThan(0);
    expect(d.triggers.length).toBeGreaterThan(0);
    expect(Object.keys(d.rules).length).toBeGreaterThan(0);
    expect(d.slots.every(s => /^c\d+$/.test(s.slot) && /^Character \d+$/.test(s.label))).toBe(true);
    expect(JSON.stringify(d).toLowerCase()).not.toMatch(/"characters"/);
  });
});

describe('the code alphabet is the same on both sides', () => {
  const there = betaBundle ? it : it.skip;
  there('Mimic\'s CODE_ALPHABET is the bot\'s ALPHABET', () => {
    const m = /const CODE_ALPHABET = '([^']+)'/.exec(betaBundle);
    expect(m, 'CODE_ALPHABET not found in apps/mimic/setupBundle.js').toBeTruthy();
    expect(m[1]).toBe(require('../utils/setupShare.js').ALPHABET);
  });
});

describe('the bot copy of the whole-setup gate', () => {
  bothThere('is byte-identical to the one Mimic ships (apps/mimic/portableSetup.js on beta)', () => {
    expect(betaSrc).toBe(botSrc);
  });

  bothThere('answers a corpus the same way', () => {
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', betaSrc)(mod, mod.exports, (id) => require(id.replace('./portableLayout', path.join(ROOT, 'utils', 'portableLayout.js'))));
    const beta = mod.exports;
    const bot = require('../utils/portableSetup.js');
    const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'portable-layout.json'), 'utf8'));
    const good = { format: 'mimic-setup', version: 1, meta: { title: 'T' }, slots: [{ slot: 'c1', label: 'Character 1' }],
      layouts: [{ name: 'Raid', active: true, doc: fixture.docs.screen1080 }], options: { overlay: { opacity: 0.8 } },
      hud: [{ slot: 'c1', parts: { ring: ['hp'] } }], triggers: [{ for: ['c1'], trigger: { name: 'x', pattern: 'y' } }],
      rules: { 'guild:1': { all: 'off', c1: 'overlay' } } };
    const corpus = [good, { ...good, version: 2 }, { ...good, format: 'x' }, { ...good, rules: { 'timer:x': { all: 'off' } } },
      { ...good, triggers: [{ for: [], trigger: { name: 'x', sound: 'C:\\a.wav' } }] }, { ...good, options: { overlay: { apiKey: 'z' } } },
      { ...good, hud: [{ slot: 'c4', parts: {} }] }, null, 'text', []];
    for (const doc of corpus) expect(beta.validate(doc), JSON.stringify(doc).slice(0, 60)).toEqual(bot.validate(doc));
  });
});
