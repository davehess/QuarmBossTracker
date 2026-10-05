// test/me-hud-timers.test.js — the HUD's timers and target read-outs.
//
// The guild lead, 2026-09-24, on the Me overlay's HUD: "Nillipuss is able to
// provide server tick counters and melee delay timers, and I would like to see
// those as well" · "Melee cooldowns and discipline cooldowns need to be in
// here" · the target "should have their target's health as well. If it's
// slowed, does it enrage? If it enrages make it a red outline" · "Monks,
// rogues, and warriors have no mana so don't expose that for them."
//
// Runs the agent's REAL functions over fake Zeal state and real log-line
// shapes. Reuse numbers are the Quarm server's (EQMacEmu common/features.h,
// zone/effects.cpp). Names are invented.
//
// Run: npx vitest run test/me-hud-timers.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const meBlock = sliceBlock(agent, '// ── Me overlay (the guild lead, 2026-09-24)', '\nfunction _serializeTankState() {')
  .replace(/\nfunction _serializeTankState\(\) \{$/, '');
const parseTs = agent.match(/const TS_RX = [^\n]+/)[0] + '\n'
  + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');
const failRx = agent.match(/const _CAST_FAIL_RX = [^\n]+/)[0];
const noManaRx = agent.match(/const _NO_MANA_CLASSES = [^\n]+/)[0];
const pipeCandidate = sliceBlock(agent, 'function _pipeCandidateOf(st, key) {', '\n}');
const zealLevel = sliceBlock(agent, 'function _zealLevelFor(name) {', '\n}');

// Your own casts and what they land as — the REAL chain the tail runs (noteSelfCast, then
// resolveSelfCastLanding, then _meNoteMyLanding), and the two helpers the per-mob counters key by.
const castChain = [
  agent.match(/const _CAST_BEGIN_RX = [^\n]+/)[0],
  agent.match(/const _recentSelfCast = new Map\(\);[^\n]*/)[0],
  agent.match(/const SELF_CAST_WINDOW_MS = [^\n]+/)[0],
  sliceBlock(agent, 'function _normMobName(v) {', '\n}'),
  sliceBlock(agent, 'function _provableTargetId(observer, targetName) {', '\n}'),
  sliceBlock(agent, 'function _zealTargetForChar(charLower) {', '\n}'),
  sliceBlock(agent, 'function noteSelfCast(line, character) {', '\n}'),
  sliceBlock(agent, 'function resolveSelfCastLanding(line, observer) {', '\n}'),
].join('\n');

const dsSlack = agent.match(/const DS_UNLISTED_SLACK = [^\n]+/)[0];
const slainRx = agent.match(/const _SLAIN_BY_RX {2}= [^\n]+/)[0] + '\n' + agent.match(/const _SLAIN_YOU_RX = [^\n]+/)[0];

const EXPORTS = ['_serializeMeState', '_meNoteRawLine', '_meTick', '_meSwingState', '_meHands', '_meSwings',
  '_meCooldowns', '_meDisc', '_meDiscReuseSecs', '_meTargetExtras', '_discReadyAt', '_mobInfoByName', '_zealState',
  '_meNoteHit', '_meMobTallies', '_npcHtFor', '_meNoteCastFailed', '_tickEnrageWarn', '_meNoteMobDeath', '_dsKindOf', '_meClickies', '_noteClickyUse',
  '_xpNoteRawLine', '_xpPending', '_xpFlush',
  'noteSelfCast', 'resolveSelfCastLanding', '_meNoteMyLanding', '_provableTargetId'];

function load({ zeal = {}, victim = null, dsKnown = 0, player = null, spells = [] } = {}) {
  const pre = `
    const _spellByNameLower = new Map(${JSON.stringify(spells.map(e => [e.name.toLowerCase(), e]))});
    function _petOwnerByName() { return null; }
    ${castChain}
    const _zealState = ${JSON.stringify(zeal)};
    const whoData = new Map(Object.entries(globalThis.__who || {}));
    const _zeal = { lastSamples: globalThis.__zealSamples || {} };
    ${zealLevel}
    const _raidClassByName = new Map();
    const CHARM_SPELLS = new Map();
    const stats = { currentEncounterThreat: null, characterInventories: globalThis.__invs || {} };
    const _itemClickyByNameLower = globalThis.__clk || new Map();
    function _quarmyLocalItems() { return globalThis.__quarmy || null; }
    const _blindState = {};
    function normalizeClass(s) { return s ? String(s).trim() : s; }
    ${failRx}
    ${parseTs}
    ${noManaRx}
    ${pipeCandidate}
    const _discReadyAt = new Map();
    const _mobInfoByName = new Map();
    const MOB_INFO_TTL_MS = 60000;
    function _mobInfoCacheKey(n, z) { return String(n).toLowerCase() + '|' + (z == null ? '' : z); }
    function fetchMobInfo() {}
    function _victimForMob() { return ${JSON.stringify(victim)}; }
    function _bestSlowForTarget() { return null; }
    function _resolveHpValuesForName() { return null; }
    ${dsSlack}
    ${slainRx}
    function _knownDsPerHitFor(n, out) {
      if (out && globalThis.__dsWornKind) out.kind = globalThis.__dsWornKind;
      if (out && globalThis.__dsWornOff) { out.off = globalThis.__dsWornOff; return 0; }
      return ${Number(dsKnown) || 0};
    }
    ${sliceBlock(agent, 'function _dsKindOf(text) {', '\n}')}
    function _targetPlayerInfo() { return ${JSON.stringify(player)}; }
    function _currentTargetState() { return globalThis.__enrageTgt || null; }
    function _pushOverlay(o) { (globalThis.__enragePushed = globalThis.__enragePushed || []).push(o); }
    function _isEnrageBoss() { return false; }
    const RAMPAGE_FRESH_MS = 8000;
    function _currentRampageForDisplay() { return globalThis.__ramp || null; }
    function _resolveHpForName(n) { const m = globalThis.__hpByName || {}; return n in m ? m[n] : null; }
    const _lastRaidPipe = globalThis.__raidPipe || null;
    function _zoneName(z) { return Number(z) === 206 ? 'Plane of Innovation' : null; }
    const AGENT_VERSION = 'test';
    function shouldUploadForCharacter() { return true; }
    function enqueueUpload(kind, payload) { (globalThis.__uploads = globalThis.__uploads || []).push({ kind, payload }); return 1; }
    // A fake disk shared across load() calls — a second load() is an agent
    // restart reading what the first one saved.
    const __dirname = '/agent';
    const path = { join: (...a) => a.join('/') };
    const fs = {
      readFileSync: (f) => { const s = globalThis.__hudDisk; if (!s || !(f in s)) throw new Error('ENOENT'); return s[f]; },
      writeFileSync: (f, v) => { (globalThis.__hudDisk = globalThis.__hudDisk || {})[f] = v; },
    };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(pre + meBlock + '\nreturn { ' + EXPORTS.join(', ') + ' };')();
}

// A controllable clock: the swing timer is built from ARRIVAL times.
let clock = 0;
const realNow = Date.now;
beforeEach(() => { clock = Date.parse('2026-09-24T20:00:00Z'); Date.now = () => clock; });
afterEach(() => { Date.now = realNow; });
const ts = (ms) => '[' + new Date(ms).toString().slice(0, 24) + '] ';
const say = (h, who, msg) => h._meNoteRawLine(ts(clock) + msg, who);

describe('server tick — Zeal gauge 24', () => {
  const st = (pct, text, age = 0) => ({ gauges: [{ slot: 24, hp_pct: pct, text }], updatedAt: clock - age });

  it('reads the time left from the gauge (value is per-mille of 6 s)', () => {
    const h = load();
    expect(h._meTick(st(50, '4'), clock).ms_left).toBe(3000);
    expect(h._meTick(st(50, '4'), clock).source).toBe('zeal');
  });

  it('follows Zeal\'s reverse option: the text decides the direction', () => {
    const h = load();
    // 20% forward = 1.2 s ("2"); reversed = 4.8 s ("5").
    expect(h._meTick(st(20, '2'), clock).ms_left).toBe(1200);
    expect(h._meTick(st(20, '5'), clock).ms_left).toBe(4800);
  });

  it('ages the reading to "now", wrapping into the next tick', () => {
    const h = load();
    expect(h._meTick(st(50, '4', 1000), clock).ms_left).toBe(2000);
    expect(h._meTick(st(10, '1', 1000), clock).ms_left).toBe(5600);   // 0.6 s left, 1 s ago
  });

  it('no gauge → null (the HUD draws nothing)', () => {
    expect(load()._meTick({ gauges: [] }, clock)).toBeNull();
  });
});

describe('swing timer — measured from your own rounds', () => {
  function swing(h, who, verbs, gapMs) {
    for (const v of verbs) say(h, who, 'You ' + v + ' a gnoll for 20 points of damage.');
    clock += gapMs;
  }

  it('learns the delay from round-to-round', () => {
    const h = load();
    for (let i = 0; i < 7; i++) swing(h, 'Aldenmar', ['punch', 'punch'], 2600);
    const s = h._meSwingState('aldenmar', { autoattack: true, gauges: [] }, clock - 1600);
    expect(s.period_ms).toBeGreaterThanOrEqual(2600 - 150);
    expect(s.period_ms).toBeLessThanOrEqual(2600 + 150);
    expect(s.source).toBe('log');
    expect(s.est).toBe(true);
  });

  // "swing timer is completely wrong" (the guild lead, 2026-09-24, a monk on a
  // 3.0-delay two-hander, hasted to ~1.8 s). The real case: each round is
  // stamped to the SECOND in the log, and read on a 500 ms poll — so its
  // arrival is up to half a second late and its stamp up to a second early.
  // Many rounds together still pin the swing: the next one is predicted to
  // within a tenth of a second, where the arrival time alone was ~0.5 s off.
  it('predicts the next swing from log seconds + arrival, to within 0.12 s', () => {
    const eq = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
      return '[' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
        + ' ' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + d.getFullYear() + '] '; };
    // A delay of exactly 3.0 s lands at the same point of every second and
    // every poll, so rounds cannot narrow each other — there the estimate is
    // only as good as one round, and it says so (spread_ms).
    for (const [period, phase, tol] of [[1760, 330, 120], [1760, 910, 120], [2210, 470, 120], [1830, 700, 120], [3000, 60, 260]]) {
      const h = load();
      const start = clock + phase;
      const poll = (T) => Math.ceil((T - 137) / 500) * 500 + 137;   // the agent reads the log every 500 ms
      let T = start;
      for (let i = 0; i < 12; i++) {
        clock = poll(T);
        h._meNoteRawLine(eq(T) + 'You crush a gnoll for 88 points of damage.', 'Aldenmar');
        h._meNoteRawLine(eq(T) + 'You crush a gnoll for 45 points of damage.', 'Aldenmar');
        T += period;
      }
      const now = T - period + period * 0.4;                        // 40% of the way to the next swing
      const s = h._meSwingState('aldenmar', { autoattack: true, gauges: [] }, now);
      expect(Math.abs(s.period_ms - period), 'period ' + period).toBeLessThanOrEqual(30);
      expect(Math.abs(s.ms_left - period * 0.6), 'phase ' + period + '/' + phase).toBeLessThanOrEqual(tol);
      if (tol > 120) expect(s.spread_ms).toBeGreaterThanOrEqual(200);
    }
  });

  it('a miss is a swing too', () => {
    const h = load();
    for (let i = 0; i < 6; i++) { say(h, 'Aldenmar', 'You try to slash a gnoll, but miss!'); clock += 3000; }
    expect(h._meSwingState('aldenmar', { autoattack: true, gauges: [] }, clock).period_ms).toBe(3000);
  });

  it('is idle when autoattack is off, and null before it has learned anything', () => {
    const h = load();
    expect(h._meSwingState('aldenmar', { autoattack: true, gauges: [] }, clock)).toBeNull();
    for (let i = 0; i < 7; i++) swing(h, 'Aldenmar', ['crush'], 2400);
    const s = h._meSwingState('aldenmar', { autoattack: false, gauges: [] }, clock);
    expect(s.idle).toBe(true);
    expect(s.ms_left).toBeNull();
  });

  it('a spell\'s "non-melee" line is not a swing', () => {
    const h = load();
    for (let i = 0; i < 7; i++) { say(h, 'Aldenmar', 'You hit a gnoll for 300 points of non-melee damage.'); clock += 2000; }
    expect(h._meSwingState('aldenmar', { autoattack: true, gauges: [] }, clock)).toBeNull();
  });

  it('names the hands when they swing with different verbs', () => {
    const h = load();
    for (let i = 0; i < 5; i++) swing(h, 'Brackwyn', ['slash', 'slash', 'pierce'], 2800);
    expect(h._meHands(h._meSwings.get('brackwyn'))).toEqual({ mh: 'slash', oh: 'pierce' });
  });

  it('claims no hand when both hands share a verb (a monk\'s punch and punch)', () => {
    const h = load();
    for (let i = 0; i < 5; i++) swing(h, 'Aldenmar', ['punch', 'punch'], 2600);
    expect(h._meHands(h._meSwings.get('aldenmar'))).toBeNull();
  });

  it('prefers Zeal\'s attack gauge (34) whenever a build sends it', () => {
    const h = load();
    const s = h._meSwingState('corvale', { autoattack: true, gauges: [{ slot: 34, hp_pct: 40, text: '1' }] }, clock);
    expect(s.source).toBe('zeal');
    expect(s.frac_left).toBeCloseTo(0.4);
    // …and a missing 34 afterwards means "ready" (Mimic drops a 0-value gauge).
    expect(h._meSwingState('corvale', { autoattack: true, gauges: [] }, clock).frac_left).toBe(0);
  });
});

describe('cooldowns — combat abilities, Mend, Taunt', () => {
  it('a flying kick starts the shared ability timer at the unhasted ceiling (8 s − 1)', () => {
    const h = load();
    say(h, 'Aldenmar', 'You flying kick a gnoll for 120 points of damage.');
    const cd = h._meCooldowns('aldenmar', clock).find(c => c.key === 'ability');
    expect(cd.label).toBe('Flying Kick');
    expect(cd.total_ms).toBe(7000);
    expect(cd.ms_left).toBe(7000);
    expect(cd.est).toBe(true);
  });

  it('tightens to the quickest repeats you actually managed (haste), never below the 100%-haste floor', () => {
    const h = load();
    for (let i = 0; i < 5; i++) { say(h, 'Rethlan', 'You kick a gnoll for 40 points of damage.'); clock += 5000; }
    clock -= 5000;
    expect(h._meCooldowns('rethlan', clock).find(c => c.key === 'ability').total_ms).toBe(5000);
    const h2 = load();
    for (let i = 0; i < 5; i++) { say(h2, 'Rethlan', 'You try to kick a gnoll, but miss!'); clock += 1500; }
    clock -= 1500;
    // 8 s base at 100% haste: 8 × 100 / 200 − 1 = 3 s.
    expect(h2._meCooldowns('rethlan', clock).find(c => c.key === 'ability').total_ms).toBe(3000);
  });

  it('Mend (every outcome) and Taunt have timers of their own', () => {
    const h = load();
    say(h, 'Aldenmar', 'You have failed to mend your wounds.');
    say(h, 'Aldenmar', 'You taunt a gnoll to ignore others and attack you!');
    const cds = h._meCooldowns('aldenmar', clock);
    expect(cds.find(c => c.key === 'mend').total_ms).toBe(289_000);
    expect(cds.find(c => c.key === 'taunt').total_ms).toBe(5_000);
  });
});

describe('disciplines', () => {
  it('reuse = base − 54 s per level above the unlock level, clamped 3:54–72:00', () => {
    const h = load();
    expect(h._meDiscReuseSecs(1800, 57, 60)).toBe(1800 - 3 * 54);   // Hundred Fists at 60
    expect(h._meDiscReuseSecs(540, 52, 60)).toBe(234);              // Thunderkick bottoms out
    expect(h._meDiscReuseSecs(1800, 57, null)).toBe(1800);          // level unknown → the ceiling
  });

  it('the activation line starts it for that disc and level', () => {
    const h = load({ zeal: { Aldenmar: { charInfo: [{ id: 2, value: '60' }, { id: 3, value: 'Monk' }], updatedAt: clock } } });
    say(h, 'Aldenmar', 'Your fists begin to blur.');
    const d = h._meDisc('aldenmar', clock);
    expect(d.label).toBe('Hundred Fists');
    expect(d.total_ms).toBe((1800 - 3 * 54) * 1000);
    expect(d.est).toBe(true);
  });

  it('the server\'s refusal line is exact and wins', () => {
    const h = load();
    say(h, 'Aldenmar', 'Your fists begin to blur.');
    h._discReadyAt.set('aldenmar', { at: clock + 600_000, name: 'Aldenmar' });
    const d = h._meDisc('aldenmar', clock);
    expect(d.ms_left).toBe(600_000);
    expect(d.est).toBe(false);
    expect(d.label).toBe('Hundred Fists');
  });
});

describe('target read-outs', () => {
  const st = (extra = {}) => ({ target_name: 'a gnoll warlord', zone: 12, gauges: [], ...extra });

  it('enrage and unslowable come from the mob-info row; ENRAGED from the server\'s own lines', () => {
    const h = load();
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { specials: ['Enrage', 'Unslowable'] } });
    let t = h._meTargetExtras(st(), 'Aldenmar', clock);
    expect(t.enrage).toBe(true);
    expect(t.unslowable).toBe(true);
    expect(t.enraged).toBe(false);
    say(h, 'Aldenmar', 'a gnoll warlord has become ENRAGED.');
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).enraged).toBe(true);
    say(h, 'Aldenmar', 'a gnoll warlord is no longer enraged.');
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).enraged).toBe(false);
    // …and an end line that never comes: 10 s by default, gone after 12.
    say(h, 'Aldenmar', 'a gnoll warlord has become ENRAGED.');
    clock += 12_001;
    t = h._meTargetExtras(st(), 'Aldenmar', clock);
    expect(t.enraged).toBe(false);
  });

  // The guild lead, 2026-10-02: "Enrage timer and TTS should go off at 10%, not 8%, because it's
  // going off too late and I'm getting hit. And then when it ends, it should no longer be red
  // underneath the name."
  it('says "Enrage soon" once as the target crosses 12%, re-arms for a fresh mob, and an ended enrage clears', () => {
    const h = load();
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { specials: ['Enrage'] } });
    globalThis.__enragePushed = [];
    const at = (hp, id = 7) => { globalThis.__enrageTgt = st({ target_hp_pct: hp, target_id: id }); h._tickEnrageWarn(clock); };
    at(40); at(13);
    expect(globalThis.__enragePushed).toHaveLength(0);              // 13% is not yet
    at(12); at(9); at(4);
    expect(globalThis.__enragePushed).toHaveLength(1);              // once, at 12%
    expect(globalThis.__enragePushed[0]).toMatchObject({ tts: 'Enrage soon', scope: 'enrage', color: 'red' });
    at(9, 8);                                                       // another of the same name, already low
    expect(globalThis.__enragePushed).toHaveLength(2);
    at(100, 7); at(12, 7);                                          // a respawn under the old id re-arms
    expect(globalThis.__enragePushed).toHaveLength(3);
    // A mob that cannot enrage says nothing.
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { specials: [] } });
    at(100, 9); at(5, 9);
    expect(globalThis.__enragePushed).toHaveLength(3);

    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { specials: ['Enrage'] } });
    say(h, 'Aldenmar', 'a gnoll warlord has become ENRAGED.');
    let t = h._meTargetExtras(st(), 'Aldenmar', clock);
    expect(t).toMatchObject({ enraged: true, enrage_ended: false, enrage_pct: 12 });
    say(h, 'Aldenmar', 'a gnoll warlord is no longer enraged.');
    t = h._meTargetExtras(st(), 'Aldenmar', clock);
    expect(t).toMatchObject({ enraged: false, enrage_ended: true });   // the red goes
    // Its death clears it, so the next one of that name starts clean.
    h._meNoteMobDeath('a gnoll warlord', clock);
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).enrage_ended).toBe(false);
    globalThis.__enrageTgt = null;
  });

  it('an uncached mob says "unknown" (null), not "cannot enrage"', () => {
    expect(load()._meTargetExtras(st(), 'Aldenmar', clock).enrage).toBeNull();
    expect(load()._meTargetExtras(st(), 'Aldenmar', clock).summon).toBeNull();
  });

  // The guild lead, round five: "if a mob summons we should get a marker next to the 97%".
  it('a summoner is flagged from the mob-info row, and a non-summoner is not', () => {
    const h = load();
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { specials: ['Summon', 'Enrage'] } });
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).summon).toBe(true);
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { specials: ['Enrage'] } });
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).summon).toBe(false);
  });

  it('the target\'s target, with their HP from the group gauges', () => {
    const h = load({ victim: 'Brackwyn' });
    const t = h._meTargetExtras(st({ gauges: [{ slot: 11, hp_pct: 40, text: 'Brackwyn' }] }), 'Aldenmar', clock);
    expect(t.tot).toEqual({ name: 'Brackwyn', hp_pct: 40, source: 'log' });
  });

  it('Zeal\'s own target-of-target wins over the log', () => {
    const h = load({ victim: 'Brackwyn' });
    const t = h._meTargetExtras(st({ target_of_target: { id: 7, name: 'Aldenmar' }, self_hp_pct: 88 }), 'Aldenmar', clock);
    expect(t.tot).toEqual({ name: 'Aldenmar', hp_pct: 88, source: 'zeal' });
  });
});

// Round two, the guild lead: "I would need feign death and Mend on here as a monk /
// warriors would use taunt and kick / paladins and shadowknights would have
// their lay on hands and harmtouch" — and, on a successful feign printing
// nothing: "I can add in /pipeoutput for FD too".
describe('class cooldowns, Feign Death, Lay on Hands / Harm Touch, /pipe', () => {
  const zeal = (cls, extra = {}) => ({ Aldenmar: { charInfo: [{ id: 3, value: cls }], gauges: [], updatedAt: clock, ...extra } });
  const cd = (h, key) => h._serializeMeState().cooldowns.find(c => c.key === key);

  it('each class always sees its own set — unknown (seen: false) until first used', () => {
    const keys = (cls) => load({ zeal: zeal(cls) })._serializeMeState().cooldowns.map(c => [c.key, c.seen]);
    expect(keys('Monk')).toEqual([['ability', false], ['mend', false], ['fd', false], ['disc', false]]);
    expect(keys('Warrior')).toEqual([['ability', false], ['taunt', false], ['disc', false]]);
    expect(keys('Paladin')).toEqual([['loh', false], ['disc', false]]);
    expect(keys('Shadow Knight')).toEqual([['ht', false], ['disc', false]]);
    expect(keys('Rogue')).toEqual([['disc', false]]);
    expect(keys('Cleric')).toEqual([]);
  });

  it('keeps the class order once used, and adds what else was used after it', () => {
    const h = load({ zeal: zeal('Monk') });
    say(h, 'Aldenmar', 'You mend your wounds and heal some damage.');
    say(h, 'Aldenmar', 'You taunt a gnoll to ignore others and attack you!');
    expect(h._serializeMeState().cooldowns.map(c => c.key)).toEqual(['ability', 'mend', 'fd', 'disc', 'taunt']);
  });

  // The guild lead, 2026-09-24: "I lost my discipline timer".
  it('a discipline stays on the HUD as ready once its timer runs out — it no longer vanishes', () => {
    const h = load({ zeal: monk60() });
    say(h, 'Aldenmar', 'Your fists begin to blur.');   // Hundred Fists: 1800 − 3×54 s at 60
    clock += 2 * 3600_000;
    h._zealState.Aldenmar.updatedAt = clock;          // still logged in two hours later
    const d = cd(h, 'disc');
    expect(d).toMatchObject({ label: 'Hundred Fists', ms_left: 0, seen: true });
  });

  it('long timers survive an agent restart (a Mimic update) — read back from disk', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      globalThis.__hudDisk = {};
      const first = load({ zeal: monk60() });
      say(first, 'Aldenmar', 'Your fists begin to blur.');
      say(first, 'Aldenmar', 'You mend your wounds and heal some damage.');
      vi.advanceTimersByTime(2100);                     // the debounced save
      expect(Object.keys(globalThis.__hudDisk)).toEqual(['/agent/logsync.hud-timers.json']);
      clock += 60_000;
      const second = load({ zeal: monk60() });          // a fresh agent, same disk
      expect(cd(second, 'disc')).toMatchObject({ label: 'Hundred Fists', ms_left: (1800 - 3 * 54) * 1000 - 60_000, seen: true });
      expect(cd(second, 'mend')).toMatchObject({ ms_left: 289_000 - 60_000, seen: true });
    } finally {
      vi.useRealTimers();
      delete globalThis.__hudDisk;
    }
  });

  // The client's button timer: 10 s, cut 10/25/50% by Rapid Feign — and the
  // guild lead's 3/3 monk sees 5 s. Rapid Feign unlocks at 59, so 59+ is 3/3.
  const monk60 = (extra = {}) => ({ Aldenmar: { charInfo: [{ id: 2, value: '60' }, { id: 3, value: 'Monk' }], gauges: [], updatedAt: clock, ...extra } });

  it('a failed feign starts Feign Death: 5 s for a monk of 59+ (Rapid Feign 3/3), marked est', () => {
    const h = load({ zeal: monk60() });
    say(h, 'Aldenmar', 'You have fallen to the ground.');
    const fd = cd(h, 'fd');
    expect(fd.seen).toBe(true);
    expect(fd.total_ms).toBe(5000);
    expect(fd.ms_left).toBe(5000);
    expect(fd.est).toBe(true);
  });

  it('…and the full 10 s below 59, where Rapid Feign cannot be trained (or level unknown)', () => {
    const low = load({ zeal: { Aldenmar: { charInfo: [{ id: 2, value: '58' }, { id: 3, value: 'Monk' }], gauges: [], updatedAt: clock } } });
    say(low, 'Aldenmar', 'You have fallen to the ground.');
    expect(cd(low, 'fd').total_ms).toBe(10_000);
    const unknown = load({ zeal: zeal('Monk') });
    say(unknown, 'Aldenmar', 'You have fallen to the ground.');
    expect(cd(unknown, 'fd').total_ms).toBe(10_000);
  });

  it('`/pipe fd` on the hotkey starts it at the press — Mimic\'s receive time', () => {
    const h = load({ zeal: monk60({ custom_recent: [{ at: clock - 3000, text: 'fd' }] }) });
    expect(cd(h, 'fd').ms_left).toBe(2000);
  });

  it('reads each /pipe line once — an old line still in the ring never drags a newer start back', () => {
    const h = load({ zeal: monk60({ custom_recent: [{ at: clock - 3000, text: 'fd' }] }) });
    expect(cd(h, 'fd').ms_left).toBe(2000);
    clock += 9000;
    say(h, 'Aldenmar', 'You have fallen to the ground.');   // a newer feign
    expect(cd(h, 'fd').ms_left).toBe(5000);
  });

  it('/pipe words for the others too, and unrelated /pipe text is ignored', () => {
    const h = load({ zeal: zeal('Monk', { custom_recent: [
      { at: clock - 1000, text: 'mend' }, { at: clock - 1000, text: 'hello raid' }, { at: clock - 1000, text: 'cd kick' },
    ] }) });
    const s = h._serializeMeState();
    expect(s.cooldowns.find(c => c.key === 'mend').ms_left).toBe(288_000);
    expect(s.cooldowns.find(c => c.key === 'ability').seen).toBe(true);
  });

  it('Lay on Hands is credited to a paladin when it lands on their own target', () => {
    const h = load({ zeal: zeal('Paladin', { target_name: 'Brackwyn' }) });
    say(h, 'Aldenmar', 'Brackwyn feels a healing touch.');
    expect(cd(h, 'loh')).toMatchObject({ seen: true, total_ms: 4320_000, est: true });
  });

  it('…not when it lands on someone else, and never for another class', () => {
    let h = load({ zeal: zeal('Paladin', { target_name: 'Corvale' }) });
    say(h, 'Aldenmar', 'Brackwyn feels a healing touch.');
    expect(cd(h, 'loh').seen).toBe(false);
    h = load({ zeal: zeal('Cleric', { target_name: 'Brackwyn' }) });
    say(h, 'Aldenmar', 'Brackwyn feels a healing touch.');
    expect(cd(h, 'loh')).toBeUndefined();
  });

  it('Harm Touch: the damage line, or the landing on a shadow knight\'s own target', () => {
    let h = load({ zeal: zeal('Shadow Knight') });
    say(h, 'Aldenmar', 'You harm touch a gnoll warlord for 3200 points of damage.');
    expect(cd(h, 'ht').seen).toBe(true);
    h = load({ zeal: zeal('Shadow Knight', { target_name: 'a gnoll warlord' }) });
    say(h, 'Aldenmar', 'a gnoll warlord writhes in the grip of agony.');
    expect(cd(h, 'ht').seen).toBe(true);
  });

  // The guild lead, 2026-10-02: "add Boastful Bellow AA as a timer for Bards that have the AA".
  // Reuse 18 s (Quarm aa_actions, AA 592). Instant, so no "begin casting" line.
  describe('Boastful Bellow', () => {
    it('is no slot for a bard who has not used it — the HUD cannot see AAs owned', () => {
      expect(cd(load({ zeal: zeal('Bard') }), 'bellow')).toBeUndefined();
    });

    it('starts on a landing paired with your own damage on that mob, either order', () => {
      let h = load({ zeal: zeal('Bard') });
      say(h, 'Aldenmar', 'a gnoll warlord is shaken by a loud bellow.');
      expect(cd(h, 'bellow')).toBeUndefined();   // the landing alone: anyone near the mob sees it
      say(h, 'Aldenmar', 'You hit a gnoll warlord for 37 points of non-melee damage.');
      expect(cd(h, 'bellow')).toMatchObject({ label: 'Boastful Bellow', seen: true, ms_left: 18_000, total_ms: 18_000 });
      h = load({ zeal: zeal('Bard') });
      say(h, 'Aldenmar', 'You hit A gnoll warlord for 12 points of non-melee damage.');
      clock += 800;
      say(h, 'Aldenmar', 'A gnoll warlord is shaken by a loud bellow.');
      expect(cd(h, 'bellow').ms_left).toBe(17_200);
    });

    it('another bard\'s bellow on your mob, your damage on a different mob or too late, starts nothing', () => {
      const h = load({ zeal: zeal('Bard') });
      say(h, 'Aldenmar', 'a gnoll warlord is shaken by a loud bellow.');
      say(h, 'Aldenmar', 'You hit a gnoll guard for 30 points of non-melee damage.');
      clock += 2000;
      say(h, 'Aldenmar', 'You hit a gnoll warlord for 30 points of non-melee damage.');
      expect(cd(h, 'bellow')).toBeUndefined();
    });

    it('a resist names it and only you see it — that starts it too', () => {
      const h = load({ zeal: zeal('Bard') });
      say(h, 'Aldenmar', 'Your target resisted the Boastful Bellow spell.');
      expect(cd(h, 'bellow').ms_left).toBe(18_000);
    });

    it('never for another class', () => {
      const h = load({ zeal: zeal('Cleric') });
      say(h, 'Aldenmar', 'a gnoll warlord is shaken by a loud bellow.');
      say(h, 'Aldenmar', 'You hit a gnoll warlord for 37 points of non-melee damage.');
      expect(cd(h, 'bellow')).toBeUndefined();
    });

    it('pressing it early puts the one timer right — no second AA slot', () => {
      const h = load({ zeal: zeal('Bard') });
      say(h, 'Aldenmar', 'Your target resisted the Boastful Bellow spell.');
      clock += 3000;
      say(h, 'Aldenmar', 'You can use the ability Boastful Bellow again in 0 minute(s) 12 seconds.');
      expect(cd(h, 'bellow').ms_left).toBe(12_000);
      expect(h._serializeMeState().cooldowns.filter(c => /bellow/i.test(c.label)).length).toBe(1);
    });
  });
});

// The guild lead, 2026-09-24: "Damage shield hits are also mixed in there - those
// should be separate, and should have a button with current DS amount per hit".
describe('damage shield — its own kind, and its per-hit value', () => {
  // A getter, so the fixture is stamped with the clock the TEST sets.
  const Z = { get zeal() { return { Aldenmar: { charInfo: [{ id: 3, value: 'Monk' }], gauges: [], updatedAt: clock } }; } };
  const iso = (ms) => new Date(ms).toISOString();
  const feedKinds = (h) => h._serializeMeState().combat.feed.map(f => [f.dir, f.kind, f.amount]);

  it('a named shield line ("… by YOUR thorns …") is damage shield', () => {
    const h = load({ zeal: Z.zeal });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'thorns', amount: 38, ds: true });
    expect(feedKinds(h)).toEqual([['out', 'ds', 38]]);
  });

  it('"<mob> was hit by non-melee" right after that mob meleed you, sized like your shield, is damage shield', () => {
    const h = load({ zeal: Z.zeal, dsKnown: 40 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a gnoll', defender: 'You', ability: 'hits', amount: 82 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'non-melee', spellName: 'non-melee', amount: 38 });
    expect(feedKinds(h)).toEqual([['out', 'ds', 38], ['in', 'melee', 82]]);
  });

  it('…but not when that mob had not hit you (a weapon proc lands on YOUR swing)', () => {
    const h = load({ zeal: Z.zeal, dsKnown: 40 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'non-melee', spellName: 'non-melee', amount: 38 });
    expect(feedKinds(h)).toEqual([['out', 'spell', 38]]);
  });

  // In game (2026-09-24), 14-point shield hits sat in the guild lead's own lane: the
  // shield's line can print BEFORE the mob's hit that set it off.
  it('…and when the shield line prints BEFORE the mob\'s hit, that hit re-reads it', () => {
    const h = load({ zeal: Z.zeal, dsKnown: 14 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'non-melee', spellName: 'non-melee', amount: 14 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a gnoll', defender: 'You', ability: 'hits', amount: 57 });
    expect(feedKinds(h)).toEqual([['in', 'melee', 57], ['out', 'ds', 14]]);
  });

  it('…but never without a shield you visibly wear — the fight parser\'s own rule', () => {
    const h = load({ zeal: Z.zeal, dsKnown: 0 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a gnoll', defender: 'You', ability: 'hits', amount: 82 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'non-melee', spellName: 'non-melee', amount: 38 });
    expect(feedKinds(h)[0]).toEqual(['out', 'spell', 38]);
  });

  it('…and not when it is far bigger than the shield you wear', () => {
    const h = load({ zeal: Z.zeal, dsKnown: 40 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a gnoll', defender: 'You', ability: 'hits', amount: 82 });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'non-melee', spellName: 'non-melee', amount: 250 });
    expect(feedKinds(h)[0]).toEqual(['out', 'spell', 250]);
  });

  it('the button reads the shield you wear, else the last one that landed', () => {
    let h = load({ zeal: Z.zeal, dsKnown: 40 });
    expect(h._serializeMeState().combat.ds).toMatchObject({ per_hit: 40, from_buffs: true, hits: 0 });
    h = load({ zeal: Z.zeal });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'thorns', amount: 38, ds: true });
    expect(h._serializeMeState().combat.ds).toMatchObject({ per_hit: 38, from_buffs: false, hits: 1, total: 38 });
    expect(load({ zeal: Z.zeal })._serializeMeState().combat.ds).toBeFalsy();   // no shield, no button
  });

  // The guild lead, 2026-10-02: "wrapped in a thorny green area if it's druid DS or glowing lava
  // if mage ds".
  it('names the shield\'s kind — thorns or fire — from the one you wear, else from the last hit', () => {
    expect(load({ zeal: Z.zeal })._dsKindOf('Shield of Thistles')).toBe('thorns');
    try {
      globalThis.__dsWornKind = 'fire';
      expect(load({ zeal: Z.zeal, dsKnown: 40 })._serializeMeState().combat.ds.kind).toBe('fire');
    } finally { globalThis.__dsWornKind = null; }
    const h = load({ zeal: Z.zeal });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'thorns', amount: 38, ds: true });
    expect(h._serializeMeState().combat.ds.kind).toBe('thorns');
    const plain = load({ zeal: Z.zeal });
    plain._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'feedback', amount: 9, ds: true });
    expect(plain._serializeMeState().combat.ds.kind).toBeNull();
  });

  // The guild lead, 2026-10-02 (Mark of the Plague Lords): a shield-cancelling debuff "should be
  // reflected in the hud" — 0 a hit and no thorns/lava look, even with a shield hit this fight.
  it('a shield-cancelling debuff makes the DS button 0 a hit and names the debuff', () => {
    const off = { name: 'Mark of the Plague Lords', heals: 50, seconds: 150 };
    try {
      globalThis.__dsWornOff = off;
      const bare = load({ zeal: Z.zeal })._serializeMeState().combat.ds;   // no shield hit yet: the button still shows
      expect(bare.off).toEqual(off);
      expect(bare.per_hit).toBe(0);
      const h = load({ zeal: Z.zeal });
      h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'thorns', amount: 38, ds: true });
      const ds = h._serializeMeState().combat.ds;
      expect(ds.per_hit).toBe(0);
      expect(ds.kind).toBeNull();
      expect(ds.off.name).toBe('Mark of the Plague Lords');
    } finally { globalThis.__dsWornOff = null; }
  });

  it('every hit carries its log second, so the HUD can draw one round per line', () => {
    const h = load({ zeal: Z.zeal });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'punch', amount: 45 });
    expect(h._serializeMeState().combat.feed[0].at).toBe(clock);
  });
});

// The guild lead, 2026-10-02: "when there's a rampage, it can be listed next to the main tank on the
// side as an arc. we can show characters that are approaching 20% or less HP on the left side of the
// top of the HUD in the same arc that we would have for the main tank."
describe('side arcs: the rampage target and raiders running low', () => {
  const gauges = [
    { slot: 1, text: 'Aldenmar', hp_pct: 12 },       // you: your own bar, never listed
    { slot: 11, text: 'Brackwyn', hp_pct: 18 },
    { slot: 12, text: 'Corvale', hp_pct: 60 },
    { slot: 13, text: 'Rethlan', hp_pct: 0 },        // dead: nothing to heal
  ];
  const Z = () => ({ Aldenmar: { charInfo: [{ id: 3, value: 'Cleric' }], gauges, updatedAt: clock } });
  afterEach(() => { globalThis.__ramp = null; globalThis.__hpByName = null; globalThis.__raidPipe = null; });

  it('lists raiders at 25% or under, lowest first, from the raid window and your group — not you, not the dead', () => {
    globalThis.__raidPipe = { at: clock - 1000, members: [
      { name: 'Nyssara', hp_pct: 9 }, { name: 'Zarrin', hp_pct: 24 }, { name: 'Brackwyn', hp_pct: 40 }, { name: 'Ordeth', hp_pct: 26 }] };
    const s = load({ zeal: Z() })._serializeMeState();
    // Your group's own bar wins over the raid window's older reading for the same raider.
    expect(s.low_hp).toEqual([{ name: 'Nyssara', hp_pct: 9 }, { name: 'Brackwyn', hp_pct: 18 }, { name: 'Zarrin', hp_pct: 24 }]);
  });

  // The guild lead, 2026-10-05, on a thin arc at the HUD's top left reading "1 6%": the XP / AA / gem
  // gauges carry text and a percent too, and were listed as low raiders.
  it('lists only group members\' health bars, never the XP, AA, cast, tick or spell-gem gauges', () => {
    const others = [4, 5, 7, 8, 9, 10, 16, 17, 23, 24, 25, 26, 33].map((slot) => ({ slot, text: '1', hp_pct: 6 }));
    const z = { Aldenmar: { charInfo: [{ id: 3, value: 'Cleric' }], gauges: gauges.concat(others), updatedAt: clock } };
    expect(load({ zeal: z })._serializeMeState().low_hp).toEqual([{ name: 'Brackwyn', hp_pct: 18 }]);
  });

  it('a stale raid window is ignored, and the list holds three at most', () => {
    globalThis.__raidPipe = { at: clock - 60_000, members: [{ name: 'Nyssara', hp_pct: 9 }] };
    expect(load({ zeal: Z() })._serializeMeState().low_hp.map(m => m.name)).toEqual(['Brackwyn']);
    globalThis.__raidPipe = { at: clock, members: ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ name: 'Raider' + n, hp_pct: 5 + i })) };
    expect(load({ zeal: Z() })._serializeMeState().low_hp).toHaveLength(3);
  });

  it('carries the rampage target with its health, and does not list them twice', () => {
    globalThis.__ramp = { target: 'Brackwyn', attacker: 'a gnoll warlord', at: clock - 2000 };
    globalThis.__hpByName = { brackwyn: 18 };
    const s = load({ zeal: Z() })._serializeMeState();
    expect(s.rampage).toEqual({ name: 'Brackwyn', hp_pct: 18, fresh: true });
    expect(s.low_hp.map(m => m.name)).not.toContain('Brackwyn');
    globalThis.__ramp = null;
    expect(load({ zeal: Z() })._serializeMeState().rampage).toBeNull();
  });
});

// FB-37 option B and the guild lead, 2026-10-02: "observe group composition and xp totals for groups
// that are together during the day and find what compositions work and in what area in what zone,
// with what mobs we're killing" · "Also track when we have an XP potion on".
describe('XP events', () => {
  afterEach(() => { vi.useRealTimers(); globalThis.__uploads = null; globalThis.__who = null; globalThis.__raidPipe = null; globalThis.__zealSamples = null; });
  const zeal = (xp, aa, extra = {}) => ({ Aldenmar: Object.assign({
    charInfo: [{ id: 2, value: '58' }, { id: 3, value: 'Cleric' }, { id: 26, value: xp + '%' }, { id: 27, value: aa + '%' }, { id: 71, value: '3' }],
    gauges: [{ slot: 11, text: 'Brackwyn', hp_pct: 90 }, { slot: 12, text: 'Corvale', hp_pct: 100 }],
    zone: 206, loc: { x: 10, y: -20, z: 3 }, buffs: [{ name: "Maelin's Magical Concoction", seconds: 3000 }],
    updatedAt: clock }, extra) });

  it('records the bars before the line and three seconds after, with the zone, loc, group, mob and potion', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const z = zeal(41.5, 10);
    const h = load({ zeal: z });
    h._xpNoteRawLine(ts(clock) + 'You have slain a clockwork gnome!', 'Aldenmar', clock);
    h._xpNoteRawLine(ts(clock) + 'You gain party experience!!', 'Aldenmar', clock);
    // The pipe moves the bar after the line.
    h._zealState.Aldenmar.charInfo[2].value = '42.25%';   // label 26
    vi.advanceTimersByTime(3000);
    expect(h._xpPending).toHaveLength(1);
    expect(h._xpPending[0]).toMatchObject({
      character: 'Aldenmar', kind: 'party', level: 58, xp_before: 41.5, xp_after: 42.25, aa_before: 10, aa_banked_before: 3,
      zone_id: 206, zone_name: 'Plane of Innovation', loc_x: 10, loc_y: -20, mob: 'a clockwork gnome', potion: true, class: 'Cleric',
    });
    expect(h._xpPending[0].group_members.map(g => g.name)).toEqual(['Brackwyn', 'Corvale']);
    expect(h._xpFlush()).toBe(1);
    expect(globalThis.__uploads[0]).toMatchObject({ kind: 'xp_events' });
    expect(h._xpPending).toHaveLength(0);
  });

  it('a bar that moved just before the line still counts as "after"; same-second lines stay distinct', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const z = zeal(41.5, 10, { buffs: [] });
    const h = load({ zeal: z });
    h._xpNoteRawLine(ts(clock) + 'You gain experience!!', 'Aldenmar', clock);   // primes the bar reading
    vi.advanceTimersByTime(3000);
    h._zealState.Aldenmar.charInfo[2].value = '43%';
    h._xpNoteRawLine(ts(clock) + 'You gain experience!!', 'Aldenmar', clock);
    vi.advanceTimersByTime(3000);
    const [a, b] = h._xpPending;
    expect(b).toMatchObject({ kind: 'solo', xp_before: 41.5, xp_after: 43, potion: false, mob: null });
    expect(Date.parse(b.at)).toBe(Date.parse(a.at) + 1);
  });

  // The guild lead, 2026-10-04: "We shouldn't have a gap in our own players levels." An /anon group mate
  // has no /who level, but Zeal does: the raid roster always, the group pipe with /pipeverbose on.
  it('a group mate\'s level comes from Zeal when /who has none, and /who wins when it has one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    globalThis.__raidPipe = { at: clock - 1000, members: [{ name: 'Brackwyn', class: 'Bard', level: '60' }] };
    globalThis.__zealSamples = { '6': { at: clock - 1000, obj: { type: 6, character: 'Aldenmar',
      data: JSON.stringify([{ name: 'Corvale', spawn_id: 9, level: 57 }]) } } };
    const h = load({ zeal: zeal(41.5, 10) });
    h._xpNoteRawLine(ts(clock) + 'You gain party experience!!', 'Aldenmar', clock);
    vi.advanceTimersByTime(3000);
    expect(h._xpPending[0].group_members).toMatchObject([{ name: 'Brackwyn', level: 60 }, { name: 'Corvale', level: 57 }]);

    globalThis.__who = { brackwyn: { name: 'Brackwyn', class: 'Bard', level: 59, anonymous: false } };
    const w = load({ zeal: zeal(41.5, 10) });
    w._xpNoteRawLine(ts(clock) + 'You gain party experience!!', 'Aldenmar', clock);
    vi.advanceTimersByTime(3000);
    expect(w._xpPending[0].group_members[0]).toMatchObject({ name: 'Brackwyn', level: 59 });
  });

  it('no Zeal level for a group mate (no /pipeverbose, not in the raid) stays null', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    globalThis.__zealSamples = { '6': { at: clock - 1000, obj: { type: 6, data: JSON.stringify([{ name: 'Corvale', spawn_id: 9 }]) } } };
    const h = load({ zeal: zeal(41.5, 10) });
    h._xpNoteRawLine(ts(clock) + 'You gain party experience!!', 'Aldenmar', clock);
    vi.advanceTimersByTime(3000);
    expect(h._xpPending[0].group_members.map(g => g.level)).toEqual([null, null]);
  });

  it('raid experience is its own kind', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const h = load({ zeal: zeal(1, 1) });
    h._xpNoteRawLine(ts(clock) + 'You gained raid experience!', 'Aldenmar', clock);
    vi.advanceTimersByTime(3000);
    expect(h._xpPending[0].kind).toBe('raid');
  });
});

// The guild lead, 2026-10-02: "On the hud, there should be clicky counters for each item you have."
describe('clicky counters', () => {
  afterEach(() => { globalThis.__invs = null; globalThis.__clk = null; });
  const fileAt = Date.parse('2026-09-24T19:00:00Z');
  const setup = (maxcharges) => {
    globalThis.__invs = { Aldenmar: { _updatedAt: new Date(fileAt).toISOString(), items: [
      { loc: 'Fingers', name: 'Ring of Shadows', count: 5 },
      { loc: 'General1-Slot2', name: 'Rod of Insidious Glamour', count: 1 },
      { loc: 'General2-Slot1', name: 'Bread Loaf', count: 20 },            // not a clicky
      { loc: 'Bank1', name: 'Ring of Shadows', count: 9 },                 // not on you
    ] } };
    globalThis.__clk = new Map([
      ['ring of shadows', { name: 'Ring of Shadows', clickeffect: 2577, maxcharges: maxcharges ? 5 : null }],
      ['rod of insidious glamour', { name: 'Rod of Insidious Glamour', clickeffect: 1000, maxcharges: maxcharges ? -1 : null }],
    ]);
  };

  it('lists the clickies on you with charges left; each glow after the export spends one', () => {
    setup(true);
    const h = load();
    expect(h._meClickies('Aldenmar')).toEqual([
      { name: 'Ring of Shadows', left: 5, unlimited: false, used: 0, worn: true },
      { name: 'Rod of Insidious Glamour', left: null, unlimited: true, used: 0, worn: false },
    ]);
    h._noteClickyUse('Aldenmar', 'Ring of Shadows', fileAt - 60_000);   // before the export: already counted in it
    h._noteClickyUse('Aldenmar', 'Ring of Shadows', fileAt + 60_000);
    h._noteClickyUse('Aldenmar', 'ring of shadows', fileAt + 120_000);
    expect(h._meClickies('Aldenmar')[0]).toMatchObject({ left: 3, used: 2 });
  });

  it('without the catalog\'s charge count, a 1 is not shown as "1 left"', () => {
    setup(false);
    const c = load()._meClickies('Aldenmar');
    expect(c.find(x => x.name === 'Ring of Shadows').left).toBe(5);       // more than one: charges
    expect(c.find(x => x.name === 'Rod of Insidious Glamour')).toMatchObject({ left: null, unlimited: false });
  });

  it('no export, no counters', () => {
    expect(load()._meClickies('Aldenmar')).toEqual([]);
  });

  // The guild lead, 2026-10-02: "quarmy has the charges per item".
  it('reads the Quarmy export too, and the newer of the two exports wins', () => {
    try {
      setup(true);
      globalThis.__quarmy = { at: fileAt + 3_600_000, items: [{ loc: 'Fingers1', name: 'Ring of Shadows', count: 2 }] };
      const h = load();
      h._noteClickyUse('Aldenmar', 'Ring of Shadows', fileAt + 60_000);        // before the Quarmy export: in its count
      h._noteClickyUse('Aldenmar', 'Ring of Shadows', fileAt + 3_700_000);     // after it: spends one
      expect(h._meClickies('Aldenmar')).toEqual([{ name: 'Ring of Shadows', left: 1, unlimited: false, used: 1, worn: true }]);
      // An older Quarmy export loses to the newer /output inventory.
      globalThis.__quarmy = { at: fileAt - 3_600_000, items: [{ loc: 'Fingers1', name: 'Ring of Shadows', count: 2 }] };
      expect(load()._meClickies('Aldenmar')[0]).toMatchObject({ name: 'Ring of Shadows', left: 5 });
      // Only a Quarmy export at all: it is used.
      globalThis.__invs = null;
      globalThis.__quarmy = { at: fileAt, items: [{ loc: 'General1-Slot1', name: 'Rod of Insidious Glamour', count: 1 }] };
      expect(load()._meClickies('Aldenmar')).toEqual([{ name: 'Rod of Insidious Glamour', left: null, unlimited: true, used: 0, worn: false }]);
    } finally { globalThis.__quarmy = null; }
  });
});

// Round eight (the guild lead, 2026-09-24): "Remember that several classes can
// have up to 6 melee hits at once, on TOP of procs. Procs should be purple."
// A proc prints as an anonymous spell hit in the same moment as your swing —
// but so does your own nuke, which is why a cast you just began claims one.
describe('weapon procs', () => {
  const Z = { get zeal() { return { Aldenmar: { charInfo: [{ id: 3, value: 'Paladin' }], gauges: [], updatedAt: clock } }; } };
  const iso = (ms) => new Date(ms).toISOString();
  const swing = (h, n, dt = 0) => h._meNoteHit('Aldenmar', { ts: iso(clock + dt), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'slash', amount: n });
  const anon = (h, n, dt = 0) => h._meNoteHit('Aldenmar', { ts: iso(clock + dt), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'non-melee', spellName: 'non-melee', amount: n });
  const procs = (h) => h._serializeMeState().combat.feed.filter(f => f.kind === 'spell').map(f => [f.amount, f.proc]);

  it('a spell hit in the same moment as your swing is a proc — whichever prints first', () => {
    const h = load({ zeal: Z.zeal });
    swing(h, 88); anon(h, 70, 200);                  // after the swing
    anon(h, 71, 9000); swing(h, 90, 9300);           // before it
    expect(procs(h)).toEqual([[71, true], [70, true]]);
  });
  it('a spell hit with no swing near it is not', () => {
    const h = load({ zeal: Z.zeal });
    swing(h, 88); anon(h, 70, 4000);
    expect(procs(h)).toEqual([[70, false]]);
  });
  it('your own nuke — "You begin casting", then its anonymous hit — is not a proc, even mid-swing; the next one is', () => {
    const h = load({ zeal: Z.zeal });
    say(h, 'Aldenmar', 'You begin casting Holy Might.');
    swing(h, 88, 2000); anon(h, 180, 2100);          // the cast lands beside a swing
    anon(h, 70, 2300);                               // the cast is spent: this one is a proc
    expect(procs(h)).toEqual([[70, true], [180, false]]);
  });
  it('a fizzle drops the cast: the next spell hit beside a swing is a proc again', () => {
    const h = load({ zeal: Z.zeal });
    say(h, 'Aldenmar', 'You begin casting Holy Might.');
    h._meNoteCastFailed(ts(clock) + 'Your spell fizzles!', 'Aldenmar');   // the tail calls it beside _meNoteRawLine
    swing(h, 88, 1000); anon(h, 70, 1100);
    expect(procs(h)).toEqual([[70, true]]);
  });
});

// The guild lead, 2026-10-05: "Hud should have the number of procs that you have had on a mob, as
// well as how many stuns/aggro spells you've put into the mob." Procs are the purple ones on the
// hit ledger; a stun or an aggro spell counts when it LANDS (your own cast, resolved by its
// cast_on_other text) and the catalog says it is a stun (cc) or adds hate (hate, effect 92 > 0).
describe('procs and stuns/aggro put into the target', () => {
  const MOB = 'a gnoll warlord';
  const Z = { get zeal() { return { Aldenmar: { charInfo: [{ id: 3, value: 'Monk' }], gauges: [], target_name: MOB, target_id: 7, updatedAt: clock } }; } };
  const SPELLS = [
    { id: 216, name: 'Stun', good: 0, cc: ['stun'], other: 'is struck by a sudden force.' },
    { id: 1223, name: 'Terror of Death', good: 0, hate: 450, other: 'is consumed by deadly terrors.' },
    { id: 1741, name: 'Jolt', good: 0, other: "'s head snaps back." },               // takes hate OFF: the catalog sends it no hate
    { id: 202, name: 'Ice Comet', good: 0, rt: 3, other: 'is struck by a comet of ice.' },
  ];
  const iso = (ms) => new Date(ms).toISOString();
  const swing = (h, mob = MOB, dt = 0) => h._meNoteHit('Aldenmar', { ts: iso(clock + dt), type: 'damage', attacker: null, defender: mob, ability: 'punch', amount: 45 });
  const anon = (h, n, mob = MOB, dt = 0) => h._meNoteHit('Aldenmar', { ts: iso(clock + dt), type: 'damage', attacker: null, defender: mob, ability: 'non-melee', spellName: 'non-melee', amount: n });
  // [procs, stuns] the HUD would read for a target (its name and Zeal spawn id).
  const mine = (h, id = 7, name = MOB) => {
    const t = h._meTargetExtras({ target_name: name, target_id: id, zone: 12, gauges: [] }, 'Aldenmar', clock);
    return [t.my_procs, t.my_stuns];
  };
  // One log line the way the tail takes it: your cast begins, what it landed as, the raw hook. The
  // stamp is the log's own shape ("Thu Sep 24 20:00:00 2026") — the landing event is dated from it.
  const eqts = (ms) => { const p = new Date(ms).toString().split(' '); return '[' + [p[0], p[1], p[2], p[4], p[3]].join(' ') + '] '; };
  const tail = (h, msg) => {
    const line = eqts(clock) + msg;
    h.noteSelfCast(line, 'Aldenmar');
    const ev = h.resolveSelfCastLanding(line, 'Aldenmar');
    if (ev) { ev.target_id = h._provableTargetId('Aldenmar', ev.target); h._meNoteMyLanding('Aldenmar', ev); }
    h._meNoteRawLine(line, 'Aldenmar');
  };
  const cast = (h, spell, landing, who = MOB) => { tail(h, 'You begin casting ' + spell + '.'); clock += 2000; if (landing) tail(h, who + ' ' + landing); };

  it('counts your weapon procs — the ones the hit ledger paints purple — whichever prints first', () => {
    const h = load({ zeal: Z.zeal });
    swing(h); anon(h, 71, MOB, 200);                 // after the swing
    anon(h, 70, MOB, 4000); swing(h, MOB, 4300);     // before it
    expect(mine(h)).toEqual([2, 0]);
    // …the same two the ledger marks, and the number rides the target block of /api/me
    expect(h._serializeMeState().combat.feed.filter(f => f.proc)).toHaveLength(2);
    expect(h._serializeMeState().target).toMatchObject({ name: MOB, my_procs: 2, my_stuns: 0 });
  });

  it('a spell hit with no swing near it, or your own nuke, is not a proc', () => {
    const h = load({ zeal: Z.zeal });
    swing(h); anon(h, 70, MOB, 4000);                // no swing within 1.5 s
    say(h, 'Aldenmar', 'You begin casting Ice Comet.');
    swing(h, MOB, 9000); anon(h, 180, MOB, 9100);    // the cast lands beside a swing
    expect(mine(h)).toEqual([0, 0]);
  });

  it('procs are counted on the mob they hit', () => {
    const h = load({ zeal: Z.zeal });
    swing(h, 'a bat'); anon(h, 50, 'a bat', 100);
    expect(mine(h, null, 'a bat')).toEqual([1, 0]);
    expect(mine(h)).toEqual([0, 0]);
  });

  it('…and one that was your damage shield after all is given back', () => {
    const h = load({ zeal: Z.zeal, dsKnown: 14 });
    swing(h); anon(h, 14, MOB, 100);
    expect(mine(h)).toEqual([1, 0]);                 // it looks like a proc…
    h._meNoteHit('Aldenmar', { ts: iso(clock + 200), type: 'damage', attacker: MOB, defender: 'You', ability: 'hits', amount: 57 });
    expect(mine(h)).toEqual([0, 0]);                 // …until the mob's hit says it was the shield
  });

  it('a stun counts when it LANDS — not when you begin casting it, and not when it is resisted', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    tail(h, 'You begin casting Stun.');
    expect(mine(h)).toEqual([0, 0]);
    clock += 2000; tail(h, MOB + ' is struck by a sudden force.');
    expect(mine(h)).toEqual([0, 1]);
    cast(h, 'Stun', null);                           // resisted: no landing line prints
    expect(mine(h)).toEqual([0, 1]);
  });

  it('an aggro spell counts with the stuns, as one number — and a spell that takes hate off does not', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    cast(h, 'Stun', 'is struck by a sudden force.');
    cast(h, 'Terror of Death', 'is consumed by deadly terrors.');
    expect(mine(h)).toEqual([0, 2]);
    cast(h, 'Jolt', "'s head snaps back.", MOB);     // effect 92 with a NEGATIVE base: de-aggro
    expect(mine(h)).toEqual([0, 2]);
  });

  it('a nuke is neither a stun nor an aggro spell', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    cast(h, 'Ice Comet', 'is struck by a comet of ice.');
    expect(mine(h)).toEqual([0, 0]);
  });

  it('a stun landing with no cast of yours behind it (a proc, or someone else\'s) is not yours', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    tail(h, MOB + ' is struck by a sudden force.');
    expect(mine(h)).toEqual([0, 0]);
  });

  it('one cast lands once on a mob: the same line from someone else\'s stun inside its window is not yours too', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    cast(h, 'Stun', 'is struck by a sudden force.');
    clock += 3000; tail(h, MOB + ' is struck by a sudden force.');
    expect(mine(h)).toEqual([0, 1]);
    cast(h, 'Stun', 'is struck by a sudden force.');   // your next cast is your next stun
    expect(mine(h)).toEqual([0, 2]);
  });

  it('is kept per mob by name and Zeal spawn id — another spawn of the same name starts at 0', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    swing(h); anon(h, 71, MOB, 100);
    cast(h, 'Stun', 'is struck by a sudden force.');
    expect(mine(h, 7)).toEqual([1, 1]);
    expect(mine(h, 8)).toEqual([0, 0]);              // a second gnoll warlord, targeted
    expect(mine(h, null)).toEqual([1, 1]);           // no id on the pipe: the name alone
    expect(mine(h, 7, 'a bat')).toEqual([0, 0]);
  });

  it('its death clears it: the next mob of that name starts at 0, and counts up again', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    swing(h); anon(h, 71, MOB, 100);
    cast(h, 'Stun', 'is struck by a sudden force.');
    expect(mine(h)).toEqual([1, 1]);
    say(h, 'Aldenmar', 'You have slain ' + MOB + '!');
    expect(mine(h)).toEqual([0, 0]);
    clock += 15_000; swing(h); anon(h, 60, MOB, 100);   // (past the stun's 12 s: a cast claims the next anonymous spell hit)
    expect(mine(h)).toEqual([1, 0]);
  });

  it('an entry nobody touched for half an hour is dropped — a mob whose death went unseen', () => {
    const h = load({ zeal: Z.zeal, spells: SPELLS });
    swing(h); anon(h, 71, MOB, 100);
    clock += 29 * 60_000;
    expect(mine(h)).toEqual([1, 0]);
    clock += 2 * 60_000;
    expect(mine(h)).toEqual([0, 0]);
  });

  it('no target: no target block; a corpse carries no counts', () => {
    const h = load({ zeal: { Aldenmar: { charInfo: [], gauges: [], updatedAt: clock } } });
    expect(h._serializeMeState().target).toBeNull();
    expect(h._meTargetExtras({ target_name: "a gnoll warlord's corpse", zone: 12, gauges: [] }, 'Aldenmar', clock)).toEqual({ corpse: true });
  });

  it('the tail hands every landing of yours to the counter, after its spawn id is known', () => {
    const tailBody = stripJs(sliceBlock(agent, 'const bcEvt = (!_sourceExcluded ? resolveSelfCastLanding', 'if (!_shouldSuppressBuffLanding(bcEvt)'));
    expect(tailBody).toMatch(/bcEvt\.target_id = _provableTargetId\(b\.character, bcEvt\.target\);\s*try \{ _meNoteMyLanding\(b\.character, bcEvt\); \}/);
  });
});

// Round six (the guild lead, 2026-09-24): "display level or level range and
// class under the target's bar" · "Corpses shouldn't ever say 'not slowed'" ·
// "When a mob flurries or Rampages denote that with an F in a fist outline or
// an R in a fist outline next to the boss's name".
describe('target: level, class, corpse, flurry and rampage', () => {
  const st = (name = 'a gnoll warlord') => ({ target_name: name, zone: 12, gauges: [] });
  it('an NPC\'s level (or range) and class come from its catalog row', () => {
    const h = load();
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { level: 52, maxlevel: 55, class: 'Warrior', specials: [] } });
    expect(h._meTargetExtras(st(), 'Aldenmar', clock)).toMatchObject({ level: 52, level_max: 55, class: 'Warrior', level_src: 'catalog' });
  });
  // Round eight: "Put their resists below their name". The row's shape is the
  // bot's mob-info response — `resists: { mr, fr, cr, pr, dr }`, not flat.
  it('its resists come from the same row, in the bot\'s shape; none known, none sent', () => {
    const h = load();
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { level: 52, specials: [], resists: { mr: 50, fr: 30, cr: 30, pr: 50, dr: 75 } } });
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).resists).toEqual({ mr: 50, fr: 30, cr: 30, pr: 50, dr: 75 });
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { level: 52, specials: [], resists: { mr: null, fr: null, cr: null, pr: null, dr: null } } });
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).resists).toBeNull();
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { level: 52, specials: [] } });
    expect(h._meTargetExtras(st(), 'Aldenmar', clock).resists).toBeNull();
  });
  it('a player\'s come from /who — the same answer Target Info gives', () => {
    const h = load({ player: { class: 'Enchanter', level: 60, level_src: 'who' } });
    h._mobInfoByName.set('tovrin|12', { at: clock, mob: null });
    expect(h._meTargetExtras(st('Tovrin'), 'Aldenmar', clock)).toMatchObject({ level: 60, class: 'Enchanter', level_src: 'who' });
  });
  it('a corpse is only a corpse — no slow, enrage or level to report', () => {
    const h = load();
    expect(h._meTargetExtras(st("A Temple Patroller's corpse"), 'Aldenmar', clock)).toEqual({ corpse: true });
    expect(h._meTargetExtras(st('a gnoll`s corpse2'), 'Aldenmar', clock)).toEqual({ corpse: true });
  });
  it('flurry and rampage: can it, from the catalog; did it just, from the log — lit for 6 s', () => {
    const h = load();
    h._mobInfoByName.set('a gnoll warlord|12', { at: clock, mob: { level: 52, specials: ['Flurry', 'Area Rampage'] } });
    let t = h._meTargetExtras(st(), 'Aldenmar', clock);
    expect(t).toMatchObject({ flurry: true, rampage: true, flurry_lit: false, rampage_lit: false });
    say(h, 'Aldenmar', 'a gnoll warlord executes a FLURRY of attacks on Brackwyn!');
    say(h, 'Aldenmar', 'a gnoll warlord goes on a WILD RAMPAGE!');
    t = h._meTargetExtras(st(), 'Aldenmar', clock);
    expect(t).toMatchObject({ flurry_lit: true, rampage_lit: true });
    clock += 6001;
    expect(h._meTargetExtras(st(), 'Aldenmar', clock)).toMatchObject({ flurry_lit: false, rampage_lit: false });
  });
  it('Quarm\'s "goes on a RAMPAGE against <target>" lights the R too', () => {
    const h = load();
    say(h, 'Aldenmar', 'a gnoll warlord goes on a RAMPAGE against Brackwyn!');
    expect(h._meTargetExtras(st(), 'Aldenmar', clock)).toMatchObject({ rampage_lit: true, flurry_lit: false });
  });
});

// "Have the damage done and taken per mob roll off into a total as well, then
// drop out after each mob" · "Have the damage shield hits roll into a total".
describe('per-mob totals', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const hitOut = (h, mob, n) => h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: mob, ability: 'punch', amount: n });
  const hitIn = (h, mob, n) => h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: mob, defender: 'You', ability: 'hits', amount: n });
  const ds = (h, mob, n) => h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: mob, ability: 'thorns', amount: n, ds: true });
  it('adds up damage done, taken and shield per mob', () => {
    const h = load();
    hitOut(h, 'a gnoll', 100); hitIn(h, 'a gnoll', 40); ds(h, 'a gnoll', 14);
    clock += 3000; hitOut(h, 'a gnoll', 50);
    clock += 1000; hitOut(h, 'a bat', 7);
    const t = h._meMobTallies('aldenmar', clock);
    expect(t.find(x => x.name === 'a gnoll')).toMatchObject({ out: 150, in: 40, ds: 14, dead_at: null });
    expect(t.find(x => x.name === 'a bat')).toMatchObject({ out: 7 });
    expect(t[0].name).toBe('a bat');   // most recent first
  });
  it('a death closes the total; the next mob of the same name starts a new one', () => {
    const h = load();
    hitOut(h, 'a gnoll', 100);
    say(h, 'Aldenmar', 'You have slain a gnoll!');
    const deadAt = clock;
    clock += 2000; hitOut(h, 'a gnoll', 30);
    const t = h._meMobTallies('aldenmar', clock);
    expect(t.map(x => [x.out, x.dead_at])).toEqual([[30, null], [100, deadAt]]);
  });
  // Round seven: "Then after the fight a ghost of those shows up" — a dead
  // mob's total stays briefly, dim. It was 90 s until FB-42 (2026-09-30: "I saw
  // the kill but it is still on my screen for a long time"); now 10 s.
  it('a dead mob\'s total stays 10 s as the fight\'s ghost; a quiet live one 30 s', () => {
    const h = load();
    hitOut(h, 'a gnoll', 100); hitOut(h, 'a bat', 5);
    say(h, 'Aldenmar', 'a gnoll has been slain by Brackwyn!');
    clock += 9_000;
    expect(h._meMobTallies('aldenmar', clock).map(x => x.name).sort()).toEqual(['a bat', 'a gnoll']);
    clock += 2_000;
    expect(h._meMobTallies('aldenmar', clock).map(x => x.name)).toEqual(['a bat']);
    clock += 20_000;
    expect(h._meMobTallies('aldenmar', clock)).toEqual([]);
  });
  it('ride along on the HUD snapshot', () => {
    const zeal = { Aldenmar: { charInfo: [], gauges: [], updatedAt: clock } };
    const h = load({ zeal });
    hitOut(h, 'a gnoll', 100);
    expect(h._serializeMeState().combat.tallies[0]).toMatchObject({ name: 'a gnoll', out: 100 });
  });
});

// Round seven (the guild lead, 2026-09-24): "I did not get an 'FD Failure' message
// when this happened - FD cooldown in the Hud should show an X on it" — the log
// said "Hitya has fallen to the ground.", third person, with the character's name.
describe('a failed Feign Death', () => {
  const fd = (h) => h._meCooldowns('aldenmar', clock, 'Monk').find(c => c.key === 'fd');
  it('the third-person line with your own name marks it failed, and starts the timer', () => {
    const h = load();
    say(h, 'Aldenmar', 'Aldenmar has fallen to the ground.');
    expect(fd(h)).toMatchObject({ seen: true, failed: true });
    expect(fd(h).ms_left).toBeGreaterThan(0);
  });
  it('someone else falling to the ground is not yours', () => {
    const h = load();
    say(h, 'Aldenmar', 'Brackwyn has fallen to the ground.');
    expect(fd(h).seen).toBe(false);
  });
  it('the ✗ outlasts the timer by 5 s, then clears', () => {
    const h = load();
    say(h, 'Aldenmar', 'You have fallen to the ground.');
    clock += 10_000 + 4000;
    expect(fd(h).failed).toBe(true);
    clock += 2000;
    expect(fd(h).failed).toBe(false);
  });
});

// "Cast time is definitely wrong, especially for clickies" — a clicky casts at
// the item's time, not the spell's, so the time left comes from how fast
// Zeal's cast gauge moves.
describe('cast time from the cast gauge', () => {
  it('measures the rate from the gauge, with no catalog time at all', () => {
    const zeal = { Aldenmar: { charInfo: [], casting: 'Illusion: Fire Elemental', gauges: [{ slot: 7, hp_pct: 20 }], updatedAt: clock } };
    const h = load({ zeal });
    expect(h._serializeMeState().casting.remaining_ms).toBeNull();          // no rate yet, no catalog row
    clock += 1000;
    h._zealState.Aldenmar.gauges = [{ slot: 7, hp_pct: 40 }];
    h._zealState.Aldenmar.updatedAt = clock;
    const c = h._serializeMeState().casting;
    expect(c.remaining_ms).toBe(3000);                                      // 20% a second, 60% to go
    expect(c.est).toBe(false);
  });
  it('a new cast of the same spell restarts the measurement', () => {
    const zeal = { Aldenmar: { charInfo: [], casting: 'Complete Healing', gauges: [{ slot: 7, hp_pct: 90 }], updatedAt: clock } };
    const h = load({ zeal });
    h._serializeMeState();
    clock += 500;
    Object.assign(h._zealState.Aldenmar, { gauges: [{ slot: 7, hp_pct: 5 }], updatedAt: clock });
    expect(h._serializeMeState().casting.remaining_ms).toBeNull();          // just restarted: no rate yet
  });
});

// "Add Harmtouch tracking to Shadowknight mobs in Target Info … if we tab target
// to a shadowknight that's attacking us, there's a good chance we can assign
// that HT to it."
describe('an NPC Shadow Knight\'s Harm Touch', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const knight = { at: 0, mob: { class: 'Shadow Knight', specials: [] } };
  const setup = (target, extra = {}) => {
    const h = load(Object.assign({ zeal: { Aldenmar: { charInfo: [], gauges: [], target_name: target, zone: 12, updatedAt: clock } } }, extra));
    h._mobInfoByName.set('a dark knight|12', Object.assign({}, knight, { at: clock }));
    h._mobInfoByName.set('a gnoll|12', { at: clock, mob: { class: 'Warrior', specials: [] } });
    return h;
  };
  const ht = (h, name) => h._npcHtFor('Aldenmar', { target_name: name, zone: 12 }, h._mobInfoByName.get(name.toLowerCase() + '|12'), null);
  it('a Shadow Knight mob with none seen has it: HT ✓', () => {
    expect(ht(setup('a dark knight'), 'a dark knight')).toMatchObject({ ready: true });
  });
  it('lands on you while you target the knight that is hitting you: pinned at once, 40 minutes', () => {
    const h = setup('a dark knight');
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a dark knight', defender: 'You', ability: 'slash', amount: 80 });
    say(h, 'Aldenmar', 'You writhe in the grip of agony.');
    clock += 60_000;
    expect(ht(h, 'a dark knight')).toMatchObject({ ready: false, ready_in_ms: 39 * 60_000, assigned_later: false });
  });
  it('lands while you target something else: pinned when you target the knight that was hitting you', () => {
    const h = setup('a gnoll');
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a dark knight', defender: 'You', ability: 'slash', amount: 80 });
    say(h, 'Aldenmar', 'You writhe in the grip of agony.');
    expect(ht(h, 'a gnoll')).toBeNull();                                    // not a Shadow Knight
    clock += 5000;
    expect(ht(h, 'a dark knight')).toMatchObject({ ready: false, assigned_later: true });
  });
  it('a knight that was NOT hitting you when it landed is not blamed', () => {
    const h = setup('a gnoll');
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a gnoll', defender: 'You', ability: 'bite', amount: 10 });
    say(h, 'Aldenmar', 'You writhe in the grip of agony.');
    expect(ht(h, 'a dark knight')).toMatchObject({ ready: true });
  });
  it('lands on the knight\'s own target — someone else — while you target the knight', () => {
    const h = setup('a dark knight', { victim: 'Brackwyn' });
    say(h, 'Aldenmar', 'Brackwyn writhes in the grip of agony.');
    expect(ht(h, 'a dark knight')).toMatchObject({ ready: false });
  });
  it('comes back after 40 minutes', () => {
    const h = setup('a dark knight');
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: 'a dark knight', defender: 'You', ability: 'slash', amount: 80 });
    say(h, 'Aldenmar', 'You writhe in the grip of agony.');
    clock += 40 * 60_000;
    expect(ht(h, 'a dark knight')).toMatchObject({ ready: true });
  });
});

describe('no mana for warriors, rogues and monks', () => {
  const zeal = (cls) => ({ Aldenmar: { charInfo: [{ id: 3, value: cls }], gauges: [], updatedAt: clock } });
  it('flags the three classes, and only them', () => {
    expect(load({ zeal: zeal('Monk') })._serializeMeState().no_mana).toBe(true);
    expect(load({ zeal: zeal('Rogue') })._serializeMeState().no_mana).toBe(true);
    expect(load({ zeal: zeal('Warrior') })._serializeMeState().no_mana).toBe(true);
    expect(load({ zeal: zeal('Bard') })._serializeMeState().no_mana).toBe(false);
    expect(load({ zeal: zeal('Shadow Knight') })._serializeMeState().no_mana).toBe(false);
  });
});

// Tracking arrows (a member's idea, 2026-09-25; the guild lead: "YES"). The lines
// are the client's own, from eqstr_us.txt 12040, 12499, 12674-12681 — checked in
// two independent copies of the file.
describe('tracking — the client\'s direction lines', () => {
  const zeal = (cls, extra = {}) => ({ Aldenmar: { charInfo: [{ id: 3, value: cls }], gauges: [], updatedAt: clock, zone: 22, ...extra } });
  // Zeal keeps streaming while you track: the character stays the active one.
  const track = (h) => { h._zealState.Aldenmar.updatedAt = clock; return h._serializeMeState().track; };

  it('lights each of the eight directions, clockwise from straight ahead', () => {
    const h = load({ zeal: zeal('Ranger') });
    for (const [text, angle] of [['is straight ahead.', 0], ['is ahead and to the right.', 45], ['is to the right.', 90],
      ['is behind and to the right.', 135], ['is behind you.', 180], ['is behind and to the left.', 225],
      ['is to the left.', 270], ['is ahead and to the left.', 315]]) {
      say(h, 'Aldenmar', 'a scouting kobold ' + text);
      expect(track(h)).toMatchObject({ name: 'a scouting kobold', angle });
    }
  });

  it('"You begin tracking" names the mob before any direction; either "lost" line clears it', () => {
    const h = load({ zeal: zeal('Druid') });
    expect(track(h)).toBeNull();
    say(h, 'Aldenmar', 'You begin tracking Gorenaire.');
    expect(track(h)).toMatchObject({ name: 'Gorenaire', angle: null });
    say(h, 'Aldenmar', 'Gorenaire is behind you.');
    expect(track(h)).toMatchObject({ name: 'Gorenaire', angle: 180 });
    say(h, 'Aldenmar', 'You have lost your tracking target.');
    expect(track(h)).toBeNull();
    say(h, 'Aldenmar', 'Gorenaire is to the left.');
    expect(track(h)).toMatchObject({ angle: 270 });
    say(h, 'Aldenmar', 'You have lost or do not have a tracking target.');
    expect(track(h)).toBeNull();
  });

  it('a player\'s /emote in the same shape lights nothing for a class that cannot track', () => {
    const h = load({ zeal: zeal('Cleric') });
    say(h, 'Aldenmar', 'Brackwyn is behind you.');
    expect(track(h)).toBeNull();
    // …but the mob named by "You begin tracking" is followed, whatever the class reads as.
    say(h, 'Aldenmar', 'You begin tracking a forest wolf.');
    say(h, 'Aldenmar', 'a forest wolf is ahead and to the left.');
    expect(track(h)).toMatchObject({ name: 'a forest wolf', angle: 315 });
    say(h, 'Aldenmar', 'Brackwyn is behind you.');
    expect(track(h)).toMatchObject({ name: 'a forest wolf', angle: 315 });
  });

  it('a direction reports its age and stays five minutes; a new zone drops it', () => {
    const h = load({ zeal: zeal('Bard') });
    say(h, 'Aldenmar', 'a forest wolf is to the right.');
    clock += 60_000;
    expect(track(h)).toMatchObject({ angle: 90, age_ms: 60_000 });
    clock += 4 * 60_000 + 1;
    expect(track(h)).toBeNull();
    say(h, 'Aldenmar', 'a forest wolf is to the right.');
    expect(track(h)).toMatchObject({ angle: 90 });
    h._zealState.Aldenmar.zone = 23;
    expect(track(h)).toBeNull();
  });

  it('a tracking line is not taken for anything else on the HUD', () => {
    const h = load({ zeal: zeal('Ranger') });
    say(h, 'Aldenmar', 'You begin tracking a gnoll.');
    const s = h._serializeMeState();
    expect(s.cooldowns.every(c => c.seen === false)).toBe(true);
    expect(s.swing).toBeFalsy();
  });
});
