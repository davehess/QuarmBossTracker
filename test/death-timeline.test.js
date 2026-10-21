// test/death-timeline.test.js — the death timeline strip on the trigger overlay (agent + apps/mimic/triggers.html).
//
// The guild lead, 2026-10-21: "The death timers between mobs is something we want easily and clearly displayed
// versus having to say it out loud. We should try to have a timeline view show up on the bottom of the TTS."
//
// What is under test, the shipped code cut out of the two files and run:
//   1  deathPairStates (triggers.html, pure): the 6-minute and 20-minute pair windows, open / made / missed, the
//      2-minute result tail, a repeat death starting a new episode, name spelling (case, underscore, backtick)
//   2  the agent ring (_ringAddMobDeath / _noteRecentMobDeath): boss or pair-name deaths only, the 10 s dedupe, the
//      cap, the live-line gate, the line's own timestamp
//   3  wiring: both API bodies carry recentDeaths, the tail hook calls the ring, and the strip is never drawn in a
//      canvas panel (body.part)
// Text assertions strip comments first (test/_source-slice.js); the behaviour ones run the real functions.
//
// Run: npx vitest run test/death-timeline.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, stripCss, ROOT, AGENT_INDEX } from './_source-slice.js';

const TRIGGERS = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
const AGENT = readSource(AGENT_INDEX);

// ── 1  the page's pure pair logic ────────────────────────────────────────────────────────────────────────────
const pageBlock = sliceBlock(TRIGGERS, '// ── death timeline: pure state ──', '// ── /death timeline: pure state ──');
const { deathPairStates, tlKey } = evalBlock(pageBlock, ['deathPairStates', 'tlKey']);

const RULES = [
  { names: ['Decorin Berik', 'Decorin Grunhork'], windowSec: 360, label: 'Decorins' },
  { names: ['Tallon Zek', 'Vallon Zek'], windowSec: 1200, label: 'Tallon + Vallon' },
];
const T0 = Date.UTC(2026, 9, 22, 1, 0, 0);
const S = (n) => n * 1000;
const d = (name, atSec) => ({ name, zone: 'Plane of Tactics', atMs: T0 + S(atSec), boss: true });

describe('deathPairStates: the Decorin window (6 minutes)', () => {
  it('opens when one dies, due name is the other, deadline is first death + 6:00', () => {
    const st = deathPairStates([d('Decorin Berik', 0)], RULES, T0 + S(168));
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ kind: 'open', label: 'Decorins', dueName: 'Decorin Grunhork', deadlineMs: T0 + S(360) });
    expect((st[0].deadlineMs - (T0 + S(168))) / 1000).toBe(192);   // "due in 3:12"
  });
  it('works whichever dies first', () => {
    const st = deathPairStates([d('Decorin Grunhork', 0)], RULES, T0 + S(10));
    expect(st[0]).toMatchObject({ kind: 'open', dueName: 'Decorin Berik' });
  });
  it('is made when the second dies inside the window, with the gap, and shows for 2 minutes after', () => {
    const ds = [d('Decorin Berik', 0), d('Decorin Grunhork', 280)];
    expect(deathPairStates(ds, RULES, T0 + S(285))[0]).toMatchObject({ kind: 'made', gapSec: 280, label: 'Decorins' });
    expect(deathPairStates(ds, RULES, T0 + S(280 + 120))).toHaveLength(1);
    expect(deathPairStates(ds, RULES, T0 + S(280 + 121))).toHaveLength(0);
  });
  it('the second death exactly at 6:00 still makes it; one second later does not', () => {
    expect(deathPairStates([d('Decorin Berik', 0), d('Decorin Grunhork', 360)], RULES, T0 + S(361))[0].kind).toBe('made');
    const late = deathPairStates([d('Decorin Berik', 0), d('Decorin Grunhork', 361)], RULES, T0 + S(362));
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ kind: 'open', dueName: 'Decorin Berik', firstName: 'Decorin Grunhork' });   // a new episode
  });
  it('is missed once the window runs out, for 2 minutes, then gone', () => {
    const ds = [d('Decorin Berik', 0)];
    expect(deathPairStates(ds, RULES, T0 + S(359))[0].kind).toBe('open');
    expect(deathPairStates(ds, RULES, T0 + S(360))[0]).toMatchObject({ kind: 'missed', dueName: 'Decorin Grunhork' });
    expect(deathPairStates(ds, RULES, T0 + S(360 + 120))).toHaveLength(1);
    expect(deathPairStates(ds, RULES, T0 + S(360 + 121))).toHaveLength(0);
  });
});

describe('deathPairStates: Tallon + Vallon (20 minutes) and the rest', () => {
  it('stays open for 20 minutes, made at 19:59, a new episode at 20:01', () => {
    expect(deathPairStates([d('Tallon Zek', 0)], RULES, T0 + S(1199))[0]).toMatchObject({ kind: 'open', label: 'Tallon + Vallon', dueName: 'Vallon Zek' });
    expect(deathPairStates([d('Tallon Zek', 0), d('Vallon Zek', 1199)], RULES, T0 + S(1200))[0]).toMatchObject({ kind: 'made', gapSec: 1199 });
    const next = deathPairStates([d('Tallon Zek', 0), d('Vallon Zek', 1201)], RULES, T0 + S(1202));
    expect(next[0]).toMatchObject({ kind: 'open', dueName: 'Tallon Zek' });
  });
  it('the two rules run independently', () => {
    const ds = [d('Decorin Berik', 0), d('Tallon Zek', 30)];
    const st = deathPairStates(ds, RULES, T0 + S(60));
    expect(st.map((s) => s.label)).toEqual(['Decorins', 'Tallon + Vallon']);
  });
  it('a mob that is in no rule never makes a pair row', () => {
    expect(deathPairStates([d('Glykus', 0), d('Tagrin', 400)], RULES, T0 + S(500))).toEqual([]);
  });
  it('matches names the way the log spells them (case, underscore, backtick, leading #)', () => {
    expect(tlKey('#Decorin_Berik')).toBe('decorin berik');
    expect(tlKey('Tallon`s  Zek')).toBe("tallon's zek");
    const st = deathPairStates([{ name: 'decorin_berik', atMs: T0 }, { name: 'DECORIN GRUNHORK', atMs: T0 + S(100) }], RULES, T0 + S(101));
    expect(st[0].kind).toBe('made');
  });
  it('a name that dies twice is a new episode, not a made pair', () => {
    const st = deathPairStates([d('Decorin Berik', 0), d('Decorin Berik', 200)], RULES, T0 + S(210));
    expect(st[0]).toMatchObject({ kind: 'open', firstName: 'Decorin Berik', deadlineMs: T0 + S(200 + 360) });
  });
});

// ── 2  the agent ring ────────────────────────────────────────────────────────────────────────────────────────
// The constants + pure ring function, as shipped.
const ringBlock = sliceBlock(AGENT, 'const DEATH_PAIR_RULES = [', '\n// Tail hook');
const { DEATH_PAIR_RULES, _ringAddMobDeath, RECENT_DEATHS_MAX } = evalBlock(ringBlock, ['DEATH_PAIR_RULES', '_ringAddMobDeath', 'RECENT_DEATHS_MAX']);

describe('agent ring: which deaths are kept', () => {
  it('ships the two guild pair rules', () => {
    expect(DEATH_PAIR_RULES).toEqual(RULES);
  });
  it('keeps a catalog boss; drops an ordinary mob; keeps a pair name even when the catalog does not call it a boss', () => {
    const ring = [];
    expect(_ringAddMobDeath(ring, 'Glykus', 'Plane of Tactics', 1000, true, DEATH_PAIR_RULES)).toMatchObject({ name: 'Glykus', boss: true });
    expect(_ringAddMobDeath(ring, 'a tactics guard', 'Plane of Tactics', 2000, false, DEATH_PAIR_RULES)).toBeNull();
    expect(_ringAddMobDeath(ring, 'Decorin_Berik', 'Plane of Tactics', 3000, false, DEATH_PAIR_RULES)).toMatchObject({ name: 'Decorin Berik' });
    expect(ring.map((e) => e.name)).toEqual(['Glykus', 'Decorin Berik']);
  });
  it('never records "You" or a bad time', () => {
    const ring = [];
    expect(_ringAddMobDeath(ring, 'You', null, 1000, true, DEATH_PAIR_RULES)).toBeNull();
    expect(_ringAddMobDeath(ring, 'Glykus', null, NaN, true, DEATH_PAIR_RULES)).toBeNull();
    expect(ring).toHaveLength(0);
  });
  it('dedupes the same name inside 10 seconds (several lines report one death), not after', () => {
    const ring = [];
    _ringAddMobDeath(ring, 'Tagrin', null, 100000, true, DEATH_PAIR_RULES);
    expect(_ringAddMobDeath(ring, 'tagrin', null, 109000, true, DEATH_PAIR_RULES)).toBeNull();
    expect(_ringAddMobDeath(ring, 'Tagrin', null, 111000, true, DEATH_PAIR_RULES)).not.toBeNull();
    expect(ring).toHaveLength(2);
  });
  it('keeps at most RECENT_DEATHS_MAX, newest', () => {
    const ring = [];
    for (let i = 0; i < RECENT_DEATHS_MAX + 7; i++) _ringAddMobDeath(ring, 'Boss ' + i, null, 100000 + i * 60000, true, DEATH_PAIR_RULES);
    expect(ring).toHaveLength(RECENT_DEATHS_MAX);
    expect(ring[ring.length - 1].name).toBe('Boss ' + (RECENT_DEATHS_MAX + 6));
    expect(ring[0].name).toBe('Boss 7');
  });
  it('stays in time order when a late line arrives out of order', () => {
    const ring = [];
    _ringAddMobDeath(ring, 'A', null, 200000, true, DEATH_PAIR_RULES);
    _ringAddMobDeath(ring, 'B', null, 100000, true, DEATH_PAIR_RULES);
    expect(ring.map((e) => e.name)).toEqual(['B', 'A']);
  });
});

describe('agent hook: _noteRecentMobDeath reads a log line', () => {
  // Real death matcher + the ring + the hook; the timestamp parse, zone and catalog lookups are stubbed.
  const matcher = sliceBlock(AGENT, 'const _DEATH_SLAIN_BY_RX', '\nfunction _cancelTimersOnMobDeath');
  // (the matcher, then the ring block and the hook, sit back to back in the source)
  const body = matcher.replace(/\nfunction _cancelTimersOnMobDeath$/, '');
  function hook({ lineMs, boss }) {
    const pre = `const parseEqTimestamp = () => (${lineMs} == null ? null : new Date(${lineMs}));
      const _myFightZone = () => ({ id: 214, name: 'Plane of Tactics' });
      const _myFightIsBoss = (n) => ${JSON.stringify(boss)}.includes(n);\n`;
    return evalBlock(pre + body, ['_noteRecentMobDeath', '_recentMobDeaths', '_recentDeathsSnapshot']);
  }
  it('uses the line\'s own timestamp, the zone name, and the catalog boss answer', () => {
    const at = Date.now() - 20000;
    const h = hook({ lineMs: at, boss: ['Glykus'] });
    const e = h._noteRecentMobDeath('[Wed Oct 21 21:02:11 2026] Glykus has been slain by Aldenmar!', 'Brackwyn');
    expect(e).toEqual({ name: 'Glykus', zone: 'Plane of Tactics', atMs: at, boss: true });
    expect(h._recentDeathsSnapshot()).toHaveLength(1);
  });
  it('ignores a non-boss, a player death line that is not a boss, and an old (backfill) line', () => {
    const h = hook({ lineMs: Date.now() - 5000, boss: ['Glykus'] });
    expect(h._noteRecentMobDeath('[x] a tactics guard has been slain by Aldenmar!', 'Brackwyn')).toBeNull();
    expect(h._noteRecentMobDeath('[x] Aldenmar died.', 'Brackwyn')).toBeNull();
    expect(h._noteRecentMobDeath('[x] You have slain a tactics guard!', 'Brackwyn')).toBeNull();
    const old = hook({ lineMs: Date.now() - 3600000, boss: ['Glykus'] });
    expect(old._noteRecentMobDeath('[x] Glykus has been slain by Aldenmar!', 'Brackwyn')).toBeNull();
  });
  it('keeps a pair mob that the catalog does not flag, and "You have slain" works', () => {
    const h = hook({ lineMs: Date.now() - 1000, boss: [] });
    expect(h._noteRecentMobDeath('[x] You have slain Vallon Zek!', 'Brackwyn')).toMatchObject({ name: 'Vallon Zek' });
  });
  it('the snapshot carries only the last 30 minutes', () => {
    const h = hook({ lineMs: Date.now() - 1000, boss: ['Glykus'] });
    h._recentMobDeaths.push({ name: 'Old', zone: null, atMs: Date.now() - 31 * 60000, boss: true });
    h._noteRecentMobDeath('[x] Glykus has been slain by Aldenmar!', 'Brackwyn');
    expect(h._recentDeathsSnapshot().map((e) => e.name)).toEqual(['Glykus']);
  });
});

// ── 3  wiring ────────────────────────────────────────────────────────────────────────────────────────────────
describe('wiring (comments stripped)', () => {
  const a = stripJs(AGENT);
  const t = stripJs(TRIGGERS);
  it('both API bodies carry the deaths and the pair rules, and the tail hook feeds the ring', () => {
    expect((a.match(/recentDeaths:\s+_recentDeathsSnapshot\(\)/g) || []).length).toBe(2);   // /api/timers + the state object
    expect((a.match(/deathPairRules:\s+DEATH_PAIR_RULES/g) || []).length).toBe(2);
    expect(a).toMatch(/_noteRecentMobDeath\(line, b\.character\)/);
  });
  it('the strip is hidden in every canvas panel (body.part) and the page never draws it there', () => {
    const css = stripCss(TRIGGERS.slice(0, TRIGGERS.indexOf('</style>')));
    expect(css).toMatch(/body\.part #tline\s*\{\s*display:\s*none\s*!important/);
    expect(css).toMatch(/#tline\s*\{[^}]*display:\s*none/);                      // absent by default: no empty chrome
    expect(t).toMatch(/if \(PART \|\| !tlineEl\) return;/);                     // tlineUpdate bails in a panel
    expect(t).toMatch(/if \(!PART\) tlineSet\(s\.recentDeaths, s\.deathPairRules\)/);
  });
  it('the stack rides above the strip and the window height counts it', () => {
    const css = stripCss(TRIGGERS.slice(0, TRIGGERS.indexOf('</style>')));
    expect(css).toMatch(/body\.has-tline:not\(\.part\):not\(\.timers-topdown\) #timers\s*\{\s*bottom:\s*calc\(12px \+ var\(--tline-h,0px\)\)/);
    const measure = sliceBlock(t, 'function measureWanted(){', 'var hasLoot');
    expect(measure).toMatch(/tlineEl\.offsetHeight/);
  });
  it('the strip speaks nothing', () => {
    const block = stripJs(sliceBlock(TRIGGERS, '// ── death timeline: pure state ──', 'setInterval(tlineUpdate, 250);'));
    expect(block).toMatch(/function tlineUpdate\(\)/);   // the slice is the strip's code, not an empty match
    expect(block).not.toMatch(/\b(speak|fire|fireBlind|speechSynthesis|Audio)\s*\(/);
  });
});
