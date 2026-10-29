// test/target-info-solo-landings.test.js — FB-111: "When <a member> targets a mob solo he doesn't see buffs or
// debuffs landing on it. He does see his own buffs."
//
// A melee class playing alone casts nothing, so Target Info's list could only ever hold what lands WITHOUT a
// "You begin casting" line: item procs and poisons, and what the mob casts on itself. These run the agent's real
// landing parsers, recorder and reader over a small invented catalog and report which of those reach the list.
//
// Run: npx vitest run test/target-info-solo-landings.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0, end = start;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}

const SPELLS = [
  // an item proc / poison that leaves a timed effect, no cast line
  { id: 1, name: 'Venomed Edge Strike', other: ' is wracked by venom.', durf: 1, dur: 4, good: 0 },
  // an instant proc: no duration, nothing to count down
  { id: 2, name: 'Searing Stab', other: ' is seared by flame.', durf: 0, dur: 0, good: 0 },
  // a mob's own buff
  { id: 3, name: 'Hollow Hide', other: "'s skin hardens like stone.", durf: 3, dur: 40, good: 1, npc: 1 },
  // two mob buffs that print the same words
  { id: 6, name: 'Twin Hide Lesser', other: ' shimmers with twin light.', durf: 3, dur: 20, good: 1, npc: 1 },
  { id: 7, name: 'Twin Hide Greater', other: ' shimmers with twin light.', durf: 3, dur: 60, good: 1, npc: 1 },
  // a debuff a groupmate casts
  { id: 4, name: 'Tashani', other: ' glances nervously about.', durf: 3, dur: 90, good: 0 },
  // the control: the member's own cast
  { id: 5, name: 'Malosini', other: ' looks uncomfortable.', durf: 3, dur: 90, good: 0 },
];

function load() {
  const harness = `
    const _spellByNameLower = new Map(${JSON.stringify(SPELLS.map(s => [s.name.toLowerCase(), s]))});
    const FELL_OFF_LINGER_MS = 5 * 60 * 1000;
    const _recentSelfCast = new Map();
    const SELF_CAST_WINDOW_MS = 12000;
    const _CAST_BEGIN_RX = /\\]\\s+You begin (?:casting|singing)\\s+(.+?)\\.\\s*$/i;
    const CHARM_SPELLS = new Map();
    const whoData = new Map();
    const _buffLandingsByTarget = new Map();
    const _zealState = { Aldenmar: { target_name: 'a hollow guard', target_id: null } };
    const _GENERIC_MOB_RX = /^(?:a|an|the)\\s/i;
    function _zealTargetForChar() { return _zealState.Aldenmar.target_name; }
    function _provableTargetId() { return null; }
    function _assumedCasterLevel() { return 60; }
    function _petOwnerByName() { return null; }
    function _npcCasterLevelFor() { return null; }
    function _resistLadderEffect() { return null; }
    function _categorizeBuff() { return null; }
    function _isHotBuff() { return false; }
    function _isSlowSpell() { return false; }
    function _isPacifySpell() { return false; }
    function _isAePacify() { return false; }
    function _petOwnerOf() { return null; }
    function _savePetStateSoon() {}
    function _mobInfoFor() { return null; }
    const console = { log() {} };
    const _npcCastStarts = [];
    function _knownLevelOf() { return null; }
    let __mob = null;
    function _npcMobInfoFor() { return __mob; }
    function __setMob(v) { __mob = v; }
    const _NPC_CAST_WINDOW_MS = 15000;
    let _npcSelfBuffBySuffix = new Map();
    function parseEqTimestamp(line) { const m = String(line).match(/^\\[(.+?)\\]/); return m ? new Date(m[1] + ' UTC') : null; }
    ${sliceBlock(src, 'const _TRACKED_BUFF_KEYWORDS = [', '\n];')}
    ${grab('_isTrackedBuffName')}
    ${grab('_isTimedDurationFormula')}
    ${grab('_looksLikePlayerName')}
    ${grab('_looksLikeTargetName')}
    ${grab('_spellGood')}
    ${grab('_durTicksForLevel')}
    let _buffLandingBySuffix = new Map();
    let _debuffLandingBySuffix = new Map();
    const _rebuildMechanicMatchers = () => {};
    ${grab('_rebuildBuffMatchers')}
    ${grab('parseBuffLanding')}
    ${grab('parseDebuffLanding')}
    ${grab('_npcCasterFor')}
    ${grab('parseNpcSelfBuffLanding')}
    ${grab('noteSelfCast')}
    ${grab('resolveSelfCastLanding')}
    ${grab('_shouldSuppressBuffLanding')}
    ${grab('recordTargetBuffLanding')}
    ${grab('targetBuffsFor')}
    _rebuildBuffMatchers();
  `;
  return evalBlock(harness, ['parseBuffLanding', 'parseDebuffLanding', 'noteSelfCast', 'resolveSelfCastLanding',
    'recordTargetBuffLanding', 'targetBuffsFor', '_npcCastStarts', '_buffLandingsByTarget', 'parseNpcSelfBuffLanding', '__setMob']);
}

const T0 = Date.parse('Fri Oct 30 20:00:00 2026 UTC');
const stamp = (ms) => '[' + new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 $4') + '] ';

// What the watch loop does with one line (index.js, the buff-landing block), minus uploads.
function feed(h, line, who) {
  const bcEvt = h.resolveSelfCastLanding(line, who) || h.parseBuffLanding(line, who);
  if (bcEvt) { h.recordTargetBuffLanding(bcEvt); return bcEvt; }
  const dbEvt = h.parseDebuffLanding(line, who);
  if (dbEvt && dbEvt.spell_name) { h.recordTargetBuffLanding(dbEvt); return dbEvt; }
  const nbEvt = h.parseNpcSelfBuffLanding(line);
  if (nbEvt) { h.recordTargetBuffLanding(nbEvt); return nbEvt; }
  return null;
}
const names = (h, t) => h.targetBuffsFor(t).map(b => b.name);

describe('what reaches Target Info for a solo melee class', () => {
  it('(d) control: the member\'s own cast debuff shows', () => {
    const h = load();
    h.noteSelfCast(stamp(T0) + 'You begin casting Malosini.', 'Aldenmar');
    feed(h, stamp(T0 + 3000) + 'a hollow guard looks uncomfortable.', 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual(['Malosini']);
  });

  it('(a) a timed proc / poison landing with no cast line shows', () => {
    const h = load();
    feed(h, stamp(T0) + 'a hollow guard is wracked by venom.', 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual(['Venomed Edge Strike']);
  });

  it('(c) a groupmate\'s debuff landing shows', () => {
    const h = load();
    feed(h, stamp(T0) + 'a hollow guard glances nervously about.', 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual(['Tashani']);
  });

  it('(b) a mob\'s own buff shows after it began casting', () => {
    const h = load();
    h._npcCastStarts.push({ caster: 'a hollow guard', atMs: T0 });
    feed(h, stamp(T0 + 3000) + "a hollow guard's skin hardens like stone.", 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual(['Hollow Hide']);
  });

  it('(b) times it from the catalog duration, capped as every landing is at the era-cap level', () => {
    const h = load();
    h._npcCastStarts.push({ caster: 'a hollow guard', atMs: T0 });
    feed(h, stamp(T0 + 3000) + "a hollow guard's skin hardens like stone.", 'Aldenmar');
    const [b] = h.targetBuffsFor('a hollow guard');
    expect(b).toMatchObject({ name: 'Hollow Hide', good: 1, total_secs: 240 });
  });

  it('(b) does not claim a landing the named mob did not begin casting', () => {
    const h = load();
    h._npcCastStarts.push({ caster: 'a hollow shaman', atMs: T0 });
    feed(h, stamp(T0 + 3000) + "a hollow guard's skin hardens like stone.", 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual([]);
  });

  it('(b) does not claim a landing long after the cast began', () => {
    const h = load();
    h._npcCastStarts.push({ caster: 'a hollow guard', atMs: T0 });
    feed(h, stamp(T0 + 60000) + "a hollow guard's skin hardens like stone.", 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual([]);
  });

  it('(b) a shared text records nothing unless the mob\'s own spell list picks one', () => {
    const h = load();
    h._npcCastStarts.push({ caster: 'a hollow guard', atMs: T0 });
    feed(h, stamp(T0 + 3000) + 'a hollow guard shimmers with twin light.', 'Aldenmar');
    expect(names(h, 'a hollow guard'), 'two spells fit and nothing separates them').toEqual([]);
    h.__setMob({ spells: [{ name: 'Twin Hide Greater' }] });
    feed(h, stamp(T0 + 3000) + 'a hollow guard shimmers with twin light.', 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual(['Twin Hide Greater']);
  });

  it('(a) an instant proc leaves no row: nothing to count down (#154 stays)', () => {
    const h = load();
    feed(h, stamp(T0) + 'a hollow guard is seared by flame.', 'Aldenmar');
    expect(names(h, 'a hollow guard')).toEqual([]);
  });

  it('the watch loop records it locally and never queues it for upload', () => {
    const code = stripJs(sliceBlock(src, 'const nbEvt = parseNpcSelfBuffLanding(line);', 'recordTargetBuffLanding(nbEvt); }'));
    expect(code).toContain('recordTargetBuffLanding(nbEvt)');
    expect(code).not.toMatch(/buffCastBuffer|enqueueUpload/);
  });
});
