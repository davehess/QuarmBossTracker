// test/mana-drain-and-con.test.js — mana drains on mobs, the PvP drain tally,
// and a player's level from /who or /consider.
//
// A member asked for the mob mana bar to account for drains ("theft of
// thought, either a proc from a weapon or spell, bard drain songs"); the guild
// lead then asked (2026-09-24) whether it works in PvP, said yes to a PvP
// tally, and asked for "class and level from /who data for target overlay for
// players … capturing exact level from even con or /who, or a range from con
// and anon."
//
// The drain rules and the con table are the Quarm SERVER's, read from source
// (EQMacEmu zone/spell_effects.cpp SE_CurrentMana, CalcSpellEffectValue_formula;
// zone/mob_ai.cpp Mob::GetLevelCon) — the expectations below are that source's
// numbers. Runs the real agent functions. Names are invented.
//
// Run: npx vitest run test/mana-drain-and-con.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const html  = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));

const durBlock   = sliceBlock(agent, 'function _durTicksForLevel(formula, capTicks, level) {', '\n}');
const drainBlock = sliceBlock(agent, 'const _npcManaByMob = new Map();', '\n// Bystander-visible heal LANDINGS');
const conBlock   = sliceBlock(agent, 'const CON_STANDINGS = [', '\n];')
  + '\n' + sliceBlock(agent, '// ── /consider → a level (the guild lead, 2026-09-24)', "\n  return (rec && Date.now() - rec.at <= 6 * 3_600_000) ? rec : null;\n}");
const playerBlock = sliceBlock(agent, 'function _targetPlayerInfo(st, selfChar, cached) {', '\nfunction buildMobInfo() {')
  .replace(/\nfunction buildMobInfo\(\) \{$/, '');
const tsBlock = agent.match(/const TS_RX = [^\n]+/)[0] + '\n' + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');

// The real catalog entries' drain shapes (eqemu_spells, bot 3.1.147).
const CATALOG = [
  { name: 'Theft of Thought', drain: { b: 40, f: 6, m: 400 }, durf: 0, dur: 0 },
  { name: 'Mana Sieve',       drain: { b: 10, f: 6, m: 370 }, durf: 0, dur: 0 },
  { name: 'Torment of Argli', drain: { b: 35, f: 100, m: 0 }, durf: 7, dur: 20 },
  { name: "Denon`s Dissension", drain: { b: 5, f: 101, m: 0 }, durf: 0, dur: 0 },
];

function load({ mobs = {}, zeal = {}, who = {}, hist = {} } = {}) {
  const pre = `
    const fs = { readFileSync() { throw new Error('none'); }, writeFileSync() {} };
    const path = { join: (...a) => a.join('/') };
    const __dirname = '/tmp';
    function _assumedCasterLevel() { return 60; }
    ${durBlock}
    ${tsBlock}
    const _spellByNameLower = new Map(${JSON.stringify(CATALOG.map(e => [e.name.toLowerCase(), e]))});
    const _MOBS = ${JSON.stringify(mobs)};
    function _npcMobInfoFor(n) { return _MOBS[String(n).toLowerCase()] || null; }
    const _zealState = ${JSON.stringify(zeal)};
    const whoData = new Map(${JSON.stringify(Object.entries(who))});
    const _raidClassByName = new Map();
    const _whoLookupCache = new Map(${JSON.stringify(Object.entries(hist).map(([k, v]) => [k, { at: Date.now(), data: v }]))});
    function fetchWhoLookup() {}
    function normalizeClass(s) { return s ? String(s).trim() : s; }
  `;
  // eslint-disable-next-line no-new-func
  return new Function(pre + drainBlock + '\n' + conBlock + '\n' + playerBlock + `
    return { _drainAmount, _npcInstantDrainCut, _noteManaDrainLanding, npcManaState, pvpDrainState,
             _npcManaOnSlain, _levelCon, _conLevelRange, noteConsiderLevel, conLevelFor, _targetPlayerInfo };`)();
}
const me = (name, level) => ({ [name]: { updatedAt: Date.now(), charInfo: [{ id: 2, value: String(level) }] } });
const own = (spell, target, id, secsAgo = 0) => ({ spell_name: spell, target, target_id: id ?? null, _selfCast: true,
  cast_at: new Date(Date.now() - secsAgo * 1000).toISOString() });
const L = (msg) => '[Thu Sep 24 02:00:00 2026] ' + msg;

describe('how much a drain takes', () => {
  const m = load();
  it('formula 1–99 is base + level × formula: Theft of Thought 400 at 60, capped', () => {
    expect(m._drainAmount({ b: 40, f: 6, m: 400 }, 60)).toBe(400);
    expect(m._drainAmount({ b: 40, f: 6, m: 400 }, 50)).toBe(340);
    expect(m._drainAmount({ b: 10, f: 6, m: 370 }, 60)).toBe(370);
  });
  it('formula 101 is base + level / 2; 100 is the base', () => {
    expect(m._drainAmount({ b: 5, f: 101, m: 0 }, 60)).toBe(35);
    expect(m._drainAmount({ b: 35, f: 100, m: 0 }, 60)).toBe(35);
  });
  it('an instant drain on an NPC above 52 is cut: ÷2 at 53–54, ÷3 capped at 105 at 55+', () => {
    expect(m._npcInstantDrainCut(400, 60)).toBe(105);
    expect(m._npcInstantDrainCut(300, 55)).toBe(100);
    expect(m._npcInstantDrainCut(400, 53)).toBe(200);
    expect(m._npcInstantDrainCut(400, 52)).toBe(400);
  });
});

describe('a mob\'s mana', () => {
  const BOSS = { 'a kromrif priest': { name: 'a Kromrif priest', level: 60, mana: 5000, class: 2 } };
  it('your Theft of Thought takes 105 from a level-60 mob, not 400', () => {
    const m = load({ mobs: BOSS, zeal: me('Nyssara', 60) });
    m._noteManaDrainLanding(own('Theft of Thought', 'a Kromrif priest', 77), 'Nyssara');
    expect(m.npcManaState('a Kromrif priest', 77)).toMatchObject({ drained: 105, cur: 4895 });
  });
  it('a timed drain ticks — Torment of Argli 35 a tick, five ticks after 30 seconds — and is not cut', () => {
    const m = load({ mobs: BOSS, zeal: me('Nyssara', 60) });
    m._noteManaDrainLanding(own('Torment of Argli', 'a Kromrif priest', 77, 30), 'Nyssara');
    expect(m.npcManaState('a Kromrif priest', 77).drained).toBe(175);
  });
  it('someone else\'s timed drain counts; their instant drain cannot be seen', () => {
    const m = load({ mobs: BOSS });
    m._noteManaDrainLanding({ spell_name: 'Torment of Argli', target: 'a Kromrif priest', target_id: 77, cast_at: new Date(Date.now() - 12_000).toISOString() }, null);
    m._noteManaDrainLanding({ spell_name: 'Theft of Thought', target: 'a Kromrif priest', target_id: 77, cast_at: new Date().toISOString() }, null);
    expect(m.npcManaState('a Kromrif priest', 77).drained).toBe(70);
  });
  it('a bard NPC takes nothing', () => {
    const m = load({ mobs: { 'a kromrif skald': { name: 'a Kromrif skald', level: 58, mana: 3000, class: 8 } }, zeal: me('Nyssara', 60) });
    m._noteManaDrainLanding(own('Theft of Thought', 'a Kromrif skald', 5), 'Nyssara');
    expect(m.npcManaState('a Kromrif skald', 5)).toBeNull();
  });
  it('a slain mob\'s ledger goes with it', () => {
    const m = load({ mobs: BOSS, zeal: me('Nyssara', 60) });
    m._noteManaDrainLanding(own('Theft of Thought', 'a Kromrif priest', null), 'Nyssara');
    m._npcManaOnSlain('a Kromrif priest');
    expect(m.npcManaState('a Kromrif priest', null)).toBeNull();
  });
});

describe('PvP: what your drains took from a player', () => {
  it('counts at full strength — the cut is for NPCs only', () => {
    const m = load({ zeal: me('Nyssara', 60) });
    m._noteManaDrainLanding(own('Theft of Thought', 'Brackwyn', null), 'Nyssara');
    m._noteManaDrainLanding(own('Mana Sieve', 'Brackwyn', null), 'Nyssara');
    expect(m.pvpDrainState('Nyssara', 'Brackwyn')).toMatchObject({ mana: 770, casts: 2 });
  });
});

describe('the con table (Mob::GetLevelCon)', () => {
  const m = load();
  it('matches the server at level 60', () => {
    expect(m._levelCon(60, 60)).toBe('white');
    expect(m._levelCon(60, 62)).toBe('yellow');
    expect(m._levelCon(60, 63)).toBe('red');
    expect(m._levelCon(60, 45)).toBe('blue');       // diff -15
    expect(m._levelCon(60, 44)).toBe('lightblue');  // diff -16
    expect(m._levelCon(60, 40)).toBe('lightblue');  // diff -20
    expect(m._levelCon(60, 39)).toBe('green');      // diff -21
  });
  it('a colour at level 60 gives these levels', () => {
    expect(m._conLevelRange(60, 'blue')).toEqual({ min: 45, max: 59 });
    expect(m._conLevelRange(60, 'lightblue')).toEqual({ min: 40, max: 44 });
    expect(m._conLevelRange(60, 'green')).toEqual({ min: 1, max: 39 });
    expect(m._conLevelRange(60, 'yellow')).toEqual({ min: 61, max: 62 });
    expect(m._conLevelRange(60, 'red')).toEqual({ min: 63, max: null });
  });
  it('agrees with itself: every level maps back into its own colour\'s range', () => {
    for (const my of [5, 8, 20, 35, 50, 55, 60, 61, 62, 65]) {
      for (let other = 1; other <= 70; other++) {
        const r = m._conLevelRange(my, m._levelCon(my, other));
        expect(other >= r.min && (r.max == null || other <= r.max), `${my} vs ${other}`).toBe(true);
      }
    }
  });
});

describe('/consider → a level', () => {
  it('an even con IS the level', () => {
    const m = load({ zeal: me('Nyssara', 60) });
    m.noteConsiderLevel(L('Brackwyn regards you indifferently -- looks like an even fight.'), 'Nyssara');
    expect(m.conLevelFor('Nyssara', 'Brackwyn')).toMatchObject({ colour: 'white', exact: 60 });
  });
  it('a documented phrase gives a range', () => {
    const m = load({ zeal: me('Nyssara', 60) });
    m.noteConsiderLevel(L('Brackwyn regards you indifferently -- looks like quite a gamble.'), 'Nyssara');
    expect(m.conLevelFor('Nyssara', 'Brackwyn')).toMatchObject({ colour: 'yellow', min: 61, max: 62 });
  });
  it('a phrase it has not been told is LEARNED from a target whose level is known, then used', () => {
    // The phrase here is a stand-in — the point is that nothing hard-codes it.
    const m = load({ zeal: me('Nyssara', 60), mobs: { 'a kromrif guard': { name: 'a Kromrif guard', level: 52, mana: 0 } } });
    m.noteConsiderLevel(L('a Kromrif guard scowls at you, ready to attack -- test phrase for blue.'), 'Nyssara');
    m.noteConsiderLevel(L('Corvale regards you indifferently -- test phrase for blue.'), 'Nyssara');
    expect(m.conLevelFor('Nyssara', 'Corvale')).toMatchObject({ colour: 'blue', min: 45, max: 59 });
  });
  // The guild lead, 2026-09-24: level-60 players conned by a level 60 read "looks
  // like quite a gamble" — a yellow by the table. A player's consider does not
  // follow it, so a /who level must never teach a phrase its colour.
  it('never learns a phrase from a PLAYER, even one /who has shown', () => {
    const m = load({ zeal: me('Nyssara', 60), who: { brackwyn: { name: 'Brackwyn', class: 'Enchanter', level: 52, anonymous: false } } });
    m.noteConsiderLevel(L('Brackwyn regards you indifferently -- test phrase for blue.'), 'Nyssara');
    m.noteConsiderLevel(L('Corvale regards you indifferently -- test phrase for blue.'), 'Nyssara');
    expect(m.conLevelFor('Nyssara', 'Corvale')).toBeNull();
  });
  it('an unknown phrase with nothing to learn from gives nothing', () => {
    const m = load({ zeal: me('Nyssara', 60) });
    m.noteConsiderLevel(L('Corvale regards you indifferently -- a phrase never seen.'), 'Nyssara');
    expect(m.conLevelFor('Nyssara', 'Corvale')).toBeNull();
  });
});

describe('a player on Target Info', () => {
  const st = (name) => ({ target_name: name });
  it('/who gives the class and the exact level', () => {
    const m = load({ who: { brackwyn: { name: 'Brackwyn', class: 'Enchanter', level: 60, anonymous: false } } });
    expect(m._targetPlayerInfo(st('Brackwyn'), 'Nyssara', { mob: null })).toMatchObject({ class: 'Enchanter', level: 60, level_src: 'who' });
  });
  // The guild lead, 2026-09-24: "INcorrectly characterizing 'looks like quite a
  // gamble' as a yellow con. these folks are level 60".
  it('anonymous: the last level /who history saw — a consider never overrides it, and names no colour', () => {
    const m = load({ zeal: me('Nyssara', 60), who: { corvale: { name: 'Corvale', anonymous: true } }, hist: { corvale: { class: 'Wizard', level: 60 } } });
    m.noteConsiderLevel(L('Corvale regards you indifferently -- looks like quite a gamble.'), 'Nyssara');
    const p = m._targetPlayerInfo(st('Corvale'), 'Nyssara', { mob: null });
    expect(p).toMatchObject({ anonymous: true, class: 'Wizard', class_src: 'history', level: 60, level_src: 'history',
      level_min: null, level_max: null, con_colour: null });
  });
  it('a consider alone gives a player no level', () => {
    const m = load({ zeal: me('Nyssara', 60) });
    m.noteConsiderLevel(L('Tovrin regards you indifferently -- looks like quite a gamble.'), 'Nyssara');
    expect(m._targetPlayerInfo(st('Tovrin'), 'Nyssara', { mob: null })).toMatchObject({ level: null, level_min: null, con_colour: null });
  });
  it('says when there is nothing to drain', () => {
    const m = load({ who: { rethlan: { class: 'Bard', level: 60 }, zarrin: { class: 'Warrior', level: 60 } } });
    expect(m._targetPlayerInfo(st('Rethlan'), 'Nyssara', { mob: null }).drain_immune).toBe(true);
    expect(m._targetPlayerInfo(st('Zarrin'), 'Nyssara', { mob: null }).no_mana).toBe(true);
  });
  it('an NPC is not a player', () => {
    const m = load();
    expect(m._targetPlayerInfo(st('Vox'), 'Nyssara', { mob: { name: 'Vox' } })).toBeNull();
    expect(m._targetPlayerInfo(st('a Kromrif guard'), 'Nyssara', { mob: null })).toBeNull();
  });
});

describe('the Target Info card', () => {
  const script = html.slice(html.indexOf('<script>') + 8);
  const block = sliceBlock(script, '  var CON_COLOURS = {', '\n    return h;\n  }');
  // eslint-disable-next-line no-new-func
  const card = new Function(`
    function esc(s){ return String(s == null ? '' : s); }
    function fmtNum(n){ return Number(n).toLocaleString('en-US'); }
    ${block}
    return playerCard;`)();
  it('shows a con range with the colour, and the PvP drain', () => {
    const h = card({ class: 'Wizard', class_src: 'history', level: null, level_min: 61, level_max: 62, con_colour: 'yellow',
      history_level: 58, drained: { mana: 770, casts: 2 } });
    expect(h).toContain('level <b>61–62</b>');
    expect(h).toContain('yellow con');
    expect(h).toContain('last seen 58');
    expect(h).toContain('drained up to <b style="color:#58a6ff">770</b> mana · 2 casts');
  });
  it('with no level at all, says /who is where it comes from — never a consider', () => {
    expect(card({ anonymous: true })).toContain('level unknown until a /who sees them out of anonymous');
    expect(card({ anonymous: true })).not.toContain('/consider');
  });
});
