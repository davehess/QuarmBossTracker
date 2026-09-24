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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const meBlock = sliceBlock(agent, '// ── Me overlay (the guild lead, 2026-09-24)', '\nfunction _serializeTankState() {')
  .replace(/\nfunction _serializeTankState\(\) \{$/, '');
const parseTs = agent.match(/const TS_RX = [^\n]+/)[0] + '\n'
  + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');
const failRx = agent.match(/const _CAST_FAIL_RX = [^\n]+/)[0];
const noManaRx = agent.match(/const _NO_MANA_CLASSES = [^\n]+/)[0];
const pipeCandidate = sliceBlock(agent, 'function _pipeCandidateOf(st, key) {', '\n}');

const EXPORTS = ['_serializeMeState', '_meNoteRawLine', '_meTick', '_meSwingState', '_meHands', '_meSwings',
  '_meCooldowns', '_meDisc', '_meDiscReuseSecs', '_meTargetExtras', '_discReadyAt', '_mobInfoByName', '_zealState'];

function load({ zeal = {}, victim = null } = {}) {
  const pre = `
    const _spellByNameLower = new Map();
    const _zealState = ${JSON.stringify(zeal)};
    const whoData = new Map();
    const _raidClassByName = new Map();
    const CHARM_SPELLS = new Map();
    const stats = { currentEncounterThreat: null };
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

  it('learns the delay from round-to-round and predicts the next round', () => {
    const h = load();
    for (let i = 0; i < 7; i++) swing(h, 'Aldenmar', ['punch', 'punch'], 2600);
    clock -= 2600;                         // stand just after the last round
    clock += 1000;
    const s = h._meSwingState('aldenmar', { autoattack: true, gauges: [] }, clock);
    expect(s.period_ms).toBe(2600);
    expect(s.source).toBe('log');
    expect(s.est).toBe(true);
    // Last round arrived 1000 ms ago; lines arrive up to a poll late, so the
    // round is dated 250 ms earlier: 2600 − 1250.
    expect(s.ms_left).toBe(1350);
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

  it('an uncached mob says "unknown" (null), not "cannot enrage"', () => {
    expect(load()._meTargetExtras(st(), 'Aldenmar', clock).enrage).toBeNull();
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
    expect(keys('Monk')).toEqual([['ability', false], ['mend', false], ['fd', false]]);
    expect(keys('Warrior')).toEqual([['ability', false], ['taunt', false]]);
    expect(keys('Paladin')).toEqual([['loh', false]]);
    expect(keys('Shadow Knight')).toEqual([['ht', false]]);
    expect(keys('Cleric')).toEqual([]);
  });

  it('keeps the class order once used, and adds what else was used after it', () => {
    const h = load({ zeal: zeal('Monk') });
    say(h, 'Aldenmar', 'You mend your wounds and heal some damage.');
    say(h, 'Aldenmar', 'You taunt a gnoll to ignore others and attack you!');
    expect(h._serializeMeState().cooldowns.map(c => c.key)).toEqual(['ability', 'mend', 'fd', 'taunt']);
  });

  it('a failed feign starts Feign Death at 8 s (9 − 1; Rapid Feign would cut it, so est)', () => {
    const h = load({ zeal: zeal('Monk') });
    say(h, 'Aldenmar', 'You have fallen to the ground.');
    const fd = cd(h, 'fd');
    expect(fd.seen).toBe(true);
    expect(fd.total_ms).toBe(8000);
    expect(fd.ms_left).toBe(8000);
    expect(fd.est).toBe(true);
  });

  it('`/pipe fd` on the hotkey starts it at the press — Mimic\'s receive time', () => {
    const h = load({ zeal: zeal('Monk', { custom_recent: [{ at: clock - 3000, text: 'fd' }] }) });
    expect(cd(h, 'fd').ms_left).toBe(5000);
  });

  it('reads each /pipe line once — an old line still in the ring never drags a newer start back', () => {
    const h = load({ zeal: zeal('Monk', { custom_recent: [{ at: clock - 3000, text: 'fd' }] }) });
    expect(cd(h, 'fd').ms_left).toBe(5000);
    clock += 9000;
    say(h, 'Aldenmar', 'You have fallen to the ground.');   // a newer feign
    expect(cd(h, 'fd').ms_left).toBe(8000);
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
