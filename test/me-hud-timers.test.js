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
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const meBlock = sliceBlock(agent, '// ── Me overlay (the guild lead, 2026-09-24)', '\nfunction _serializeTankState() {')
  .replace(/\nfunction _serializeTankState\(\) \{$/, '');
const parseTs = agent.match(/const TS_RX = [^\n]+/)[0] + '\n'
  + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');
const failRx = agent.match(/const _CAST_FAIL_RX = [^\n]+/)[0];
const noManaRx = agent.match(/const _NO_MANA_CLASSES = [^\n]+/)[0];
const pipeCandidate = sliceBlock(agent, 'function _pipeCandidateOf(st, key) {', '\n}');

const dsSlack = agent.match(/const DS_UNLISTED_SLACK = [^\n]+/)[0];
const slainRx = agent.match(/const _SLAIN_BY_RX {2}= [^\n]+/)[0] + '\n' + agent.match(/const _SLAIN_YOU_RX = [^\n]+/)[0];

const EXPORTS = ['_serializeMeState', '_meNoteRawLine', '_meTick', '_meSwingState', '_meHands', '_meSwings',
  '_meCooldowns', '_meDisc', '_meDiscReuseSecs', '_meTargetExtras', '_discReadyAt', '_mobInfoByName', '_zealState',
  '_meNoteHit', '_meMobTallies'];

function load({ zeal = {}, victim = null, dsKnown = 0, player = null } = {}) {
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
    ${dsSlack}
    ${slainRx}
    function _knownDsPerHitFor() { return ${Number(dsKnown) || 0}; }
    function _targetPlayerInfo() { return ${JSON.stringify(player)}; }
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

  it('every hit carries its log second, so the HUD can draw one round per line', () => {
    const h = load({ zeal: Z.zeal });
    h._meNoteHit('Aldenmar', { ts: iso(clock), type: 'damage', attacker: null, defender: 'a gnoll', ability: 'punch', amount: 45 });
    expect(h._serializeMeState().combat.feed[0].at).toBe(clock);
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
  it('a dead mob\'s total stays 8 s, then drops out; a quiet one after 30 s', () => {
    const h = load();
    hitOut(h, 'a gnoll', 100); hitOut(h, 'a bat', 5);
    say(h, 'Aldenmar', 'a gnoll has been slain by Brackwyn!');
    clock += 8001;
    expect(h._meMobTallies('aldenmar', clock).map(x => x.name)).toEqual(['a bat']);
    clock += 22_000;
    expect(h._meMobTallies('aldenmar', clock)).toEqual([]);
  });
  it('ride along on the HUD snapshot', () => {
    const zeal = { Aldenmar: { charInfo: [], gauges: [], updatedAt: clock } };
    const h = load({ zeal });
    hitOut(h, 'a gnoll', 100);
    expect(h._serializeMeState().combat.tallies[0]).toMatchObject({ name: 'a gnoll', out: 100 });
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
