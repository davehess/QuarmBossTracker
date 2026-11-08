// test/target-info-speed-links-killlog.test.js — the guild lead, 2026-11-06, about Target Info:
//   1. "add run speed for mobs to target info. if run speed is zero list it as ROOTED"
//   2. "make it so spell names are a link to the PQDI entry for them in target info"
//   3. "there isn't parity with the kill log on the target info and canvas mode"
//
// 1. classifyMovement / observedSpeed / rootActiveOn run as the agent's real functions: a catalog speed of 0 is
//    "does not move" (never ROOTED), a mob standing still is NOT rooted, ROOTED needs a landed root spell, and a
//    root plus visible movement is a broken root.
// 2. the PQDI link builder emits nothing without a real id, and the overlay + canvas use it for every spell name.
// 3. the overlay's Recent tab and the canvas's kill-log piece both build their rows from TI.killLogRows.
//
// Names are invented. Text assertions strip comments first.
//
// Run: npx vitest run test/target-info-speed-links-killlog.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => path.join(ROOT, 'apps', 'mimic', f);
const TI = require(mimic('targetInfoShared.js'));
const agent = require(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const mobinfo = stripJs(fs.readFileSync(mimic('mobinfo.html'), 'utf8'));
const partsSrc = stripJs(fs.readFileSync(mimic('parts.js'), 'utf8'));

describe('ROOTED vs does not move vs moving (agent classifyMovement)', () => {
  const C = agent.classifyMovement;
  it('a catalog run speed of 0 is "does not move", never ROOTED, even with a root landed', () => {
    for (const rootActive of [false, true]) {
      const r = C({ runspeed: 0, rootActive, observed: null });
      expect(r.state).toBe('stationary');
      expect(r.label).toBe('does not move');
      expect(r.rooted).toBe(false);
    }
  });
  it('standing still is NOT rooted', () => {
    const r = C({ runspeed: 1.25, rootActive: false, observed: 0 });
    expect(r.state).toBe('still');
    expect(r.rooted).toBe(false);
    expect(r.label).toBe('standing still');
  });
  it('a moving mob reads moving', () => {
    expect(C({ runspeed: 1.25, rootActive: false, observed: 12.4 }).state).toBe('moving');
  });
  it('no live reading and no root says nothing about movement', () => {
    const r = C({ runspeed: 1.25, rootActive: false, observed: null });
    expect(r.state).toBe(null);
    expect(r.label).toBe(null);
  });
  it('a landed root is ROOTED, whether or not movement is readable', () => {
    expect(C({ runspeed: 1.25, rootActive: true, observed: 0 })).toMatchObject({ state: 'rooted', rooted: true, label: 'ROOTED' });
    expect(C({ runspeed: 1.25, rootActive: true, observed: null })).toMatchObject({ state: 'rooted', rooted: true });
  });
  it('a landed root on a mob seen moving is a broken root, not ROOTED', () => {
    const r = C({ runspeed: 1.25, rootActive: true, observed: 9 });
    expect(r.state).toBe('root-broken');
    expect(r.rooted).toBe(false);
  });
});

describe('observed speed from target_loc samples', () => {
  const pt = (t, x, y) => ({ t, x, y, z: 0 });
  it('is units per second over the window', () => {
    expect(agent.observedSpeed([pt(0, 0, 0), pt(1000, 6, 8), pt(2000, 12, 16)], 2000)).toBeCloseTo(10, 5);
  });
  it('is 0 for a mob that has not moved, and null until the samples span enough time', () => {
    expect(agent.observedSpeed([pt(0, 5, 5), pt(2000, 5, 5)], 2000)).toBe(0);
    expect(agent.observedSpeed([pt(0, 5, 5), pt(400, 9, 9)], 400)).toBe(null);
    expect(agent.observedSpeed([pt(0, 5, 5)], 0)).toBe(null);
  });
  it('only reads one target: a new target id starts the samples over', () => {
    agent._tgtMoveResetForTest();
    const st = (id, x) => ({ target_id: id, target_type: 1, target_loc: { x, y: 0, z: 0 } });
    agent._tgtMoveNote(st(7, 0), 1000);
    agent._tgtMoveNote(st(7, 10), 2000);
    expect(agent._tgtMoveNote(st(7, 20), 3000)).toBeGreaterThan(5);
    expect(agent._tgtMoveNote(st(8, 500), 3100)).toBe(null);   // a different spawn: no speed from the jump
    expect(agent._tgtMoveNote({ target_id: 8, target_type: 1 }, 3200)).toBe(null);   // out of range: no loc
  });
});

describe('a root spell on the target (agent rootActiveOn)', () => {
  it('needs an unfaded, harmful landing whose catalog entry carries cc root', () => {
    const root = agent.rootActiveOn;
    // Unknown names are not in the catalog in a unit test, so nothing is rooted.
    expect(root([{ name: 'Not A Real Spell', good: 0 }])).toBe(false);
    expect(root([])).toBe(false);
    expect(root(null)).toBe(false);
  });
});

describe('the shared run-speed wording (TI.moveView)', () => {
  it('shows the catalog speed always, and ROOTED red only when the agent says rooted', () => {
    const mob = { runspeed: 1.25 };
    expect(TI.moveView({ target_move: null }, mob)).toMatchObject({ run: 'Run speed: 1.25', label: '', rooted: false });
    const r = TI.moveView({ target_move: { state: 'rooted', rooted: true, label: 'ROOTED', basis: 'root landed' } }, mob);
    expect(r).toMatchObject({ run: 'Run speed: 1.25', label: 'ROOTED', rooted: true, tone: 'red' });
  });
  it('a stationary NPC reads "does not move" and is never red', () => {
    const v = TI.moveView({ target_move: { state: 'stationary', rooted: false, label: 'does not move', runspeed: 0 } }, { runspeed: 0 });
    expect(v).toMatchObject({ run: 'Run speed: 0', label: 'does not move', rooted: false });
    expect(v.tone).not.toBe('red');
  });
  it('a rooted flag with a state that is not rooted is not drawn rooted', () => {
    expect(TI.moveView({ target_move: { state: 'root-broken', rooted: true, label: 'x' } }, { runspeed: 1 }).rooted).toBe(false);
  });
  it('says nothing when there is nothing to say', () => {
    expect(TI.moveView({}, null)).toBe(null);
  });
});

describe('PQDI spell links', () => {
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  it('builds www.pqdi.cc/spell/<id> for a real id only', () => {
    expect(TI.pqdiSpellUrl(1546)).toBe('https://www.pqdi.cc/spell/1546');
    expect(TI.pqdiSpellUrl('1546')).toBe('https://www.pqdi.cc/spell/1546');
    for (const bad of [0, -3, null, undefined, '', 'abc', NaN, 1.5]) expect(TI.pqdiSpellUrl(bad)).toBe('');
  });
  it('emits an anchor with the url when the id is known, and plain escaped text when it is not', () => {
    expect(TI.spellLinkHtml('Tashanian', 1234, esc)).toContain('data-pqdi="https://www.pqdi.cc/spell/1234"');
    expect(TI.spellLinkHtml('Tashanian', 1234, esc)).toContain('>Tashanian</a>');
    expect(TI.spellLinkHtml('A <b> spell', null, esc)).toBe('A &lt;b&gt; spell');
    expect(TI.spellLinkHtml('A spell', 0, esc)).not.toContain('<a');
  });
  it('every spell name in Target Info goes through the builder: buffs, casting, last cast, procs, spell list', () => {
    expect(mobinfo.match(/WpTargetInfo\.spellLinkHtml\(/g).length).toBeGreaterThanOrEqual(5);
    expect(mobinfo).toMatch(/closest\('\.pqdi, \.splink'\)/);
    expect(mobinfo).toMatch(/window\.mimic\.openExternal\(url\)/);
  });
  it('the agent attaches catalog spell ids to buffs, casts and the last cast by name', () => {
    expect(agent.withSpellIds([{ name: 'Not A Real Spell' }])).toEqual([{ name: 'Not A Real Spell' }]);   // unknown: no id, no link
    expect(agent.withSpellIds(null)).toBe(null);
  });
  it('the canvas pieces carry the url only when there is an id', () => {
    globalThis.window = globalThis;
    globalThis.WpTargetInfo = TI;
    const parts = require(mimic('parts.js'));
    const P = (parts.WpParts || globalThis.WpParts).PARTS.find(p => p.id === 'target.spells');
    const out = P.get({ mobInfo: { mob: { spells: [{ id: 1546, name: 'Lava Breath', good: 0 }, { name: 'Mystery', good: 0 }] } } });
    expect(out.items.find(i => i.name === 'Lava Breath').url).toBe('https://www.pqdi.cc/spell/1546');
    expect(out.items.find(i => i.name === 'Mystery').url).toBeUndefined();
  });
});

describe('kill log parity: Target Info and the canvas share one renderer', () => {
  const NOW = 1_790_000_000_000, MIN = 60_000;
  const ring = [
    { key: 'live', name: 'a gnoll warlord', zoneName: 'The Feerrott', lastMs: NOW, minHp: 90, killedMs: null },
    { key: 'wolf', name: 'a dire wolf', zoneName: 'Lavastorm Mountains', lastMs: NOW - 4 * MIN, minHp: 0, killedMs: NOW - 4 * MIN },
    { key: 'spid', name: 'a giant spider', zoneName: 'Lavastorm Mountains', lastMs: NOW - 12 * MIN, minHp: 54, killedMs: null },
  ];
  it('both surfaces call TI.killLogRows', () => {
    expect(mobinfo).toMatch(/WpTargetInfo\.killLogRows\(/);
    expect(partsSrc).toMatch(/TI\.killLogRows\(/);
  });
  it('the canvas piece shows the same names and detail lines the overlay rows do', () => {
    globalThis.window = globalThis;
    globalThis.WpTargetInfo = TI;
    const P = (globalThis.WpParts).PARTS.find(p => p.id === 'target.recent');
    expect(P.src).toBe('hist');
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      const out = P.get({ targets: ring });
      const rows = TI.killLogRows(ring, 'all', null, NOW);
      expect(out.items.map(i => [i.name, i.sub])).toEqual(rows.map(r => [r.name, r.line2]));
      expect(out.items[1].sub).toBe('Lavastorm Mountains · killed 4m ago');
      expect(out.items[2].sub).toBe('Lavastorm Mountains · left alive, seen 12m ago · lowest HP 54%');
      expect(P.get({ targets: [] }).empty).toBe('no targets yet — target a mob and it lands here');
      expect(P.get({})).toBe(null);
    } finally { Date.now = realNow; }
  });
  it('the canvas ships the shared file before parts.js and the piece is in a preset', () => {
    const canvas = fs.readFileSync(mimic('canvas.html'), 'utf8');
    const shared = canvas.indexOf('<script src="targetInfoShared.js">');
    expect(shared).toBeGreaterThan(-1);
    expect(shared).toBeLessThan(canvas.indexOf('<script src="parts.js">'));
    expect(partsSrc).toMatch(/\['target\.recent', 'rows'/);
  });
});
