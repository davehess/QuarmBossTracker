// test/trigger-manager-settings-warn-loop.test.js — the trigger manager (agent dashboard, Triggers tab):
// open a trigger to see and edit its settings, a warning before the end of a countdown, and countdowns
// that repeat. Four member reports from beta testers, 2026-09-27..29:
//
//   FB-23  "When I click a trigger in the trigger manager, i should be able to edit/change it or at
//          least see the settings, currently I cannot do that."
//   FB-30  "I should be able to click one of these and look at the settings it has set for it."
//   FB-26  "Does triggers have this feature like EQLP? … the warn with time remaining line"
//   FB-31  "this NEEDS a loop timer setting added, absolutely needs."
//
// Where each one broke, found on the way:
//   · FB-23: the personal list's name cell was `class="name"`, which the dashboard's character-link
//     delegation turns into /character/<first word> — a trigger called "Rampage on me" opened a 404
//     page. There was no edit path at all (the form only ever added).
//   · FB-26: the warning has always worked for a personal trigger (the same _startTimer arms it for both
//     scopes); the form simply had no box for it, and the whole-list save would have stripped the field.
//   · FB-31: the timer engine had no repeat. The loop is state on the timer row, rolled at expiry.
//
// Run: npx vitest run test/trigger-manager-settings-warn-loop.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const require2 = createRequire(import.meta.url);
const agent = require2('../packages/wolfpack-logsync/index.js');
const agentSrc = readSource(AGENT_INDEX);
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

const T0 = Date.UTC(2026, 9, 7, 20, 0, 0);

// ── FB-31: the timer engine repeats ─────────────────────────────────────────────────────────────
describe('a looping timer (timer_loop) restarts when it ends', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    agent._activeTimers.clear();
  });
  afterEach(() => { vi.useRealTimers(); agent._activeTimers.clear(); });

  const AE = (over = {}) => ({ id: 'p_ae', name: 'Mob AE', timer_duration_sec: 60, _scope: 'personal',
    actions: [{ type: 'text_overlay', text: 'AE', color: 'red' }], ...over });
  const at = (sec) => vi.setSystemTime(T0 + sec * 1000);
  // by effect (the trigger's name): a timer started with captures gets the captures in its id
  const rows = () => agent._activeTimersSnapshot().filter(r => r.effect === 'Mob AE');

  it('a plain countdown still expires — nothing changed for it', () => {
    agent._startTimer(AE(), T0, false, null);
    expect(rows()).toHaveLength(1);
    at(61);
    expect(rows()).toHaveLength(0);
  });

  it('a looping one comes back at the full duration instead of expiring', () => {
    agent._startTimer(AE({ timer_loop: true }), T0, false, null);
    at(61);
    const [row] = rows();
    expect(row).toBeTruthy();
    expect(row.remaining_ms).toBe(59_000);   // 1s into the second round of 60
    expect(row.duration_sec).toBe(60);       // and the bar fills against the same 60, not a 59
  });

  it('keeps the beat: a poll that comes late does not push every later round back', () => {
    agent._startTimer(AE({ timer_loop: true }), T0, false, null);
    at(61); rows();
    at(95);
    // rounds end at 60, 120, 180 …; 95s is 35s into round two
    expect(rows()[0].remaining_ms).toBe(25_000);
    at(120); rows();
    at(125);
    expect(rows()[0].remaining_ms).toBe(55_000);
  });

  it('skips the rounds nobody was watching rather than replaying them', () => {
    agent._startTimer(AE({ timer_loop: true }), T0, false, null);
    at(60 * 7 + 10);   // seven rounds went by with every window closed
    expect(rows()[0].remaining_ms).toBe(50_000);
  });

  it('timer_loop_max = the most restarts: two repeats means three runs, then it ends', () => {
    agent._startTimer(AE({ timer_loop: true, timer_loop_max: 2 }), T0, false, null);
    at(61);  expect(rows()).toHaveLength(1);   // run 2
    at(121); expect(rows()).toHaveLength(1);   // run 3
    at(181); expect(rows()).toHaveLength(0);   // that was the last
  });

  it('a cap is spent by skipped rounds too, so unwatched time cannot buy extra runs', () => {
    agent._startTimer(AE({ timer_loop: true, timer_loop_max: 2 }), T0, false, null);
    at(60 * 7 + 10);
    expect(rows()).toHaveLength(0);
  });

  it('an unset or junk cap means no cap', () => {
    for (const lm of [undefined, null, 0, -4, 'soon']) {
      agent._activeTimers.clear();
      vi.setSystemTime(T0);
      agent._startTimer(AE({ timer_loop: true, timer_loop_max: lm }), T0, false, null);
      at(60 * 30 + 5);
      expect(rows(), `timer_loop_max=${lm}`).toHaveLength(1);
    }
  });

  it('only timer_loop === true loops — a stray truthy value does not', () => {
    for (const v of ['false', 'yes', 1, {}]) {
      agent._activeTimers.clear();
      vi.setSystemTime(T0);
      agent._startTimer(AE({ timer_loop: v }), T0, false, null);
      at(61);
      expect(rows(), `timer_loop=${JSON.stringify(v)}`).toHaveLength(0);
    }
  });

  it('the trigger firing again restarts the same row — loops never stack', () => {
    agent._startTimer(AE({ timer_loop: true, timer_loop_max: 5 }), T0, false, null);
    at(130); rows();
    expect(agent._activeTimers.get('p_ae').loops_done).toBe(2);
    agent._startTimer(AE({ timer_loop: true, timer_loop_max: 5 }), T0 + 130_000, false, null);
    expect(rows()).toHaveLength(1);
    expect(agent._activeTimers.get('p_ae').loops_done).toBe(0);
    expect(rows()[0].remaining_ms).toBe(60_000);
  });

  it('the mob dying stops it (its target is the mob)', () => {
    agent._startTimer(AE({ timer_loop: true }), T0, false, { target: 'Lord Nagafen' });
    at(61); expect(rows()).toHaveLength(1);
    agent._cancelTimersOnMobDeath('[Sun Oct 04 20:01:05 2026] Lord Nagafen has been slain by Aldenmar!');
    at(125);
    expect(rows()).toHaveLength(0);
  });

  it('✕ on the bar stops it: the cancel route deletes the row, and a deleted row has nothing to roll', () => {
    agent._startTimer(AE({ timer_loop: true }), T0, false, null);
    at(61); expect(rows()).toHaveLength(1);
    agent._activeTimers.delete('p_ae');   // what POST /api/timers/cancel does via _cancelTimer
    at(125);
    expect(rows()).toHaveLength(0);
  });

  it('a rehearsal fire stops after 3 repeats, so a test cannot tick on all night', () => {
    agent._startTimer(AE({ timer_loop: true }), T0, true, null);
    at(61);  expect(rows()).toHaveLength(1);
    at(181); expect(rows()).toHaveLength(1);   // 3 restarts used
    at(241); expect(rows()).toHaveLength(0);
  });

  it('a rehearsal honours a smaller cap and never a larger one', () => {
    agent._startTimer(AE({ timer_loop: true, timer_loop_max: 1 }), T0, true, null);
    expect(agent._activeTimers.get('p_ae').loop_max).toBe(1);
    agent._startTimer(AE({ timer_loop: true, timer_loop_max: 50 }), T0, true, null);
    expect(agent._activeTimers.get('p_ae').loop_max).toBe(3);
  });

  it('the warning comes back with every round: the countdown climbs back above the threshold', () => {
    // The overlay re-arms a warning when the remaining time is above its threshold again
    // (apps/mimic/triggers.html paintTimers) — so what the engine owes it is a row that, after the
    // roll, has the warnings AND a remaining time above them.
    agent._startTimer(AE({ timer_loop: true, warning_seconds: 10, warning_text: 'AE in 10' }), T0, false, null);
    at(52);
    expect(rows()[0].remaining_ms).toBe(8_000);          // inside the warning window
    at(61);
    const [row] = rows();
    expect(row.warnings).toEqual([{ at_ms: 10_000, text: 'AE in 10', tts: true }]);
    expect(row.remaining_ms).toBeGreaterThan(row.warnings[0].at_ms);
  });
});

// ── FB-26: the warning, for personal triggers exactly as for guild ones ─────────────────────────
describe('warning N seconds before the end — personal and guild alike', () => {
  const FIELDS = { id: 'x', name: 'Rage', pattern: 'rages', timer_duration_sec: 60,
    warning_seconds: 12, warning_text: 'RAGE SOON',
    actions: [{ type: 'text_overlay', text: 'RAGE', color: 'red' }] };

  beforeEach(() => agent._activeTimers.clear());
  afterEach(() => agent._activeTimers.clear());

  it('a personal row (compiled the way the loader and the save compile it) arms the warning', () => {
    const personal = agent._compilePersonalTrigger({ ...FIELDS });
    agent._startTimer(personal, Date.now(), false, null);
    expect(agent._activeTimersSnapshot()[0].warnings).toEqual([{ at_ms: 12_000, text: 'RAGE SOON', tts: true }]);
  });

  it('a guild row with the same columns arms the identical warning', () => {
    agent._startTimer({ ...FIELDS, _scope: 'guild' }, Date.now(), false, null);
    expect(agent._activeTimersSnapshot()[0].warnings).toEqual([{ at_ms: 12_000, text: 'RAGE SOON', tts: true }]);
  });

  it('warning_tts:false flashes the warning without speaking it', () => {
    agent._startTimer(agent._compilePersonalTrigger({ ...FIELDS, warning_tts: false }), Date.now(), false, null);
    expect(agent._activeTimersSnapshot()[0].warnings[0].tts).toBe(false);
  });

  it('the whole-list save carries the warning, its speak flag, and the repeat settings', async () => {
    const handler = sliceBlock(agentSrc, "if (req.url === '/api/personal-triggers' && req.method === 'POST') {",
      'stored: compiled.length, errors }));\n      }');
    async function post(triggers) {
      const res = { writeHead() {}, end(b) { this.body = b; return b; } };
      const run = new Function('req', 'res', '_readBody', '_compilePersonalTrigger', 'savePersonalTriggers',
        'BUILTIN_TIMER_KINDS', 'PERSONAL_CARRY_FIELDS', '_normCatalogMatch', 'ctx',
        'let _personalTriggers; return (async () => { ' + handler + ' })().then(() => { ctx.out = _personalTriggers; });');
      const ctx = {};
      await run({ url: '/api/personal-triggers', method: 'POST' }, res, async () => JSON.stringify({ triggers }),
        (t) => ({ ...t }), () => true, new Set(), agent.PERSONAL_CARRY_FIELDS, agent._normCatalogMatch, ctx);
      return ctx.out;
    }
    const [row] = await post([{ id: 'p1', name: 'AE', pattern: 'x', timer_duration_sec: 60,
      warning_seconds: 10, warning_text: 'AE soon', warning_tts: false, timer_loop: true, timer_loop_max: 4 }]);
    expect(row).toMatchObject({ warning_seconds: 10, warning_text: 'AE soon', warning_tts: false, timer_loop: true, timer_loop_max: 4 });
    // and a field the form cleared is simply absent, not stored as a blank
    const [bare] = await post([{ id: 'p2', name: 'AE', pattern: 'x', timer_duration_sec: 60 }]);
    expect(bare.warning_seconds).toBeUndefined();
    expect(bare.timer_loop).toBeUndefined();
  });
});

// ── FB-31 for guild triggers: an officer-set flag works with no agent change beyond this one ────────
describe('a guild trigger can carry the loop', () => {
  // Guild rows arrive as raw guild_triggers rows. The consumer spreads them, so a timer_loop column
  // reaches _startTimer untouched; this runs the shipped consumer to prove it, not a copy of it.
  const consume = sliceBlock(agentSrc, 'function _applyGuildTriggersResponse(resp) {', '\n}\nfunction pollGuildTriggers');
  const body = consume.slice(0, consume.lastIndexOf('function pollGuildTriggers'));
  const { apply, stats } = evalBlock(`
    const stats = { guildTriggers: [] };
    function compileTriggerPattern() { return { regex: /rages/i, conditions: [], aliases: {} }; }
    function _compileExcludes() { return []; }
    function _compileEndEarlyRegex() { return null; }
    ${body}
    const apply = _applyGuildTriggersResponse;
  `, ['apply', 'stats']);

  it('timer_loop and timer_loop_max survive ingestion and drive the timer', () => {
    apply({ version: 'v1', triggers: [{ id: 'g1', name: 'Mob AE', pattern: 'rages', timer_duration_sec: 60,
      timer_loop: true, timer_loop_max: 3, default_scope: 'guild', actions: [] }] });
    const g = stats.guildTriggers[0];
    expect(g.timer_loop).toBe(true);
    expect(g.timer_loop_max).toBe(3);
    agent._activeTimers.clear();
    agent._startTimer(g, Date.now(), false, null);
    expect(agent._activeTimers.get('g1')).toMatchObject({ loop: true, loop_max: 3, scope: 'guild' });
    agent._activeTimers.clear();
  });

  it('the recast bar a trigger also draws does not loop with it', () => {
    // The ::cd row is built from { ...t }, so it would inherit timer_loop unless it is reset there.
    agent._activeTimers.clear();
    agent._fireTriggerActions({ id: 'cd1', name: 'Mend', pattern: 'x', timer_duration_sec: 30, timer_loop: true,
      cooldown_timer_sec: 9, actions: [], _scope: 'personal', _noJournal: true }, {}, Date.now(), true);
    expect(agent._activeTimers.get('cd1')).toMatchObject({ loop: true });
    expect(agent._activeTimers.get('cd1::cd')).toMatchObject({ loop: false, duration_sec: 9 });
    agent._activeTimers.clear();
  });
});

// ── The dashboard's pure pieces, run from the shipped dashboard.html ────────────────────────────────
const pure = evalBlock([
  sliceBlock(dash, 'function esc(s) {', '\n'),
  sliceBlock(dash, 'var WP_TRIG_ZEAL =', ';\n'),
  'var _wpTrigOpen = {};',
  sliceBlock(dash, 'function wpTrigWarnings(t) {', '\n}\n'),
  sliceBlock(dash, 'function wpTrigSettingsHtml(t, scope) {', '\n}\n'),
  sliceBlock(dash, 'function wpTrigApplyForm(base, f) {', '\n}\n'),
].join('\n'), ['esc', 'WP_TRIG_ZEAL', 'wpTrigWarnings', 'wpTrigSettingsHtml', 'wpTrigApplyForm']);

const FORM = (over = {}) => ({ name: 'Mob AE', pattern: 'begins to cast', cooldown: 0, overlay: 'AE!', tts: '', color: 'red',
  duration: 5000, timerSec: 0, endEarly: '', zeal: null, warnSec: 0, warnText: '', warnTts: true, loop: false, loopMax: 0, ...over });

describe('wpTrigApplyForm — the form laid over a saved row', () => {
  it('a new trigger comes out exactly as the add-only form built it before', () => {
    expect(pure.wpTrigApplyForm({}, FORM({ timerSec: 18, endEarly: 'has been slain', tts: 'ae now',
      zeal: { field: 'target_hp_pct', op: '<', value: 40 } }))).toEqual({
      name: 'Mob AE', pattern: 'begins to cast', use_regex: true, enabled: true, cooldown_seconds: 0,
      actions: [{ type: 'text_overlay', text: 'AE!', color: 'red', duration_ms: 5000, tts: 'ae now' }],
      timer_duration_sec: 18, end_early_pattern: 'has been slain', end_use_regex: true,
      zeal_condition: { field: 'target_hp_pct', op: '<', value: 40 },
    });
  });

  it('writes the warning and the repeat when they are set, and nothing when they are not', () => {
    const on = pure.wpTrigApplyForm({}, FORM({ timerSec: 60, warnSec: 10, warnText: 'AE in 10', loop: true, loopMax: 5 }));
    expect(on).toMatchObject({ timer_duration_sec: 60, warning_seconds: 10, warning_text: 'AE in 10', timer_loop: true, timer_loop_max: 5 });
    expect(on.warning_tts).toBeUndefined();   // speaking is the default: stored only when switched off
    const off = pure.wpTrigApplyForm({}, FORM({ timerSec: 60 }));
    for (const k of ['warning_seconds', 'warning_text', 'warning_tts', 'timer_loop', 'timer_loop_max']) expect(off[k], k).toBeUndefined();
  });

  it('an unticked "speak it" is stored as warning_tts:false', () => {
    expect(pure.wpTrigApplyForm({}, FORM({ timerSec: 60, warnSec: 10, warnText: 'x', warnTts: false })).warning_tts).toBe(false);
  });

  it('a repeat with no cap stores no cap', () => {
    const r = pure.wpTrigApplyForm({ timer_loop: true, timer_loop_max: 9 }, FORM({ timerSec: 60, loop: true, loopMax: 0 }));
    expect(r.timer_loop).toBe(true);
    expect('timer_loop_max' in r).toBe(false);
  });

  describe('editing an imported trigger keeps what the form has no box for', () => {
    const IMPORTED = {
      id: 'p_imp', name: 'Tank buster', pattern: 'blasts', pattern_flags: 'i', use_regex: false, enabled: false,
      cooldown_seconds: 3, timer_duration_sec: 60, end_text: 'BUSTER DONE', bar_color: '#1f6feb', pinned: true,
      characters: ['aldenmar'], exclude_patterns: ['practice'], timer_warnings: [{ seconds: 10, text: 'ten' }, { seconds: 4, text: 'four' }],
      display_threshold_sec: 30, valid: true, import_error: 'old',
      actions: [
        { type: 'text_overlay', text: 'BUSTER', color: 'red', duration_ms: 4000, sticky: true, sound: 'ding.wav' },
        { type: 'discord', message: 'buster up' },
      ],
    };
    const edited = pure.wpTrigApplyForm(IMPORTED, FORM({ name: 'Tank buster', pattern: 'blasts', overlay: 'BUSTER NOW', color: 'gold',
      duration: 3000, cooldown: 3, timerSec: 60 }));

    it('everything the form does not show survives', () => {
      expect(edited).toMatchObject({ id: 'p_imp', use_regex: false, enabled: false, pattern_flags: 'i', end_text: 'BUSTER DONE',
        bar_color: '#1f6feb', pinned: true, characters: ['aldenmar'], exclude_patterns: ['practice'], display_threshold_sec: 30 });
      expect(edited.timer_warnings).toEqual(IMPORTED.timer_warnings);
    });
    it('only the first alert changes, and its sound and sticky stay', () => {
      expect(edited.actions[0]).toEqual({ type: 'text_overlay', text: 'BUSTER NOW', color: 'gold', duration_ms: 3000, sticky: true, sound: 'ding.wav' });
      expect(edited.actions[1]).toEqual({ type: 'discord', message: 'buster up' });
      expect(edited.actions).toHaveLength(2);
    });
    it('the flags the list adds on the way out are not saved back as settings', () => {
      expect('valid' in edited).toBe(false);
      expect('import_error' in edited).toBe(false);
    });
    it('does not edit the object it was given', () => {
      expect(IMPORTED.actions[0].text).toBe('BUSTER');
      expect(IMPORTED.valid).toBe(true);
    });
    it('clearing the alert text drops that alert and leaves the other one', () => {
      const r = pure.wpTrigApplyForm(IMPORTED, FORM({ overlay: '', timerSec: 60 }));
      expect(r.actions).toEqual([{ type: 'discord', message: 'buster up' }]);
    });
  });

  it('a row that had no alert (an imported timer-only trigger) gains one at the front when text is typed', () => {
    const r = pure.wpTrigApplyForm({ id: 'p_t', actions: [{ type: 'discord', message: 'm' }] }, FORM({ overlay: 'NOW' }));
    expect(r.actions.map(a => a.type)).toEqual(['text_overlay', 'discord']);
  });

  it('clearing the warning removes it, including its speak flag', () => {
    const r = pure.wpTrigApplyForm({ warning_seconds: 10, warning_text: 'x', warning_tts: false }, FORM({ timerSec: 60 }));
    for (const k of ['warning_seconds', 'warning_text', 'warning_tts']) expect(r[k], k).toBeUndefined();
  });

  it('turning the repeat off removes it and its cap', () => {
    const r = pure.wpTrigApplyForm({ timer_loop: true, timer_loop_max: 4 }, FORM({ timerSec: 60 }));
    expect(r.timer_loop).toBeUndefined();
    expect(r.timer_loop_max).toBeUndefined();
  });
});

describe('wpTrigWarnings — the list the settings view shows', () => {
  it('reads the list first, the single pair as the fallback, and sorts the earliest first', () => {
    expect(pure.wpTrigWarnings({ timer_warnings: [{ seconds: 4, text: 'a' }, { seconds: 10, text: 'b', tts: false }], warning_seconds: 30, warning_text: 'c' }))
      .toEqual([{ sec: 10, text: 'b', tts: false }, { sec: 4, text: 'a', tts: true }]);
    expect(pure.wpTrigWarnings({ warning_seconds: 12, warning_text: 'RAGE', warning_tts: false })).toEqual([{ sec: 12, text: 'RAGE', tts: false }]);
    expect(pure.wpTrigWarnings({})).toEqual([]);
  });
});

describe('wpTrigSettingsHtml — a trigger\'s settings, read-only', () => {
  const RICH = { id: 'p_1', name: 'Mob AE', pattern: '(?<mob>\\w+) begins to cast <Mass> Cancel', cooldown_seconds: 5,
    timer_duration_sec: 60, warning_seconds: 10, warning_text: 'AE in 10', timer_loop: true, timer_loop_max: 4,
    end_early_pattern: 'has been slain', characters: ['aldenmar'],
    actions: [{ type: 'text_overlay', text: 'CANCEL ON {mob}', color: 'gold', duration_ms: 4000, tts: 'cancel now' }] };

  it('lists the pattern, the alert, what is said, the countdown, the warning and the repeat', () => {
    const h = pure.wpTrigSettingsHtml(RICH, 'personal');
    expect(h).toContain('begins to cast');
    expect(h).toContain('CANCEL ON {mob}');
    expect(h).toContain('cancel now');
    expect(h).toContain('60s');
    expect(h).toMatch(/10s before the end: <b>AE in 10<\/b>/);
    expect(h).toContain('restarts itself when it ends, up to 4 times');
    expect(h).toContain('has been slain');
    expect(h).toContain('Aldenmar');
  });
  it('escapes what a pattern or a name can carry', () => {
    const h = pure.wpTrigSettingsHtml(RICH, 'personal');
    expect(h).toContain('&lt;Mass&gt;');
    expect(h).not.toContain('<Mass>');
  });
  it('says so when a countdown has no warning and does not repeat — so the setting can be found', () => {
    const h = pure.wpTrigSettingsHtml({ id: 'p_2', name: 'x', pattern: 'y', timer_duration_sec: 30, actions: [] }, 'personal');
    expect(h).toContain('no warning before the end');
    expect(h).toContain('no, it ends once');
  });
  it('shows no countdown rows for a trigger with no timer', () => {
    const h = pure.wpTrigSettingsHtml({ id: 'p_3', name: 'x', pattern: 'y', actions: [{ type: 'text_overlay', text: 'T' }] }, 'personal');
    expect(h).not.toContain('Countdown');
    expect(h).not.toContain('Warns');
    expect(h).not.toContain('Repeats');
  });
  it('a personal trigger offers Edit; a guild one offers the site, never an edit button', () => {
    const p = pure.wpTrigSettingsHtml(RICH, 'personal');
    expect(p).toContain('data-trig-edit="p_1"');
    const g = pure.wpTrigSettingsHtml({ ...RICH, id: 'a1b2-uuid', category: 'rampage', notes: 'verify next pull' }, 'guild');
    expect(g).not.toContain('data-trig-edit');
    expect(g).toContain('https://wolfpack.quest/admin/triggers?edit=a1b2-uuid');
    expect(g).toContain('Edit on wolfpack.quest');
    expect(g).toContain('rampage');
    expect(g).toContain('verify next pull');
  });
  it('warns that a Suggested row is rebuilt from its template when it is ticked again', () => {
    const h = pure.wpTrigSettingsHtml({ id: 'suggested:mob_rampage', name: 'Rampage', pattern: 'rampage', actions: [] }, 'personal');
    expect(h).toContain('puts the standard version back');
    expect(pure.wpTrigSettingsHtml({ id: 'p_9', name: 'mine', pattern: 'x', actions: [] }, 'personal')).not.toContain('standard version');
  });
  it('a timer-bar switch has nothing to edit and says where it is switched', () => {
    const h = pure.wpTrigSettingsHtml({ id: 'suggested:timer_lull', name: 'lulls', builtin_timer: 'lull', actions: [] }, 'personal');
    expect(h).not.toContain('data-trig-edit');
    expect(h).toContain('Suggested triggers');
  });
  it('reads a Zeal gauge trigger and a spell-catalog trigger in words', () => {
    expect(pure.wpTrigSettingsHtml({ id: 'z', name: 'HP', zeal_condition: { field: 'self_hp_pct', op: '<', value: 0 }, actions: [] }, 'personal'))
      .toContain('Your HP &lt; 0%');   // a value of 0 is a value, not a blank
    expect(pure.wpTrigSettingsHtml({ id: 'c', name: 'Mezzed', catalog_match: { on: 'you', cc: ['mez', 'charm'] }, actions: [] }, 'personal'))
      .toContain('mez / charm spell landing on you');
  });
  it('copes with a row that has almost nothing', () => {
    expect(() => pure.wpTrigSettingsHtml({}, 'personal')).not.toThrow();
    expect(() => pure.wpTrigSettingsHtml({ actions: [null, {}, { type: 'text_overlay' }] }, 'guild')).not.toThrow();
  });
});

// ── The wiring: what the page does with them ───────────────────────────────────────────────────
describe('the Triggers tab wiring', () => {
  const code = stripJs(dash);

  it('a personal trigger\'s name is a button that opens it, not a .name cell (that class is the character link)', () => {
    const list = sliceBlock(code, 'async function fetchAndRenderList(', "html += '</table>';");
    expect(list).toMatch(/class="trigname" data-trig-open=/);
    expect(list).not.toMatch(/<td class="name"/);
    expect(list).toMatch(/aria-expanded=/);
  });

  it('the guild list is its own card, repainted without touching the form above it', () => {
    const triggers = sliceBlock(code, 'function renderTriggers(s) {', '\n}\n');
    expect(triggers).toContain('<div id="wpGuildTriggers" class="card wide"></div>');
    expect(triggers).not.toContain('data-trig-copy');   // the rows moved with the card
    const card = sliceBlock(code, 'function renderGuildTriggersCard(s) {', '\n}\n');
    expect(card).toMatch(/data-trig-view=/);
    expect(card).not.toMatch(/class="name"/);
    const order = [...code.matchAll(/\['([a-z]+)', (render[A-Za-z]+)\]/g)].map(m => m[2]);
    expect(order.indexOf('renderGuildTriggersCard')).toBeGreaterThan(order.indexOf('renderTriggers'));
  });

  it('the form has the warning and repeat boxes, and a way back out of an edit', () => {
    const form = sliceBlock(code, 'function buildEditorHtml() {', "+ '</div>';\n  }");
    for (const id of ['trigNewWarnSec', 'trigNewWarnText', 'trigNewWarnTts', 'trigNewLoop', 'trigNewLoopMax', 'trigCancelBtn', 'trigFormTitle']) {
      expect(form, id).toContain('id="' + id + '"');
    }
  });

  it('a save checks the pattern first, because the whole-list save drops a row that will not compile', () => {
    const add = sliceBlock(code, 'async function onAdd() {', '\n  function onCancelEdit');
    expect(add).toMatch(/\/api\/triggers\/test/);
    expect(add.indexOf('/api/triggers/test')).toBeLessThan(add.indexOf("fetch('/api/personal-triggers', {"));
    // a warning needs a timer, shorter than it; a repeat needs a timer
    expect(add).toMatch(/warnSec >= timerSec/);
    expect(add).toMatch(/loop && !hasTimer/);
  });

  it('copying a guild trigger carries its warning and repeat into the form', () => {
    const copy = sliceBlock(code, 'function renderGuildTriggersCard(s) {', '\n}\n');
    for (const k of ['warn_sec', 'warn_text', 'warn_tts', 'timer_loop', 'timer_loop_max']) expect(copy, k).toContain(k + ':');
    const prefill = sliceBlock(code, 'function prefill(cfg) {', '\n  }');
    for (const id of ['trigNewWarnSec', 'trigNewWarnText', 'trigNewLoop', 'trigNewLoopMax']) expect(prefill, id).toContain(id);
  });
});

// ── The guild card, run ─────────────────────────────────────────────────────────────────────────
describe('renderGuildTriggersCard — an open row shows its settings and survives a repaint', () => {
  function build() {
    return evalBlock([
      'var out = null; var focused = null;',
      'var window = { __wpLastState: null };',
      'var document = { getElementById: function () { return { id: "wpGuildTriggers" }; }, querySelectorAll: function () { return []; } };',
      'function morphInto(el, html) { out = html; return true; }',
      sliceBlock(dash, 'function esc(s) {', '\n'),
      sliceBlock(dash, 'var WP_TRIG_ZEAL =', ';\n'),
      'var _wpTrigOpen = {};',
      sliceBlock(dash, 'function wpTrigWarnings(t) {', '\n}\n'),
      sliceBlock(dash, 'function wpTrigSettingsHtml(t, scope) {', '\n}\n'),
      sliceBlock(dash, 'function renderGuildTriggersCard(s) {', '\n}\n'),
      sliceBlock(dash, 'function wpGuildTrigToggle(key) {', '\n}\n'),
      'function html() { return out; }',
    ].join('\n'), ['renderGuildTriggersCard', 'wpGuildTrigToggle', 'html', 'window']);
  }
  const STATE = { guildTriggers: [
    { id: 'g-1', name: 'Rampage on me', category: 'rampage', pattern: 'rampages', cooldown_seconds: 3,
      timer_duration_sec: 60, timer_loop: true, warning_seconds: 10, warning_text: 'soon',
      actions: [{ type: 'text_overlay', text: 'RAMPAGE', color: 'red' }] },
    { id: 'g-2', name: 'Other', pattern: 'x', actions: [] },
  ] };

  it('is closed by default, with a name that is a button, not a character link', () => {
    const h = build();
    h.renderGuildTriggersCard(STATE);
    const out = h.html();
    expect(out).toContain('data-trig-view="g-1"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('trigdetail');
    expect(out).not.toContain('class="name"');
  });

  it('opens one row on a click and shows its settings, including the new warning and repeat rows', () => {
    const h = build();
    h.window.__wpLastState = STATE;
    h.wpGuildTrigToggle('g-1');
    const out = h.html();
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('trigdetail');
    expect(out).toContain('10s before the end');
    expect(out).toContain('restarts itself');
    expect(out).toContain('https://wolfpack.quest/admin/triggers?edit=g-1');
    expect((out.match(/class="trigdetail"/g) || [])).toHaveLength(1);   // only the one that was opened
  });

  it('a repaint with fresh data keeps it open; a second click closes it', () => {
    const h = build();
    h.window.__wpLastState = STATE;
    h.wpGuildTrigToggle('g-1');
    h.renderGuildTriggersCard({ guildTriggers: STATE.guildTriggers.slice() });   // the 2-second poll
    expect(h.html()).toContain('class="trigdetail"');
    h.wpGuildTrigToggle('g-1');
    expect(h.html()).not.toContain('trigdetail');
  });
});

// ── The add / edit form, run: the shipped editor code against a fake agent ──────────────────────────
// No browser in the suite, so the editor IIFE is cut out of dashboard.html and run with stand-ins for the
// page: inputs are plain objects, and fetch is an in-memory personal_triggers.json plus the pattern test.
describe('the add / edit form', () => {
  const IIFE = sliceBlock(dash, '(function(){\n  var mounted = false;\n  var listEl  = null;', '\n})();\n')
    .replace('window._wpTrigEditor = {', 'window._wpTrigEditor = { __t: { onAdd: onAdd, startEdit: startEdit, onCancelEdit: onCancelEdit, '
      + 'prefill: prefill, getEditing: function(){ return editing; } },');

  const DEFAULTS = { trigNewName: '', trigNewPattern: '', trigNewCooldown: '0', trigNewOverlay: '', trigNewTts: '',
    trigNewColor: 'red', trigNewDuration: '5000', trigNewTimerSec: '0', trigNewEndEarly: '', trigNewZealField: '',
    trigNewZealOp: '<', trigNewZealValue: '', trigNewWarnSec: '0', trigNewWarnText: '', trigNewLoopMax: '' };

  function rig(list) {
    const store = { list: JSON.parse(JSON.stringify(list || [])), posts: [], tests: [] };
    const els = {};
    function el(id) {
      if (!els[id]) {
        els[id] = { id, value: DEFAULTS[id] != null ? DEFAULTS[id] : '', checked: id === 'trigNewWarnTts', style: {}, textContent: '', tagName: 'INPUT', options: [] };
        if (id === 'trigNewColor') {
          els[id].tagName = 'SELECT';
          els[id].options = ['red', 'orange', 'gold', 'green', 'blue', 'purple', 'white'].map(v => ({ value: v }));
          els[id].add = (o) => els[id].options.push(o);
        }
      }
      return els[id];
    }
    const json = (b) => ({ ok: true, json: async () => b });
    async function fetch(url, opts) {
      if (url === '/api/personal-triggers' && !(opts && opts.method)) return json({ triggers: JSON.parse(JSON.stringify(store.list)) });
      if (url === '/api/personal-triggers') {
        const body = JSON.parse(opts.body);
        store.posts.push(body.triggers);
        store.list = body.triggers;
        return json({ ok: true });
      }
      if (url === '/api/triggers/test') {
        const b = JSON.parse(opts.body);
        store.tests.push(b);
        return json(b.pattern.indexOf('(unclosed') >= 0 ? { matched: false, error: 'Unterminated group' } : { matched: false });
      }
      throw new Error('unexpected fetch ' + url);
    }
    const win = {};
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', 'fetch', 'esc', 'wpTrigSettingsHtml', 'wpTrigApplyForm', 'wpTrigWarnings', '_wpTrigOpen',
      'alert', 'Option', IIFE)({ getElementById: el }, win, fetch, pure.esc, pure.wpTrigSettingsHtml, pure.wpTrigApplyForm,
      pure.wpTrigWarnings, {}, () => {}, function Option(t, v) { this.text = t; this.value = v; });
    const set = (o) => { for (const [k, v] of Object.entries(o)) { if (typeof v === 'boolean') el(k).checked = v; else el(k).value = String(v); } };
    return { store, el, set, t: win._wpTrigEditor.__t, msg: () => el('trigAddMsg').textContent };
  }

  const BASIC = { trigNewName: 'Mob AE', trigNewPattern: 'begins to cast', trigNewOverlay: 'AE!' };

  describe('adding', () => {
    it('saves a trigger with a warning before the end and a repeat', async () => {
      const r = rig([]);
      r.set({ ...BASIC, trigNewTimerSec: 60, trigNewWarnSec: 10, trigNewWarnText: 'AE in 10', trigNewLoop: true, trigNewLoopMax: 5 });
      await r.t.onAdd();
      expect(r.store.posts).toHaveLength(1);
      expect(r.store.posts[0][0]).toMatchObject({ name: 'Mob AE', pattern: 'begins to cast', timer_duration_sec: 60,
        warning_seconds: 10, warning_text: 'AE in 10', timer_loop: true, timer_loop_max: 5 });
      expect(r.msg()).toBe('Saved.');
      expect(r.el('trigNewWarnText').value).toBe('');   // and the form is ready for the next one
      expect(r.el('trigNewLoop').checked).toBe(false);
    });

    it('an unticked "speak" box is carried as warning_tts:false', async () => {
      const r = rig([]);
      r.set({ ...BASIC, trigNewTimerSec: 60, trigNewWarnSec: 10, trigNewWarnText: 'quiet', trigNewWarnTts: false });
      await r.t.onAdd();
      expect(r.store.posts[0][0].warning_tts).toBe(false);
    });

    it('still takes a plain trigger with neither setting', async () => {
      const r = rig([]);
      r.set(BASIC);
      await r.t.onAdd();
      const row = r.store.posts[0][0];
      expect(row).toMatchObject({ name: 'Mob AE', use_regex: true, enabled: true });
      expect(row.timer_loop).toBeUndefined();
      expect(row.warning_seconds).toBeUndefined();
    });

    for (const [label, over, words] of [
      ['a warning with no countdown', { trigNewWarnSec: 10, trigNewWarnText: 'x' }, 'countdown timer'],
      ['a warning that is not before the end', { trigNewTimerSec: 30, trigNewWarnSec: 30, trigNewWarnText: 'x' }, 'fewer seconds'],
      ['warning seconds with no text', { trigNewTimerSec: 60, trigNewWarnSec: 10 }, 'warning text'],
      ['warning text with no seconds', { trigNewTimerSec: 60, trigNewWarnText: 'x' }, 'how many seconds'],
      ['a repeat with no countdown', { trigNewLoop: true }, 'countdown timer'],
    ]) {
      it('refuses ' + label + ', and saves nothing', async () => {
        const r = rig([]);
        r.set({ ...BASIC, ...over });
        await r.t.onAdd();
        expect(r.store.posts).toHaveLength(0);
        expect(r.msg()).toContain(words);
      });
    }

    it('refuses a pattern that will not compile — the save would have dropped the row', async () => {
      const r = rig([{ id: 'keep', name: 'Keep me', pattern: 'x', actions: [] }]);
      r.set({ ...BASIC, trigNewPattern: 'a(unclosed' });
      await r.t.onAdd();
      expect(r.store.posts).toHaveLength(0);
      expect(r.msg()).toContain('will not compile');
    });
  });

  describe('editing', () => {
    const IMPORTED = { id: 'p_imp', name: 'Tank buster', pattern: 'blasts', pattern_flags: 'i', use_regex: true, enabled: true,
      cooldown_seconds: 3, timer_duration_sec: 60, end_text: 'BUSTER DONE', bar_color: '#1f6feb', characters: ['aldenmar'],
      warning_seconds: 12, warning_text: 'RAGE SOON', warning_tts: false, timer_loop: true, timer_loop_max: 3,
      actions: [{ type: 'text_overlay', text: 'BUSTER', color: 'yellow', duration_ms: 4000, tts: 'buster', sound: 'ding.wav' }] };
    const OTHER = { id: 'p_other', name: 'Other', pattern: 'o', actions: [{ type: 'text_overlay', text: 'O' }] };

    it('opening a trigger fills the form with everything it is set to, and says it is an edit', async () => {
      const r = rig([OTHER, IMPORTED]);
      await r.t.startEdit('p_imp');
      expect(r.t.getEditing().id).toBe('p_imp');
      expect(r.el('trigFormTitle').textContent).toContain('Editing: Tank buster');
      expect(r.el('trigAddBtn').textContent).toBe('Save changes');
      expect(r.el('trigCancelBtn').style.display).toBe('');
      expect(r.el('trigNewPattern').value).toBe('blasts');
      expect(r.el('trigNewOverlay').value).toBe('BUSTER');
      expect(r.el('trigNewTts').value).toBe('buster');
      expect(r.el('trigNewTimerSec').value).toBe('60');
      expect(r.el('trigNewWarnSec').value).toBe('12');
      expect(r.el('trigNewWarnText').value).toBe('RAGE SOON');
      expect(r.el('trigNewWarnTts').checked).toBe(false);
      expect(r.el('trigNewLoop').checked).toBe(true);
      expect(r.el('trigNewLoopMax').value).toBe('3');
    });

    it('a colour the dropdown lacks is kept, not turned red', async () => {
      const r = rig([IMPORTED]);
      await r.t.startEdit('p_imp');
      expect(r.el('trigNewColor').value).toBe('yellow');
    });

    it('saving replaces that one row in place and keeps every setting the form has no box for', async () => {
      const r = rig([OTHER, IMPORTED]);
      await r.t.startEdit('p_imp');
      r.set({ trigNewOverlay: 'BUSTER NOW', trigNewWarnSec: 8 });
      await r.t.onAdd();
      expect(r.store.posts).toHaveLength(1);
      const [first, saved] = r.store.posts[0];
      expect(first).toEqual(OTHER);                       // untouched
      expect(r.store.posts[0]).toHaveLength(2);           // replaced, not appended
      expect(saved).toMatchObject({ id: 'p_imp', end_text: 'BUSTER DONE', bar_color: '#1f6feb', characters: ['aldenmar'],
        warning_seconds: 8, warning_text: 'RAGE SOON', warning_tts: false, timer_loop: true, timer_loop_max: 3 });
      expect(saved.actions[0]).toEqual({ type: 'text_overlay', text: 'BUSTER NOW', color: 'yellow', duration_ms: 4000, tts: 'buster', sound: 'ding.wav' });
      expect(r.t.getEditing()).toBe(null);
      expect(r.el('trigAddBtn').textContent).toBe('Add trigger');
      expect(r.el('trigNewName').value).toBe('');
      expect(r.msg()).toBe('Saved.');
    });

    it('turning the warning and the repeat off in the form removes them from the row', async () => {
      const r = rig([IMPORTED]);
      await r.t.startEdit('p_imp');
      r.set({ trigNewWarnSec: 0, trigNewWarnText: '', trigNewLoop: false, trigNewLoopMax: '' });
      await r.t.onAdd();
      const saved = r.store.posts[0][0];
      for (const k of ['warning_seconds', 'warning_text', 'warning_tts', 'timer_loop', 'timer_loop_max']) expect(saved[k], k).toBeUndefined();
    });

    it('cancel puts the form back to adding, and saves nothing', async () => {
      const r = rig([IMPORTED]);
      await r.t.startEdit('p_imp');
      r.t.onCancelEdit();
      expect(r.t.getEditing()).toBe(null);
      expect(r.el('trigFormTitle').textContent).toContain('Add personal trigger');
      expect(r.el('trigCancelBtn').style.display).toBe('none');
      expect(r.el('trigNewName').value).toBe('');
      expect(r.store.posts).toHaveLength(0);
    });

    it('a trigger deleted while it was open is not recreated by the save', async () => {
      const r = rig([OTHER, IMPORTED]);
      await r.t.startEdit('p_imp');
      r.store.list = [OTHER];
      await r.t.onAdd();
      expect(r.store.posts).toHaveLength(0);
      expect(r.msg()).toContain('gone');
    });

    it('a typo in the pattern is caught before the save drops the trigger', async () => {
      const r = rig([IMPORTED]);
      await r.t.startEdit('p_imp');
      r.set({ trigNewPattern: 'blasts(unclosed' });
      await r.t.onAdd();
      expect(r.store.posts).toHaveLength(0);
      expect(r.store.list).toEqual([IMPORTED]);
      expect(r.t.getEditing().id).toBe('p_imp');   // still open, so they can fix it
    });

    it('an imported timer-only trigger (no alert) saves without inventing one', async () => {
      const timerOnly = { id: 'p_t', name: 'Timer only', pattern: 'x', timer_duration_sec: 60, actions: [] };
      const r = rig([timerOnly]);
      await r.t.startEdit('p_t');
      r.set({ trigNewWarnSec: 10, trigNewWarnText: 'ten' });
      await r.t.onAdd();
      const saved = r.store.posts[0][0];
      expect(saved.actions).toEqual([]);
      expect(saved.warning_seconds).toBe(10);
    });

    it('a spell-catalog trigger (no pattern) can be edited without one', async () => {
      const cat = { id: 'suggested:self_mezzed', name: 'Mezzed', pattern: '', catalog_match: { on: 'you', cc: ['mez'] },
        actions: [{ type: 'text_overlay', text: 'MEZZED!', color: 'red', duration_ms: 4000 }] };
      const r = rig([cat]);
      await r.t.startEdit('suggested:self_mezzed');
      r.set({ trigNewOverlay: 'YOU ARE MEZZED' });
      await r.t.onAdd();
      expect(r.store.posts[0][0]).toMatchObject({ catalog_match: { on: 'you', cc: ['mez'] }, pattern: '' });
      expect(r.store.posts[0][0].actions[0].text).toBe('YOU ARE MEZZED');
    });

    it('a length read from a capture counts as a timer for the warning check', async () => {
      const cap = { id: 'p_c', name: 'Captured', pattern: '(?<d>\\d+)s', timer_duration_capture: 'd', actions: [{ type: 'text_overlay', text: 'T' }] };
      const r = rig([cap]);
      await r.t.startEdit('p_c');
      r.set({ trigNewWarnSec: 5, trigNewWarnText: 'soon', trigNewLoop: true });
      await r.t.onAdd();
      expect(r.store.posts).toHaveLength(1);
      expect(r.store.posts[0][0]).toMatchObject({ timer_duration_capture: 'd', warning_seconds: 5, timer_loop: true });
    });

    it('copying a guild trigger ends an open edit and carries the guild warning and repeat in', async () => {
      const r = rig([IMPORTED]);
      await r.t.startEdit('p_imp');
      r.t.prefill({ name: 'Mob AE (copy)', pattern: 'p', overlay: 'AE', warn_sec: 10, warn_text: 'soon', warn_tts: true,
        timer_duration_sec: 60, timer_loop: true, timer_loop_max: 2 });
      expect(r.t.getEditing()).toBe(null);
      expect(r.el('trigAddBtn').textContent).toBe('Add trigger');
      expect(r.el('trigNewWarnSec').value).toBe('10');
      expect(r.el('trigNewLoop').checked).toBe(true);
      expect(r.el('trigNewLoopMax').value).toBe('2');
    });
  });
});
