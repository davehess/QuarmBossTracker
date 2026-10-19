// test/gallery-portable.test.js — the bot's copy of Mimic's portable-layout validator has not drifted.
//
// The format lives in apps/mimic/portableLayout.js on the beta branch (commit 11e427ed) and its validate() is the
// source of truth. The bot cannot require a beta-only file, so utils/portableLayout.js carries a copy of the read half.
// Two guards, like the proof-table copies in test/hail-board.test.js:
//   1. ALWAYS: test/fixtures/portable-layout.json holds documents Mimic's own toPortable produced. The bot's validate()
//      must accept each and hand back the identical document.
//   2. WHEN origin/beta is readable (a full clone): the copied source is compared verbatim with the original, and both
//      validators are run on a corpus of good and bad documents and must answer the same. A format change on beta
//      turns this red until utils/portableLayout.js is re-copied. Skipped, loudly, when beta cannot be read.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, readSource } from './_source-slice.js';

const require = createRequire(import.meta.url);
const bot = require('../utils/portableLayout.js');
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'portable-layout.json'), 'utf8'));
const botSrc = readSource(path.join(ROOT, 'utils', 'portableLayout.js'));

function readBeta() {
  try {
    return execFileSync('git', ['show', 'origin/beta:apps/mimic/portableLayout.js'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}
const betaSrc = readBeta();
const betaOnly = betaSrc ? it : it.skip;
function loadBeta() {
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', betaSrc)(mod, mod.exports, require);
  return mod.exports;
}

// Bad documents of every kind the validator has a rule for. Each is built from a good one.
const good = fixture.docs.screen1080;
const piece = good.groups[0].panels[0];
const withGroup0 = (g) => ({ ...good, groups: [{ ...good.groups[0], ...g }, ...good.groups.slice(1)] });
const withPiece0 = (p) => withGroup0({ panels: [{ ...piece, ...p }, ...good.groups[0].panels.slice(1)] });
const CORPUS = {
  good, eq: fixture.docs.eq1440,
  notObject: 'text', array: [], noFormat: {}, wrongFormat: { ...good, format: 'x' },
  newerVersion: { ...good, version: 2 }, zeroVersion: { ...good, version: 0 }, wrongKind: { ...good, kind: 'overlay' },
  noMeta: { ...good, meta: undefined }, metaClassesBad: { ...good, meta: { ...good.meta, classes: ['Pirate'] } },
  metaModesBad: { ...good, meta: { ...good.meta, modes: ['raid', 5] } }, longTitle: { ...good, meta: { ...good.meta, title: 'x'.repeat(200) } },
  badRef: { ...good, ref: { of: 'moon', aspect: 1 } }, badAspect: { ...good, ref: { of: 'eq', aspect: 99 } },
  noGroups: { ...good, groups: [] }, groupsNotList: { ...good, groups: {} },
  badAnchor: withGroup0({ anchor: 'zz' }), badOx: withGroup0({ ox: 99 }), noPanels: withGroup0({ panels: [] }),
  badKind: withPiece0({ kind: 'script' }), badPart: withPiece0({ part: 'no spaces allowed' }), badDx: withPiece0({ dx: 'a' }),
  tooWide: withPiece0({ w: 7 }), badWhen: withPiece0({ when: 'always' }), badCls: withPiece0({ cls: ['Nope'] }), badColor: withPiece0({ color: 'red' }),
  extras: { ...good, evil: 1, groups: good.groups.map(g => ({ ...g, evil: 1 })) },
  tooManyGroups: { ...good, groups: Array.from({ length: 61 }, () => good.groups[0]) },
};

describe('the bot copy of the portable-layout validator', () => {
  it('accepts every document Mimic\'s toPortable produced, and returns it unchanged', () => {
    for (const [name, doc] of Object.entries(fixture.docs)) {
      const r = bot.validate(doc);
      expect(r.ok, `${name}: ${r.error}`).toBe(true);
      expect(r.doc, name).toEqual(doc);
    }
  });

  it('refuses the corpus of bad documents', () => {
    for (const [name, doc] of Object.entries(CORPUS)) {
      if (['good', 'eq', 'extras', 'longTitle'].includes(name)) continue;   // these are accepted (the last one is cut to 60)
      expect(bot.validate(doc).ok, name).toBe(false);
    }
    expect(bot.validate(CORPUS.longTitle).doc.meta.title.length).toBe(60);
    expect(bot.validate(CORPUS.extras).doc).toEqual(good);   // unknown keys are dropped, not kept
  });

  it('parse() bounds the file read to the format\'s own byte cap', () => {
    expect(bot.parse(JSON.stringify(good)).ok).toBe(true);
    expect(bot.parse('x'.repeat(bot.MAX_BYTES + 1)).ok).toBe(false);
    expect(bot.parse('{not json').ok).toBe(false);
  });
});

describe('against Mimic\'s own portableLayout.js on origin/beta', () => {
  betaOnly('the copied constants and functions are verbatim', () => {
    const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); expect(a, from).toBeGreaterThanOrEqual(0); expect(b, to).toBeGreaterThan(a); return src.slice(a, b).trim(); };
    // constants + tiny helpers, then the readers/needsOf/validate/parse
    expect(botSrc).toContain(slice(betaSrc, "const FORMAT = ", '// ── The reference rect'));
    expect(botSrc).toContain(slice(betaSrc, '// ── Strict readers (validate)', '// ── Canvas layout → portable document'));
  });

  betaOnly('both validators give the same answer on every document in the corpus', () => {
    const beta = loadBeta();
    for (const [name, doc] of Object.entries(CORPUS)) {
      expect(JSON.parse(JSON.stringify(bot.validate(doc))), name).toEqual(JSON.parse(JSON.stringify(beta.validate(doc))));
    }
    for (const k of ['FORMAT', 'VERSION', 'MAX_BYTES', 'MAX_PANELS', 'BASE_H', 'MODES', 'CLASSES', 'ANCHORS']) {
      expect(bot[k], k).toEqual(beta[k]);
    }
  });

  betaOnly('a fresh toPortable export validates identically, and the fixture is still what Mimic produces', () => {
    const beta = loadBeta();
    const canvas = { panels: [
      { id: 'a1', kind: 'part', part: 'dps.meter', name: '', x: 0.02, y: 0.3, w: 320, h: 220, scale: 1.1, grp: 'gL', mode: 'bars', back: true },
      { id: 'c1', kind: 'overlay', key: 'zeal', name: '', x: 0.45, y: 0.86, w: 520, h: 90, scale: 1, style: 'hud' },
      { id: 'e1', kind: 'timers', name: 'Lulls', x: 0.8, y: 0.55, w: 340, h: 200, scale: 1.2, anchor: 'bottom', all: false, groups: ['lull'], names: [] },
    ] };
    const made = beta.toPortable(canvas, { width: 2560, height: 1440 }, null, { title: 'T', description: '', author: '', classes: [], modes: ['raid'] });
    expect(made.ok).toBe(true);
    expect(bot.validate(made.doc)).toEqual(beta.validate(made.doc));
    expect(bot.validate(made.doc).ok).toBe(true);
    // The committed fixture still passes Mimic's own validator, so it has not gone stale against the format.
    for (const doc of Object.values(fixture.docs)) expect(beta.validate(doc).ok).toBe(true);
  });
});
