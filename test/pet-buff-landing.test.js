// #117 — pet-buff attribution on the Pet tracker. SOURCE-SLICE fidelity tier.
//
// Reproduces the field bug: Canopy (druid) casts Girdle of Karana on her
// SUMMONED pet Kabn; the in-game pet window + Zeal show the buff, but the Mimic
// Pet tracker shows Kabn's HP and NO buffs.
//
// We slice the REAL agent functions on the pet-buff attribution path out of the
// shipped source (packages/wolfpack-logsync/index.js) and rehydrate them into a
// single eval scope with test-local module state, so edits to the shipped
// pipeline are exercised here. The Pet tracker's data source is petBuffsForOwner
// (see the `petHealth` state block). SELF-CONTAINED: the `beta` branch has no
// test/_source-slice.js, so the slice helpers are inlined here — this file runs
// standalone (`npx vitest run test/pet-buff-landing.test.js`) and graduates to
// the main suite when the agent fix does.
//
// Catalog fact (eqemu_spells id 1557): Girdle of Karana is targettype 5
// (single-target — same class as Aegolism/Clarity/Strength), good_effect 1,
// cast_on_other "looks stronger.", buffduration 720, buffdurationformula 3.
// It is NOT in the agent's _TRACKED_BUFF_KEYWORDS list, so parseBuffLanding
// can never index its landing message — the ONLY log path that can attribute
// it is resolveSelfCastLanding, which (pre-fix) rejected the land unless the
// caster's live Zeal target equaled the pet at cast time.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_INDEX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'packages', 'wolfpack-logsync', 'index.js',
);
// Slice from `start` through the FIRST `end` at/after it (inclusive) — the same
// contract as the main-branch test/_source-slice.js helper.
function sliceBlock(src, start, end) {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`source-slice: start not found: ${JSON.stringify(start)}`);
  const e = src.indexOf(end, s);
  if (e < 0) throw new Error(`source-slice: end not found: ${JSON.stringify(end)}`);
  return src.slice(s, e + end.length);
}

const src = fs.readFileSync(AGENT_INDEX, 'utf8');
const fn = (start, end) => sliceBlock(src, start, end);

// ── Slice the real functions on the attribution path ─────────────────────────
const BLOCKS = [
  fn('function _petOwnerByName(petLower) {',
     '=== petLower) return String(ch).toLowerCase();\n  }\n  return null;\n}'),
  fn('function _assumedCasterLevel() {',
     '  return (Date.now() >= _POP_UNLOCK_MS) ? 65 : 60;\n}'),
  fn('function _durTicksForLevel(formula, capTicks, level) {',
     '  if (cap > 0 && t > cap) t = cap;        // never exceed the spell\'s own cap\n  return t;\n}'),
  fn('function _resistLadderEffect(mp, spellName) {',
     '  return inAnyLadder ? { drop } : null;\n}'),
  fn('function _categorizeBuff(name) {',
     '  for (const cat of _BUFF_CAT_ORDER) {\n    for (const k of _BUFF_KEYWORDS[cat]) if (n.includes(k)) return cat;\n  }\n  return null;\n}'),
  'function _isHotBuff(name) { return _categorizeBuff(name) === \'regen\'; }',
  fn('function _spellGood(name) {',
     '  return (e && e.good != null) ? (Number(e.good) ? 1 : 0) : null;\n}'),
  fn('function recordPetBuffLanding(bcEvt) {',
     '    landed_at: bcEvt.cast_at ? Date.parse(bcEvt.cast_at) : Date.now(),\n  });\n  _savePetStateSoon();\n}'),
  fn('function petBuffsForOwner(ownerLower) {',
     '  return Array.from(byName.values());\n}'),
  fn('function _zealTargetForChar(charLower) {',
     '    return (st && st.target_name) ? String(st.target_name) : null;\n  }\n  return null;\n}'),
  fn('function noteSelfCast(line, character) {',
     '  return { name: m[1].trim(), atMs };\n}'),
  fn('function resolveSelfCastLanding(line, observer) {',
     '      _selfCast:   true,\n    };\n  }\n  return null;\n}'),
  fn('function _isTrackedBuffName(name) {',
     '  return _TRACKED_BUFF_KEYWORDS.some(k => n.includes(k));\n}'),
  fn('function _isTimedDurationFormula(f) {',
     '  return Number.isFinite(n) && n > 0 && n < 50;\n}'),
  fn('function _looksLikePlayerName(s) {',
     '  return /^[A-Z][a-zA-Z]{2,19}$/.test(s) && s !== \'You\' && s !== \'Your\';\n}'),
  fn('function _rebuildBuffMatchers() {',
     'unattributable shared texts dropped)`);\n}'),
  fn('function parseBuffLanding(line, observer) {',
     '      observer:    observer || null,\n    };\n  }\n  return null;\n}'),
  'const TS_RX = /^\\[(\\w+ \\w+ \\d+ \\d+:\\d+:\\d+ \\d+)\\]/;',
  fn('function parseEqTimestamp(line) {',
     '  return isNaN(d.getTime()) ? null : d;\n}'),
];

// Real data arrays the sliced helpers close over.
const ARRAYS = [
  fn('const _BUFF_KEYWORDS = {', '\'shield of barbs\'],\n};'),
  fn('const _BUFF_CAT_ORDER = [', '\'ds\'];'),
  fn('const _RESIST_LADDERS = [', 'flight of eagle\'],   // runSpeed\n];'),
  fn('const _TRACKED_BUFF_KEYWORDS = [', '\'arch shielding\',\n];'),
];

// Test-local module state + no-op stubs the sliced code references.
const PRELUDE = `
  let _pendingCharmSpell = null;
  const _POP_UNLOCK_MS = Date.parse('2026-10-01T00:00:00Z');
  const SELF_CAST_WINDOW_MS = 12000;
  const PENDING_CHARM_WINDOW_MS = 12000;
  const FELL_OFF_LINGER_MS = 5 * 60 * 1000;
  const PET_HEALTH_TTL_MS = 30 * 60 * 1000;
  const _CAST_BEGIN_RX = /\\]\\s+You begin (?:casting|singing)\\s+(.+?)\\.\\s*$/i;
  const CHARM_SPELLS = new Map();
  const buffCastBuffer = [];
  const _charmTickTracker = new Map();
  const whoData = new Map();
  const _recentSelfCast = new Map();
  const _zealState = {};
  const _spellByNameLower = new Map();
  const _petBuffLandings = new Map();
  const _petHealthByOwner = new Map();
  const _buffLandingsByTarget = new Map();
  let _buffLandingBySuffix = new Map();
  let _debuffLandingBySuffix = new Map();
  function _savePetStateSoon() {}
  function _noteDiCast() {}
  function _charmDurationSec(_n, d) { return d; }
`;

const EXPORTS = [
  'noteSelfCast', 'resolveSelfCastLanding', 'parseBuffLanding',
  'recordPetBuffLanding', 'petBuffsForOwner', '_rebuildBuffMatchers',
  '_petOwnerByName', '_isTrackedBuffName',
  '_zealState', '_spellByNameLower', '_petBuffLandings', '_petHealthByOwner',
  '_recentSelfCast',
];

function buildAgent() {
  const block = PRELUDE + '\n' + ARRAYS.join('\n') + '\n' + BLOCKS.join('\n\n')
    + `\nreturn { ${EXPORTS.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(block)();
}

// eqemu_spells catalog rows the agent would have fetched (bot shape: id/name/
// you/other/dur/durf/good). Girdle of Karana verbatim from the live catalog.
const CATALOG = [
  { id: 1557, name: 'Girdle of Karana', you: 'You feel the strength of Karana infuse you.', other: 'looks stronger.', dur: 720, durf: 3, good: 1 },
  { id: 159,  name: 'Strength',         you: 'You feel strong.', other: 'looks strong.', dur: 630, durf: 3, good: 1 },
  { id: 278,  name: 'Spirit of Wolf',   you: 'You feel the spirit of wolf enter you.', other: 'is surrounded by a brief lupine aura.', dur: 360, durf: 3, good: 1 },
];

// EQ-format timestamp for a wall-clock moment, so the sliced expiry math in
// petBuffsForOwner (which reads the real Date.now()) sees a FRESH landing.
const _DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _p2 = (n) => String(n).padStart(2, '0');
function eqTs(offsetMs) {
  const d = new Date(Date.now() + offsetMs);
  return `[${_DAYS[d.getDay()]} ${_MONS[d.getMonth()]} ${_p2(d.getDate())} ${_p2(d.getHours())}:${_p2(d.getMinutes())}:${_p2(d.getSeconds())} ${d.getFullYear()}]`;
}

let A;
function seed({ castTarget }) {
  A = buildAgent();
  for (const e of CATALOG) A._spellByNameLower.set(e.name.toLowerCase(), e);
  A._rebuildBuffMatchers();
  A._zealState['Canopy'] = {
    target_name: castTarget,
    gauges: [{ slot: 16, text: 'Kabn', hp_pct: 100 }],
    updatedAt: Date.now(),
  };
}
function feedCastThenLand(spell, landBody) {
  A.noteSelfCast(`${eqTs(-3000)} You begin casting ${spell}.`, 'Canopy');
  const landLine = `${eqTs(-1000)} ${landBody}`;
  const bcEvt = A.resolveSelfCastLanding(landLine, 'Canopy') || A.parseBuffLanding(landLine, 'Canopy');
  if (bcEvt) A.recordPetBuffLanding(bcEvt);
  return bcEvt;
}

describe('#117 pet-buff attribution (source-sliced from agent)', () => {
  it('sanity: sliced the real functions + Girdle is NOT a tracked buff', () => {
    A = buildAgent();
    expect(typeof A.petBuffsForOwner).toBe('function');
    expect(typeof A.resolveSelfCastLanding).toBe('function');
    // The load-bearing catalog fact: Girdle of Karana matches no tracked-buff
    // keyword, so parseBuffLanding can never index "looks stronger.".
    expect(A._isTrackedBuffName('Girdle of Karana')).toBe(false);
    expect(A._isTrackedBuffName('Aegolism')).toBe(true);
  });

  it('_petOwnerByName resolves the summoned pet Kabn → canopy from Zeal slot 16', () => {
    seed({ castTarget: 'Kabn' });
    expect(A._petOwnerByName('kabn')).toBe('canopy');
  });

  // The WORKING path: buff cast while the pet is the current Zeal target.
  it('shows the pet buff when the pet was targeted at cast time', () => {
    seed({ castTarget: 'Kabn' });
    feedCastThenLand('Girdle of Karana', 'Kabn looks stronger.');
    const buffs = A.petBuffsForOwner('canopy');
    expect(buffs.map(b => b.name)).toContain('Girdle of Karana');
  });

  // THE BUG (fail-before) / THE FIX (pass-after): the buff is cast without the
  // pet as the live Zeal target (druid buffs herself/keeps the mob targeted, or
  // the target changed between the ~2s cast and the land). resolveSelfCastLanding's
  // rc.target guard used to reject the land, and Girdle is untracked so
  // parseBuffLanding is a dead end → the Pet tracker store stayed EMPTY even
  // though "Kabn looks stronger." is right there in the log and Kabn is provably
  // our pet. The fix attributes it to our pet regardless of the stale target.
  it('FIX: attributes the buff to our pet even when it was not the live target at cast', () => {
    seed({ castTarget: 'Canopy' });          // cast while targeting self (or the mob)
    feedCastThenLand('Girdle of Karana', 'Kabn looks stronger.');
    const buffs = A.petBuffsForOwner('canopy');
    expect(buffs.map(b => b.name)).toContain('Girdle of Karana');
  });

  // Guard-rail: the target-mismatch relaxation must ONLY fire for names we can
  // prove are our pet. A same-message buff landing on a bystander player we did
  // NOT cast on must still be rejected (no phantom pet buff).
  it('does NOT attribute a same-message landing on a non-pet bystander', () => {
    seed({ castTarget: 'Canopy' });
    feedCastThenLand('Spirit of Wolf', 'Randomguy is surrounded by a brief lupine aura.');
    const buffs = A.petBuffsForOwner('canopy');
    expect(buffs.map(b => b.name)).not.toContain('Spirit of Wolf');
  });
});
