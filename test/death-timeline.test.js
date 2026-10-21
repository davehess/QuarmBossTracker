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
    expect(t).toMatch(/if \(!PART\) tlineSet\(s\.recentDeaths, s\.deathPairRules, s\.replayDeaths, s\.replayClock\)/);
  });
  it('the stack rides above the strip and the window height counts it', () => {
    const css = stripCss(TRIGGERS.slice(0, TRIGGERS.indexOf('</style>')));
    expect(css).toMatch(/body\.has-tline:not\(\.part\):not\(\.timers-topdown\) #timers\s*\{\s*bottom:\s*calc\(12px \+ var\(--tline-h,0px\)\)/);
    const measure = sliceBlock(t, 'function measureWanted(){', 'var hasLoot');
    expect(measure).toMatch(/tlineEl\.offsetHeight/);
  });
  it('the strip follows the timers anchor: bottom by default, top (under the gutter, stack below it) when top-down', () => {
    const css = stripCss(TRIGGERS.slice(0, TRIGGERS.indexOf('</style>')));
    expect(css).toMatch(/#tline\s*\{\s*position:\s*fixed;\s*bottom:\s*8px/);                                  // bottom edge by default
    expect(css).toMatch(/body\.timers-topdown #tline\s*\{\s*top:\s*34px;\s*bottom:\s*auto/);                   // top edge when top-down
    expect(css).toMatch(/body\.setup\.timers-topdown #tline\s*\{\s*top:\s*58px/);                              // clear of the setup bar
    expect(css).toMatch(/body\.has-tline:not\(\.part\)\.timers-topdown #timers\s*\{\s*top:\s*calc\(38px \+ var\(--tline-h,0px\)\)/);
    expect(css).toMatch(/body\.has-tline:not\(\.part\)\.setup\.timers-topdown #timers\s*\{\s*top:\s*calc\(62px \+ var\(--tline-h,0px\)\)/);
    // the bottom-anchored stack rule must not apply top-down (it would pin the stack to both edges)
    expect(css).toMatch(/body\.has-tline:not\(\.part\):not\(\.timers-topdown\) #timers/);
  });
  it('the swap is live: the setting toggles the one body class both rules key on, and the page re-reads it on every status push', () => {
    const toggle = sliceBlock(t, 'function applyTimersOrder(s){', 'window.mimic.onStatus(applyTimersOrder)');
    expect(toggle).toMatch(/classList\.toggle\('timers-topdown', !!\(s && s\.triggerTimersTopDown\)\)/);
    expect(t).toMatch(/window\.mimic\.onStatus\(applyTimersOrder\)/);
    // the strip's own control + collapse stay inside #tline, so they move with it
    expect(TRIGGERS).toMatch(/<div id="tline"><button id="tl-toggle"[\s\S]*?id="tl-sm"[\s\S]*?id="tl-lg"/);
  });
  it('the strip speaks nothing', () => {
    const block = stripJs(sliceBlock(TRIGGERS, '// ── death timeline: pure state ──', 'setInterval(tlineUpdate, 250);'));
    expect(block).toMatch(/function tlineUpdate\(\)/);   // the slice is the strip's code, not an empty match
    expect(block).not.toMatch(/\b(speak|fire|fireBlind|speechSynthesis|Audio)\s*\(/);
  });
});

// ── 4  the plan phase, the Up next queue, the strip's preferences (the guild lead, 2026-10-21: "Timeline on TTS
//      minimizable, text size scalable, next event due for next fight. Next major event in fights queued.") ────────
// The shipped pure code between the plan + queue markers, run together with the pair block it builds on, and the real
// pop-raids.js (browser-safe: it only sets window.POP_RAIDS) for the wording.
const planBlock = sliceBlock(TRIGGERS, '// ── death timeline: plan + queue ──', '// ── /death timeline: plan + queue ──');
const P = evalBlock(pageBlock + '\n' + planBlock, [
  'deathPairStates', 'tlPlanFor', 'tlPlanNext', 'tlPlanZone', 'tlQueue', 'tlTimerMajor',
  'tlClampScale', 'tlStepScale', 'tlLoadPrefs', 'tlSavePref', 'TL_SCALE_MIN', 'TL_SCALE_MAX',
]);
const POP = (() => { const w = {}; new Function('window', readSource(path.join(ROOT, 'apps', 'mimic', 'pop-raids.js')))(w); return w.POP_RAIDS; })();
const dz = (name, atSec) => ({ name, zone: 'Plane of Tactics', atMs: T0 + S(atSec), boss: true });
function nextFor(deaths, nowSec, zone = 'Plane of Tactics') {
  const now = T0 + S(nowSec);
  const pairs = P.deathPairStates(deaths, RULES, now);
  return P.tlPlanNext(zone, P.tlPlanFor(zone, POP), deaths, RULES, pairs);
}

describe('plan phases are read from pop-raids.js', () => {
  const phases = P.tlPlanFor('Plane of Tactics', POP);
  it('finds the four Rallos phases of Plane of Tactics, in order, and no other encounter', () => {
    expect(phases.map((p) => p.n)).toEqual([1, 2, 3, 4]);
    expect(P.tlPlanFor('Plane of Hate', POP)).toEqual([]);
    expect(P.tlPlanFor('', POP)).toEqual([]);
    expect(P.tlPlanFor('Plane of Tactics', null)).toEqual([]);
  });
  it('shortens the callouts to one line that keeps the time / consequence', () => {
    expect(phases[2].text).toBe('Fake Rallos: corner tank; despawns ~50% → real spawns in arena');
    expect(phases[3].text).toBe('Rallos (arena): DPS check; adds every 54s');
    expect(phases.every((p) => p.text.length <= 80)).toBe(true);
  });
});

describe('plan phase from the deaths seen', () => {
  it('nothing of the plan seen yet: next is the Decorins, window starts on the first death', () => {
    expect(nextFor([dz('Glykus', 0)], 10).text).toBe('Decorins — 6 min window starts on the first death');
  });
  it('a Decorin window running: that is the big countdown, so next is Tallon + Vallon', () => {
    const n = nextFor([dz('Decorin Berik', 0)], 60);
    expect(n).toMatchObject({ n: 2, text: 'Tallon + Vallon — 20 min window starts on the first death' });
  });
  it('both Decorins made (P1 done): next is still P2', () => {
    expect(nextFor([dz('Decorin Berik', 0), dz('Decorin Grunhork', 100)], 110).n).toBe(2);
  });
  it('the Tallon window running: next is the Fake Rallos phase, in the plan\'s own wording', () => {
    const n = nextFor([dz('Decorin Berik', 0), dz('Decorin Grunhork', 100), dz('Tallon Zek', 400)], 450);
    expect(n.n).toBe(3);
    expect(n.text).toMatch(/^Fake Rallos: .*real spawns in arena$/);
  });
  it('both of Tallon + Vallon down: next is P3 until Rallos himself dies, then nothing', () => {
    const ds = [dz('Decorin Berik', 0), dz('Decorin Grunhork', 100), dz('Tallon Zek', 400), dz('Vallon Zek', 700)];
    expect(nextFor(ds, 710).n).toBe(3);
    expect(nextFor(ds.concat(dz('Rallos Zek the Warlord', 1500)), 1510)).toBeNull();
  });
  it('a later phase done implies the earlier ones (the first deaths scrolled out of the 30 minutes)', () => {
    expect(nextFor([dz('Tallon Zek', 0), dz('Vallon Zek', 300)], 310).n).toBe(3);
  });
  it('a missed window is not progress: the same phase is next again', () => {
    expect(nextFor([dz('Decorin Berik', 0)], 400).n).toBe(1);
  });
  it('no plan for a zone without one; the zone falls back to what the deaths name', () => {
    expect(nextFor([dz('Glykus', 0)], 10, 'Plane of Hate')).toBeNull();
    expect(P.tlPlanZone([{ name: 'a', zone: 'Plane of Tactics', atMs: 1 }, { name: 'b', zone: null, atMs: 2 }])).toBe('Plane of Tactics');
    expect(P.tlPlanZone([{ name: 'Decorin_Berik', zone: null, atMs: 1 }])).toBe('plane of tactics');
    expect(P.tlPlanZone([{ name: 'Glykus', zone: null, atMs: 1 }])).toBeNull();
  });
});

describe('the Up next queue', () => {
  const NOW = T0;
  const tm = (key, label, remSec, extra = {}) => ({ key, label, endsMs: NOW + S(remSec), warns: 0, loot: false, cycle: false, ...extra });
  const plan = { n: 2, text: 'Tallon + Vallon — 20 min window starts on the first death' };
  const open = (label, dueName, remSec) => ({ kind: 'open', label, dueName, deadlineMs: NOW + S(remSec) });

  it('major rule: a warning set or 20 s+ left; never loot, a cyclic row or an expired one', () => {
    expect(P.tlTimerMajor(tm('a', 'x', 19), NOW)).toBe(false);
    expect(P.tlTimerMajor(tm('a', 'x', 20), NOW)).toBe(true);
    expect(P.tlTimerMajor(tm('a', 'x', 8, { warns: 1 }), NOW)).toBe(true);
    expect(P.tlTimerMajor(tm('a', 'x', 90, { loot: true }), NOW)).toBe(false);
    expect(P.tlTimerMajor(tm('a', 'x', 90, { cycle: true }), NOW)).toBe(false);
    expect(P.tlTimerMajor(tm('a', 'x', -1, { warns: 1 }), NOW)).toBe(false);
  });
  it('merges pair deadlines and major timers, soonest first, plan in the last slot, at most 3', () => {
    const q = P.tlQueue([], plan,
      [tm('d1', 'Tagrin - Slow', 61), tm('d2', 'Tagrin - Malo', 38), tm('d3', 'Tagrin - Rampage', 12), tm('d5', 'Tagrin - Rune', 50)], NOW, [], 3);
    expect(q.map((x) => x.label)).toEqual(['Tagrin - Malo', 'Tagrin - Rune', plan.text]);   // the 12 s row is not major; the plan holds slot 3
    const q2 = P.tlQueue([open('Decorins', 'Decorin Grunhork', 30)], null, [tm('d1', 'Slow', 61), tm('d2', 'Malo', 38), tm('d4', 'Rune', 45)], NOW, [], 3);
    expect(q2.map((x) => x.label)).toEqual(['Decorin Grunhork due', 'Malo', 'Rune']);   // no plan: three timed rows, soonest first
    expect(q2.map((x) => x.dueMs)).toEqual([NOW + S(30), NOW + S(38), NOW + S(45)]);
  });
  it('leaves out the pair rows the strip already shows big (skipKeys) and dedupes by key and label', () => {
    const q = P.tlQueue([open('Decorins', 'Decorin Grunhork', 30)], null,
      [tm('d1', 'Tagrin - Slow', 61), tm('d1', 'Tagrin - Slow', 61), tm('d9', 'tagrin - slow', 70)], NOW, ['pair:Decorins'], 3);
    expect(q.map((x) => x.label)).toEqual(['Tagrin - Slow']);
  });
  it('closed pairs (made / missed) never queue', () => {
    const q = P.tlQueue([{ kind: 'made', label: 'Decorins' }, { kind: 'missed', label: 'Tallon + Vallon', dueName: 'Vallon Zek', deadlineMs: NOW - 1 }], null, [], NOW, [], 3);
    expect(q).toEqual([]);
  });
});

describe('minimize + text size preferences', () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
  it('scale clamps to 0.8..1.8 in 0.1 steps and reads garbage as 1', () => {
    expect(P.TL_SCALE_MIN).toBe(0.8);
    expect(P.TL_SCALE_MAX).toBe(1.8);
    expect(P.tlClampScale(0.1)).toBe(0.8);
    expect(P.tlClampScale(9)).toBe(1.8);
    expect(P.tlClampScale('1.46')).toBe(1.5);
    for (const bad of [null, undefined, '', 'big', NaN]) expect(P.tlClampScale(bad)).toBe(1);
    let v = 1; for (let i = 0; i < 20; i++) v = P.tlStepScale(v, 1);
    expect(v).toBe(1.8);
    for (let i = 0; i < 20; i++) v = P.tlStepScale(v, -1);
    expect(v).toBe(0.8);
    expect(P.tlStepScale(1, 1)).toBe(1.1);
    expect(P.tlStepScale(1.1, -1)).toBe(1);
  });
  it('collapse and scale persist across a reload (same store), and default to expanded at 1.0', () => {
    const store = mem();
    expect(P.tlLoadPrefs(store)).toEqual({ collapsed: false, scale: 1 });
    P.tlSavePref(store, 'collapsed', '1');
    P.tlSavePref(store, 'scale', 1.4);
    expect(P.tlLoadPrefs(store)).toEqual({ collapsed: true, scale: 1.4 });
    P.tlSavePref(store, 'collapsed', '0');
    expect(P.tlLoadPrefs(store).collapsed).toBe(false);
    store.setItem('wp.tline.scale', '40');
    expect(P.tlLoadPrefs(store).scale).toBe(1.8);   // a hand-edited value is clamped on the way in
  });
  it('a store that throws (private window, blocked site data) or is missing never breaks the page', () => {
    const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(P.tlLoadPrefs(boom)).toEqual({ collapsed: false, scale: 1 });
    expect(() => P.tlSavePref(boom, 'collapsed', '1')).not.toThrow();
    expect(P.tlLoadPrefs(null)).toEqual({ collapsed: false, scale: 1 });
    expect(() => P.tlSavePref(null, 'scale', 1.2)).not.toThrow();
  });
});

describe('strip wiring: controls, plan source, hover handshake (comments stripped)', () => {
  const t = stripJs(TRIGGERS);
  const css = stripCss(TRIGGERS.slice(0, TRIGGERS.indexOf('</style>')));
  it('the toggle and A-/A+ are real buttons in the strip, outside the rebuilt body', () => {
    expect(TRIGGERS).toMatch(/<div id="tline"><button id="tl-toggle"[^>]*type="button"[^>]*>▾<\/button><div id="tl-body"><\/div><div id="tl-size"><button id="tl-sm"[^>]*>A−<\/button><button id="tl-lg"[^>]*>A\+<\/button>/);
    expect(css).toMatch(/#tline \.tl-btn\{pointer-events:auto/);          // the strip is click-through; only the buttons take the mouse
    expect(t).not.toMatch(/tlineEl\.innerHTML\s*=/);                       // the controls survive a rebuild
  });
  it('the text size is a CSS variable on the strip only, and the strip re-measures after a change', () => {
    expect(t).toMatch(/tlineEl\.style\.setProperty\('--tl-s'/);
    expect(t).not.toMatch(/documentElement\.style\.setProperty\('--tl-s'/);
    expect(css).toMatch(/font-size:calc\(22px \* var\(--tl-s\)\)/);
    const step = sliceBlock(t, 'function step(dir){', "sm.addEventListener('click'");
    expect(step).toMatch(/syncTlineH\(\)/);
    expect(t).toMatch(/tg\.addEventListener\('click', function\(\)\{[\s\S]*?syncTlineH\(\)/);
  });
  it('pop-raids.js is loaded lazily and never in a canvas panel', () => {
    expect(t).toMatch(/sc\.src = 'pop-raids\.js'/);
    expect(t).not.toMatch(/<script src="pop-raids\.js">/);
    expect(t).toMatch(/if \(PART \|\| !tlineEl\) return;/);                // tlineUpdate (the only caller of tlPop) bails in a panel
  });
  it('the controls are not wired in a canvas panel', () => {
    expect(t).toMatch(/if \(PART \|\| !tg \|\| !sm \|\| !lg\) return;/);
  });
});
