// test/weave-haste.test.js — the Weave timer's haste from BUFFS and GEAR.
//
// The guild lead, 2026-11-09: "We should be figuring out haste based on buffs too." The agent adds up the live buff list and
// the worn gear the way the server does (EQMacEmu c2cd265: Mob::GetHaste zone/mob.cpp:2887, Client::GetHasteCap
// zone/client.cpp:5789, SE_AttackSpeed/2/3 zone/bonuses.cpp:1136-1182) and the engine times a swing as delay * 10000 / N
// (Client::SetAttackTimer) the moment that N changes, rather than after two swings.
//
// The formula and the agent field run the agent's REAL source (sliced and evaluated); the engine is driven with synthetic arrival
// times. Wiring assertions strip comments first. Names are invented. Every assertion was mutation-checked (notes at the bottom).
//
// Run: npx vitest run test/weave-haste.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, stripSql, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const W = require(path.join(MIMIC, 'weave.js'));
const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));

const hasteBlock = sliceBlock(agent, 'let _wornHasteByItem = new Map();', '\n// ── XP events (FB-37 option B');
const parts = (globalsSrc) => evalBlock(globalsSrc + '\n' + hasteBlock,
  ['_serverHaste', '_hasteCapFor', '_setWornHasteCatalog', '_wornItemHaste', '_meHaste']);

// Spell values as the catalog's `hs`: [SPA 11, SPA 98, SPA 119].
const HASTE_30 = [130, 0, 0], HASTE_41 = [141, 0, 0], HASTE_25_V2 = [0, 125, 0];
const OVER_35 = [0, 0, 35], OVER_10 = [0, 0, 10], SLOW_40 = [60, 0, 0], SLOW_V3 = [0, 0, -20];

describe('the server sum (Mob::GetHaste, mob.cpp:2887)', () => {
  const { _serverHaste: H } = parts('');
  it('no buffs, no gear: N = 100 (swing = delay * 100)', () => { expect(H(65, [], 0).value).toBe(100); });
  it('best of the spell haste, not the sum (bonuses.cpp:1136-1140)', () => {
    expect(H(65, [HASTE_30, HASTE_41], 0)).toMatchObject({ value: 141, spell: 41 });
    expect(H(65, [HASTE_41, HASTE_30], 0).value).toBe(141);
  });
  it('type 2 (SPA 98) stacks on type 1 at level 50+, at most 10 (mob.cpp:2898)', () => {
    expect(H(65, [HASTE_30, HASTE_25_V2], 0)).toMatchObject({ value: 140, v2: 10 });
    expect(H(49, [HASTE_30, HASTE_25_V2], 0).value).toBe(130);
    expect(H(65, [[0, 105, 0]], 0).v2).toBe(5);
  });
  it('worn item haste is added in full above level 25, at most 10 at or below (mob.cpp:2902-2909)', () => {
    expect(H(65, [], 28)).toMatchObject({ value: 128, item: 28 });
    expect(H(25, [], 28).item).toBe(10);
    expect(H(26, [], 28).item).toBe(28);
  });
  it('spell + item are cut to the cap: 200 from 60 (client.cpp:5789-5802), 185 at 51-59, 125 + level to 50', () => {
    expect(H(65, [HASTE_41], 28)).toMatchObject({ value: 169, cap: 200 });
    expect(H(65, [[200, 0, 0]], 28).value).toBe(200);
    expect(H(55, [[190, 0, 0]], 0).value).toBe(185);
    expect(H(40, [[190, 0, 0]], 0).value).toBe(165);
  });
  it('overhaste (SPA 119) is added OVER the cap, at most 25 above level 50, 10 at or below (mob.cpp:2915)', () => {
    expect(H(65, [[190, 0, 0], OVER_35], 28)).toMatchObject({ value: 225, v3: 25, cap: 200 });
    expect(H(65, [HASTE_30, OVER_10], 0).value).toBe(140);
    expect(H(50, [OVER_35], 0).v3).toBe(10);
  });
  it('a slow replaces a haste and ends the sum: 100 + the slow, no type 2, no gear, no overhaste (mob.cpp:2889)', () => {
    expect(H(65, [HASTE_41, SLOW_40], 28)).toMatchObject({ value: 60, spell: -40, v2: 0, item: 0, v3: 0 });
    expect(H(65, [SLOW_40, HASTE_41], 28).value).toBe(60);     // a haste after a slow is skipped (bonuses.cpp:1137)
    expect(H(65, [[85, 0, 0], SLOW_40], 0).value).toBe(60);    // the deeper slow wins
    expect(H(65, [HASTE_41, OVER_35, SLOW_40], 0).value).toBe(60);
  });
  it('an overhaste slow takes off from the total (bonuses.cpp:1169-1173)', () => {
    expect(H(65, [HASTE_30, SLOW_V3], 0)).toMatchObject({ value: 110, v3: -20 });
  });
});

describe('the agent field: buffs by name from the catalog, worn items from the inventory', () => {
  const INV = { Aldenmar: { items: [
    { loc: 'Hands', id: 1001, name: 'Gauntlets of Quickness' }, { loc: 'Ear1', id: 1002, name: 'Plain Earring' },
    { loc: 'General1', id: 1003, name: 'Bagged Haste Charm' },   // a bag slot does not count as worn
  ], _updatedAt: '2026-11-09T17:00:00Z' } };
  const rig = (over = {}) => {
    const g = {
      stats: { characterInventories: over.invs === undefined ? INV : over.invs },
      INVENTORY_WORN_SLOTS: new Set(['Hands', 'Ear', 'Head', 'Primary']),
      _quarmyLocalItems: () => null,
      _spellCatalogMeta: over.meta === undefined ? { hasHaste: true } : over.meta,
      _meSpell: (n) => ({ 'Speed of the Shissar': { hs: HASTE_41 }, 'Overhaste Song': { hs: OVER_35 }, 'Tepid Deeds': { hs: SLOW_40 },
        'Skin like Nature': {} })[n] || null,
    };
    return { g };
  };
  // The sliced block is run with the rig's globals handed in by name.
  const build = (over) => {
    const r = rig(over);
    const src = hasteBlock;
    const fn = new Function('stats', 'INVENTORY_WORN_SLOTS', '_quarmyLocalItems', '_meSpell', '_spellCatalogMeta',
      src + '\nreturn { _setWornHasteCatalog, _meHaste, _wornItemHaste };');
    const api = fn(r.g.stats, r.g.INVENTORY_WORN_SLOTS, r.g._quarmyLocalItems, r.g._meSpell, r.g._spellCatalogMeta);
    api._setWornHasteCatalog(over && over.worn !== undefined ? over.worn : [{ id: 1001, name: 'Gauntlets of Quickness', haste: 28 }, { id: 1003, name: 'Bagged Haste Charm', haste: 40 }]);
    return api;
  };
  const buffs = (...names) => ({ buffs: names.map(name => ({ name })) });
  it('buffs + worn gear -> { value, spell, v2, item, v3, cap, from }', () => {
    expect(build()._meHaste('aldenmar', 65, buffs('Speed of the Shissar', 'Overhaste Song', 'Skin like Nature')))
      .toEqual({ value: 194, spell: 41, v2: 0, item: 28, v3: 25, cap: 200, from: 'buffs' });
  });
  it('a bag item does not count; a slow wins', () => {
    expect(build()._meHaste('aldenmar', 65, buffs()).item).toBe(28);
    expect(build()._meHaste('aldenmar', 65, buffs('Speed of the Shissar', 'Tepid Deeds')).value).toBe(60);
  });
  it('null when anything is unread: no buff list, a catalog without haste, no inventory, no worn_haste from the bot', () => {
    expect(build()._meHaste('aldenmar', 65, {})).toBeNull();
    expect(build({ meta: { hasHaste: false } })._meHaste('aldenmar', 65, buffs())).toBeNull();
    expect(build({ invs: {} })._meHaste('aldenmar', 65, buffs())).toBeNull();
    expect(build({ worn: null })._meHaste('aldenmar', 65, buffs())).toBeNull();
    expect(build()._meHaste('aldenmar', 0, buffs())).toBeNull();
  });
  it('is wired into gear and the bot sends the values', () => {
    const a = stripJs(agent);
    expect(a).toContain('haste: _meHaste(character, level, st),');
    expect(a).toContain('_setWornHasteCatalog(data.worn_haste);');
    const bot = stripJs(readSource(path.join(ROOT, 'index.js')));
    expect(bot).toContain('hs: _hasteSlots(r) || undefined,');
    expect(bot).toContain('worn_haste: wornHaste,');
    const mig = readSource(path.join(ROOT, 'supabase', 'migrations', '20261109120000_item_worn_haste.sql'));
    const sql = stripSql(mig);
    expect(sql).toMatch(/e\.eff = '11'/);
    // Only a worn effect counts (bonuses.cpp:245), and spell 998 "Haste" (105 of 115 items) is base 101 + the item's worn
    // level: read as its base it would be 1% (2026-11-09 review); the item's own haste figure is used for a level formula.
    expect(sql).toMatch(/i\.worntype = 2/);
    expect(sql).toMatch(/in \(0, 100\)[\s\S]*else least\(coalesce\(i\.haste,/);
  });
});

// The engine: T3 = delay 30 at N 170 is 1764.7 ms; at N 125 it is 2400 ms; at 100, 3000 ms.
const TWO = 'You crush a gnoll for 120 points of damage.';
const cfgN = (n) => ({ twoHDelay: 30, hasteN: n });
describe('the engine uses the buff haste at once (weave.js setConfig / priorN)', () => {
  it('before any swing: the prior is delay * 10000 / N', () => {
    const e = new W.WeaveEngine(cfgN(170));
    e.setConfig(cfgN(170), 1000);
    expect(Math.round(e.interval2H())).toBe(1765);
    expect(new W.WeaveEngine({ twoHDelay: 30 }).interval2H()).toBe(3000);   // no N: the setting, as before
  });
  it('a change mid-fight re-locks immediately and says so, with no swings in between', () => {
    const e = new W.WeaveEngine(cfgN(170));
    e.setConfig(cfgN(170), 0);
    let t = 1000;
    for (let i = 0; i < 6; i++) { e.swing(TWO, t); t += 3000 / 1.7; }
    expect(e.measured()).toBe(true);
    expect(Math.round(e.interval2H())).toBe(1765);
    e.setConfig(cfgN(125), t);                          // the haste buff faded
    expect(e.measured()).toBe(false);
    expect(Math.round(e.interval2H())).toBe(2400);
    expect(e.notice).toMatchObject({ kind: 'speed', text: 'HASTE 170% → 125% (buffs)', at: t });
  });
  it('the same N again changes nothing; no N keeps the last (a dropped read is not a fade)', () => {
    const e = new W.WeaveEngine(cfgN(170));
    e.setConfig(cfgN(170), 0);
    for (let i = 0; i < 4; i++) e.swing(TWO, 1000 + i * 1765);
    e.setConfig(cfgN(170), 9000);
    expect(e.measured()).toBe(true);
    e.setConfig({ twoHDelay: 30 }, 9100);
    expect(e.measured()).toBe(true);
    expect(e.buffN).toBe(170);
  });
  it('measured swings win again: three at the real speed replace the prediction', () => {
    const e = new W.WeaveEngine(cfgN(170));
    e.setConfig(cfgN(170), 0);
    e.swing(TWO, 1000); e.setConfig(cfgN(100), 1500);   // wrong guess: really it stays 1765
    for (let i = 1; i < 6; i++) e.swing(TWO, 1000 + i * 1765);
    expect(Math.round(e.interval2H())).toBe(1765);
  });
  it('/mystats stays calibrated: its delay carries over a buff change, and it wins while it is the newer word', () => {
    const e = new W.WeaveEngine(cfgN(170));
    e.setConfig(cfgN(170), 0);
    for (let i = 0; i < 4; i++) e.swing(TWO, 1000 + i * 2000);       // measured 2000 ms
    e.mystats(150, 9000);                                            // delay = 2000 * 150 / 10000 = 30
    expect(e.statsDelay).toBe(30);
    expect(e.priorN()).toBe(150);
    e.setConfig(cfgN(125), 9500);                                    // a buff fades after the /mystats
    expect(e.priorN()).toBe(125);
    expect(Math.round(e.interval2H())).toBe(2400);                   // 30 * 10000 / 125, the calibrated delay
  });
  it('the config clamps N, and the HUD sends it from gear.haste', () => {
    expect(W.cleanCfg({ hasteN: 170 }).hasteN).toBe(170);
    expect(W.cleanCfg({ hasteN: 0 }).hasteN).toBeNull();
    expect(W.cleanCfg({ hasteN: null }).hasteN).toBeNull();
    expect(W.cleanCfg({ hasteN: 9000 }).hasteN).toBeNull();
    const me = stripJs(readSource(path.join(MIMIC, 'me.html')));
    expect(me).toContain('hasteN: g.haste && g.haste.value > 0 ? g.haste.value : null,');
    const w = stripJs(readSource(path.join(MIMIC, 'weave.js')));
    expect(w).toContain('e.eng.setConfig(cfg, Date.now());');
  });
});

// Mutation notes (each flipped, the named assertion went red, then restored): best-of -> sum in _foldHaste; the type-2 level gate
// 49 -> 40; item cap 10 -> 25; cap applied after type 3; v3 cap 25 -> 35; the slow branch returning 100 + h1 + v2; dropping the
// samples reset in _buffHaste; priorN preferring hasteN always.
