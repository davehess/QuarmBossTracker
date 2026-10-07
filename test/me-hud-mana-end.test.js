// test/me-hud-mana-end.test.js — the HUD builder's Mana and Endurance are two parts (FB-12).
//
// FB-12, a member, 2026-09-27: "in the options for 'build your hud' the 'mana or endurance' bars
// should be separated to be either or, not both in one". The builder (⚙ on the HUD ring) had ONE
// part, `right` ("Mana or endurance"), that switched the right-hand arc and, for a class with mana,
// the thin endurance arc under health together. It is now `mana` and `end`, each its own tick-box
// and text-size slider. WHERE each draws is unchanged: the right arc is mana, or endurance for a
// class with none; a class with mana shows endurance as the thin arc under health. The two parts
// only decide whether each draws. A save from before the split keeps today's look.
//
// The REAL render functions and readParts are cut out of me.html and run against invented
// snapshots (the pattern of me-overlay.test.js). Names are invented. Text assertions strip comments
// first (test/_source-slice.js); every assertion here was mutation-checked.
//
// Run: npx vitest run test/me-hud-mana-end.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs } from './_source-slice.js';

const meHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'me.html'));
const script = meHtml.slice(meHtml.indexOf('<script>') + 8, meHtml.indexOf('</script>'));
const renderBlock = script.slice(script.indexOf('  // ── helpers'), script.indexOf('  var bodyEl'));
// eslint-disable-next-line no-new-func
const R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + renderBlock
  + '\nreturn { renderHud, hudParts, HUD_DEFAULTS, HUD_PARTS, HUD_SIZED, readParts };')();

const base = {
  ok: true, character: 'Aldenmar', level: 60, class: 'Cleric', no_mana: false,
  hp: { cur: 5311, max: 6417, pct: 82.8 }, mana: { cur: 1686, max: 3015, pct: 55.9 }, end: { pct: 41 },
  cooldowns: [], target: null,
  combat: { live: true, secs: 30, out: { dps: 126, by: {} }, in: { dps: 60, by: {} }, feed: [] },
};
const cleric = base;
const monk = Object.assign({}, base, { class: 'Monk', no_mana: true, mana: { cur: null, max: null, pct: null } });

// What is drawn, read off the SVG: the right-arc label (its text and font size) and the two arcs.
const rightLabel = (h) => {
  const m = h.match(/<path id="hrt"[^>]*\/><text font-size="([\d.]+)"><textPath href="#hrt"[^>]*>([\s\S]*?)<\/textPath>/);
  return m ? { size: +m[1], text: m[2].replace(/<[^>]+>/g, '') } : null;
};
const hasBlueArc = (h) => /<path d="[^"]*" stroke="var\(--blue\)"/.test(h);
const hasOrangeArc = (h) => /<path d="[^"]*" stroke="var\(--orange\)"/.test(h);

const reset = () => Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {}, clickyPick: [] });
beforeEach(reset);
afterEach(reset);

describe('the builder lists Mana and Endurance as two parts', () => {
  it('"You" has a Mana row and an Endurance row, and no combined one', () => {
    const you = R.HUD_PARTS.find(g => g[0] === 'You')[1];
    const keys = you.map(it => it[0]);
    expect(keys).toContain('mana');
    expect(keys).toContain('end');
    expect(keys).not.toContain('right');
    expect(you.find(it => it[0] === 'mana')[1]).toMatch(/^Mana/);
    expect(you.find(it => it[0] === 'end')[1]).toMatch(/^Endurance/);
  });

  it('both start on, and the old combined part is gone from the defaults', () => {
    expect(R.HUD_DEFAULTS.mana).toBe(1);
    expect(R.HUD_DEFAULTS.end).toBe(1);
    expect('right' in R.HUD_DEFAULTS).toBe(false);
  });

  it('each has its own text-size slider', () => {
    expect(R.HUD_SIZED).toContain('mana');
    expect(R.HUD_SIZED).toContain('end');
    expect(R.HUD_SIZED).not.toContain('right');
    // and the builder draws a slider for every part in that list (text assertion, comments stripped)
    expect(stripJs(meHtml)).toMatch(/var HUD_SIZED = \[[^\]]*'mana'[^\]]*'end'/);
  });
});

describe('a class with mana: mana is the right arc, endurance the thin arc under health', () => {
  it('draws both by default, as it always did', () => {
    const h = R.renderHud(cleric);
    expect(hasBlueArc(h)).toBe(true);
    expect(hasOrangeArc(h)).toBe(true);
    expect(rightLabel(h).text).toMatch(/^MANA 56% /);
  });

  it('Mana off takes the right arc and its label, and leaves endurance', () => {
    R.hudParts.mana = 0;
    const h = R.renderHud(cleric);
    expect(hasBlueArc(h)).toBe(false);
    expect(rightLabel(h)).toBeNull();
    expect(hasOrangeArc(h)).toBe(true);
  });

  it('Endurance off takes the thin arc, and leaves the right arc and its label', () => {
    R.hudParts.end = 0;
    const h = R.renderHud(cleric);
    expect(hasOrangeArc(h)).toBe(false);
    expect(hasBlueArc(h)).toBe(true);
    expect(rightLabel(h).text).toMatch(/^MANA 56% /);
  });

  it('both off draws neither', () => {
    R.hudParts.mana = 0; R.hudParts.end = 0;
    const h = R.renderHud(cleric);
    expect(hasBlueArc(h)).toBe(false);
    expect(hasOrangeArc(h)).toBe(false);
    expect(rightLabel(h)).toBeNull();
  });

  it('the thin endurance arc does not wait on mana being known', () => {
    const noReading = Object.assign({}, cleric, { mana: { cur: null, max: null, pct: null } });
    const h = R.renderHud(noReading);
    expect(hasBlueArc(h)).toBe(false);
    expect(hasOrangeArc(h)).toBe(true);
  });
});

describe('a class with no mana: endurance takes the right arc, and the Endurance part owns it', () => {
  it('draws endurance on the right by default, never mana', () => {
    const h = R.renderHud(monk);
    expect(hasBlueArc(h)).toBe(false);
    expect(hasOrangeArc(h)).toBe(true);
    expect(rightLabel(h).text).toMatch(/^END 41% /);
  });

  it('Endurance off takes the right arc and its label', () => {
    R.hudParts.end = 0;
    const h = R.renderHud(monk);
    expect(hasOrangeArc(h)).toBe(false);
    expect(rightLabel(h)).toBeNull();
  });

  it('Mana is not what switches it: mana off changes nothing here', () => {
    const on = R.renderHud(monk);
    R.hudParts.mana = 0;
    expect(R.renderHud(monk)).toBe(on);
  });

  it('Mana on cannot bring the arc back when Endurance is off', () => {
    R.hudParts.end = 0; R.hudParts.mana = 1;
    expect(rightLabel(R.renderHud(monk))).toBeNull();
  });
});

describe('each part has its own text size', () => {
  const size = (snap) => rightLabel(R.renderHud(snap)).size;

  it('the Mana slider sizes the right-arc label of a class with mana, not endurance', () => {
    const plain = size(cleric), plainMonk = size(monk);
    R.hudParts.sizes = { mana: 1.3 };
    expect(size(cleric)).toBeCloseTo(plain * 1.3, 5);
    expect(size(monk)).toBe(plainMonk);
  });

  it('the Endurance slider sizes the right-arc label of a class with no mana, not mana', () => {
    const plain = size(cleric), plainMonk = size(monk);
    R.hudParts.sizes = { end: 1.3 };
    expect(size(monk)).toBeCloseTo(plainMonk * 1.3, 5);
    expect(size(cleric)).toBe(plain);
  });

  it('the old combined size is no longer read by the HUD', () => {
    const plain = size(cleric);
    R.hudParts.sizes = { right: 1.3 };
    expect(size(cleric)).toBe(plain);
  });
});

describe('settings saved before the split keep today\'s look (readParts)', () => {
  const store = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('nothing saved: both on', () => {
    const p = R.readParts('Aldenmar');
    expect([p.mana, p.end]).toEqual([1, 1]);
  });

  it('the old part on: both new parts on', () => {
    store['wpHudParts:aldenmar'] = JSON.stringify({ right: 1, hp: 1 });
    const p = R.readParts('Aldenmar');
    expect([p.mana, p.end]).toEqual([1, 1]);
  });

  it('the old part off: both new parts off', () => {
    store['wpHudParts:aldenmar'] = JSON.stringify({ right: 0 });
    const p = R.readParts('Aldenmar');
    expect([p.mana, p.end]).toEqual([0, 0]);
  });

  it('the shared save (a character with none of its own) migrates the same way', () => {
    store.wpHudParts = JSON.stringify({ right: 0 });
    const p = R.readParts('Brackwyn');
    expect([p.mana, p.end]).toEqual([0, 0]);
  });

  it('the old text size carries to both, and the old key is dropped', () => {
    store['wpHudParts:aldenmar'] = JSON.stringify({ right: 1, sizes: { right: 1.4, hp: 1.2 } });
    const p = R.readParts('Aldenmar');
    expect(p.sizes.mana).toBe(1.4);
    expect(p.sizes.end).toBe(1.4);
    expect(p.sizes.hp).toBe(1.2);
    expect('right' in p.sizes).toBe(false);
    expect('right' in p).toBe(false);
  });

  it('a save that already has the new parts is left as the member set them', () => {
    store['wpHudParts:aldenmar'] = JSON.stringify({ right: 1, mana: 1, end: 0, sizes: { right: 1.4, mana: 0.9 } });
    const p = R.readParts('Aldenmar');
    expect([p.mana, p.end]).toEqual([1, 0]);
    expect(p.sizes.mana).toBe(0.9);
    expect(p.sizes.end).toBe(1.4);   // only the one the save lacked takes the old size
  });

  it('a migrated "off" save draws neither arc', () => {
    store['wpHudParts:aldenmar'] = JSON.stringify({ right: 0 });
    Object.assign(R.hudParts, R.readParts('Aldenmar'));
    for (const snap of [cleric, monk]) {
      const h = R.renderHud(snap);
      expect(hasBlueArc(h)).toBe(false);
      expect(hasOrangeArc(h)).toBe(false);
      expect(rightLabel(h)).toBeNull();
    }
  });

  it('a migrated "on" save draws exactly what the defaults draw', () => {
    const defaults = [cleric, monk].map(s => R.renderHud(s));
    store['wpHudParts:aldenmar'] = JSON.stringify({ right: 1 });
    Object.assign(R.hudParts, R.readParts('Aldenmar'));
    expect([cleric, monk].map(s => R.renderHud(s))).toEqual(defaults);
  });
});
