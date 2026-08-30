// test/callout-dismissals.test.js — #207 callout overlay: dismissible lines,
// recorded dismissals, and the render invariants from
// docs/DESIGN-trigger-overlay-v2.md.
//
// What this pins, and why each one is a bug that has already cost us:
//
//  1. A dismissal is RECORDED. `dismissSticky()` used to remove the DOM row and
//     nothing else — "the single most honest signal we could collect is
//     discarded at the point of collection" (DESIGN-callout-overlay §Gap B).
//  2. `expired` is recorded too. Without the control group a dismissal COUNT
//     can never become a dismissal RATE: 3 dismissals is damning at 3 fires and
//     meaningless at 300 (§Gap C). It must fire on natural expiry ONLY — a
//     mob-death cancel is not a verdict on the callout.
//  3. A rehearsal / ⏪ replay drives the whole path (that is how this gets
//     tested without a raid) but must never enter the learning set.
//  4. A loot-auction chip's ✕ means "I've bid", not "this callout is noise".
//  5. One row per mob at RENDER time. Agent 3.5.56 fixed the two known causes
//     of eight identical slow rows; the overlay must not be ABLE to draw a
//     second one if a new cause appears (v2 §2).
//  6. A hard cap with a "+N more" tail, and loot chips exempt from it — an open
//     bid window is actionable and must never be pushed off-screen (#129).
//  7. The trigger overlay is bottom-anchored BY DEFAULT so the stack grows away
//     from centre screen (v2 §3/§3b), and toggling that off actually works.
//
// Run: npx vitest run test/callout-dismissals.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, ROOT, AGENT_INDEX, BOT_INDEX } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const botSrc   = readSource(BOT_INDEX);
const mainSrc  = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const overlay  = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));

// ── agent: the recorder + the expiry hook, sliced from the shipped source ───
const recorderBlock = sliceBlock(
  agentSrc,
  'const CALLOUT_FEEDBACK_RECENT_MAX',
  '\n  return out;\n}',            // end of _activeTimersSnapshot
);

function agent() {
  const harness = `
    const uploads = [];
    const AGENT_VERSION = '9.9.9';
    const _zealState = { Hitya: { updatedAt: Date.now() } };
    const _activeTimers = new Map();
    function enqueueUpload(kind, payload) { uploads.push({ kind, payload }); }
    ${recorderBlock}
    return { uploads, _activeTimers, _recordCalloutFeedback, _calloutFeedbackSnapshot,
             _flushCalloutVotes, _activeTimersSnapshot };
  `;
   
  return new Function(harness)();
}

const TIMER = (over = {}) => ({
  id: 'facb6fea|s=A Shissar Templar',
  trigger_id: 'facb6fea',
  trigger_name: 'Shaman Slow landed',
  target: 'A Shissar Templar',
  effect: 'Shaman Slow landed',
  started_at_ms: Date.now() - 12_000,
  ends_at_ms: Date.now() + 60_000,
  duration_sec: 180,
  show_at_ms: 0,
  test: false,
  ...over,
});

describe('a dismissal becomes a signal, not a DOM removal', () => {
  it('records the direction, the trigger and a derivable latency', () => {
    const a = agent();
    const entry = a._recordCalloutFeedback({ direction: 'dismissed', timer: TIMER(), source: 'chip_x' });
    expect(entry.direction).toBe('dismissed');
    expect(entry.trigger).toBe('Shaman Slow landed');
    // ~12s: "read it, acted, then cleared it", NOT "swatted it instantly".
    // The two are opposite verdicts and a plain count conflates them.
    expect(entry.latency_ms).toBeGreaterThanOrEqual(11_000);
    expect(a._calloutFeedbackSnapshot().dismissed).toBe(1);
  });

  it('queues a vote whose fired_at/voted_at make the latency computable in SQL', () => {
    const a = agent();
    a._recordCalloutFeedback({ direction: 'dismissed', timer: TIMER(), source: 'chip_x' });
    a._flushCalloutVotes();
    expect(a.uploads).toHaveLength(1);
    expect(a.uploads[0].kind).toBe('trigger_feedback');
    const v = a.uploads[0].payload.votes[0];
    expect(v.direction).toBe('dismissed');
    expect(v.trigger_id).toBe('facb6fea');       // the TRIGGER, not the composite timer id
    expect(v.note).toBe('chip_x');
    expect(v.voter_character).toBe('Hitya');
    expect(new Date(v.voted_at) - new Date(v.fired_at)).toBeGreaterThanOrEqual(11_000);
  });

  it('batches — one upload for many votes, not one POST per row', () => {
    // `expired` fires once per countdown per raider. A POST each would put
    // hundreds of tiny requests on the ingest surface for a signal only ever
    // read in aggregate.
    const a = agent();
    for (let i = 0; i < 24; i++) a._recordCalloutFeedback({ direction: 'expired', timer: TIMER() });
    expect(a.uploads, 'still buffered under the batch size').toHaveLength(0);
    a._recordCalloutFeedback({ direction: 'expired', timer: TIMER() });
    expect(a.uploads, 'flushed at the batch size').toHaveLength(1);
    expect(a.uploads[0].payload.votes).toHaveLength(25);
  });

  it('a rehearsal is exercised end to end but never enters the learning set', () => {
    // This is the local test path: Rehearse → chip → ✕ → visible counters. It
    // must be visible locally and invisible upstream.
    const a = agent();
    a._recordCalloutFeedback({ direction: 'dismissed', timer: TIMER({ test: true }), source: 'chip_x' });
    a._flushCalloutVotes();
    const snap = a._calloutFeedbackSnapshot();
    expect(snap.dismissed, 'the tester can see it happened').toBe(1);
    expect(snap.recent[0].test).toBe(true);
    expect(a.uploads, 'a test drive is not a raider verdict').toHaveLength(0);
  });

  it('a loot auction chip is a bid window, not a callout', () => {
    const a = agent();
    const out = a._recordCalloutFeedback({
      direction: 'dismissed', timer: TIMER({ kind: 'loot', trigger_name: null, effect: 'Cloak of Flames' }),
    });
    expect(out).toBeNull();
    expect(a._calloutFeedbackSnapshot().dismissed).toBe(0);
  });

  it('only `expired` joins `dismissed` — a typo cannot invent a direction', () => {
    const a = agent();
    expect(a._recordCalloutFeedback({ direction: 'expired',  timer: TIMER() }).direction).toBe('expired');
    expect(a._recordCalloutFeedback({ direction: 'dismissd', timer: TIMER() }).direction).toBe('dismissed');
    const snap = a._calloutFeedbackSnapshot();
    expect(snap.expired).toBe(1);
    expect(snap.dismissed).toBe(1);
  });
});

describe('the control group: expired', () => {
  it('a countdown that aged out untouched is recorded exactly once', () => {
    const a = agent();
    a._activeTimers.set('t1', TIMER({ ends_at_ms: Date.now() - 1 }));
    expect(a._activeTimersSnapshot()).toHaveLength(0);
    expect(a._activeTimersSnapshot(), 'the row is gone, not re-counted').toHaveLength(0);
    const snap = a._calloutFeedbackSnapshot();
    expect(snap.expired).toBe(1);
    expect(snap.dismissed).toBe(0);
  });

  it('a live countdown is not recorded, and still renders', () => {
    const a = agent();
    a._activeTimers.set('t1', TIMER());
    expect(a._activeTimersSnapshot()).toHaveLength(1);
    expect(a._calloutFeedbackSnapshot().expired).toBe(0);
  });

  it('a mob-death cancel is not an "expired" — the callout did its job', () => {
    // _cancelTimersOnMobDeath deletes the row itself, so it must never reach
    // the snapshot's expiry branch. Same for a user dismissal, which is
    // recorded as `dismissed` at the cancel endpoint.
    const a = agent();
    a._activeTimers.set('t1', TIMER());
    a._activeTimers.delete('t1');
    a._activeTimersSnapshot();
    expect(a._calloutFeedbackSnapshot().expired).toBe(0);
  });
});

// ── GINA's {COUNTER} is not an identity ────────────────────────────────────
// Found while building #207. `_fireTriggerActions` injects `counter` (this
// client's own fire tally) into the capture bag on every fire, and it sorts
// alphabetically ahead of the usual capture names — so it re-created BOTH bugs
// the 2026-08-10 fix closed, plus one of its own. Everything the overlay work
// depends on keys off `target`, so this is load-bearing for the collapse
// invariant above, not a drive-by.
describe('the fire counter never becomes part of a timer identity', () => {
  const helpers = sliceBlock(agentSrc, 'const _NON_SEMANTIC_CAPTURES', '\n  return out;\n}');
  const startTimer = sliceBlock(agentSrc, 'function _startTimer(t, tsMs, isTest, captures)', '\n}');
  function build() {
     
    return new Function(`
      const _activeTimers = new Map();
      const stats = {};
      function _timerDurationSec(t) { return Number(t.timer_duration_sec) || 0; }
      function _timerWarnings() { return []; }
      ${helpers}
      ${startTimer}
      return { _startTimer, _activeTimers, _semanticCaptures };
    `)();
  }
  const SLOW = { id: 'facb6fea', name: 'Shaman Slow landed', timer_duration_sec: 180 };
  const bag = (counter, mob) => ({ '0': 'x', L: 'x', l: 'x', c: 'Hitya', counter, s: mob });

  it('the row is labelled with the MOB, not the counter', () => {
    // counter sorts before `s`, so the target fallback picked it — and on the
    // first fire the counter is 0, which is falsy, so the label lost its mob
    // entirely: "null - Shaman Slow landed".
    const h = build();
    h._startTimer(SLOW, Date.now(), false, bag(0, 'A Shissar Templar'));
    const row = [...h._activeTimers.values()][0];
    expect(row.target).toBe('A Shissar Templar');
    expect(row.name).toBe('A Shissar Templar - Shaman Slow landed');
  });

  it('a re-slow on the same mob resets ONE row even as the counter climbs', () => {
    // The counter bumps on every live fire, so captureSuffix differed per fire
    // and any timer trigger without timer_key_capture duplicated its row —
    // the original P1 by another route.
    const h = build();
    h._startTimer(SLOW, Date.now(), false, bag(1, 'A Shissar Templar'));
    h._startTimer(SLOW, Date.now(), false, bag(2, 'A Shissar Templar'));
    h._startTimer(SLOW, Date.now(), false, bag(3, 'A Shissar Templar'));
    expect(h._activeTimers.size).toBe(1);
  });

  it('two observers of one event build the SAME relay key', () => {
    // Each client holds its own tally, so the relay dedup key differed between
    // observers — REST IN PEACE spoken twice, again.
    const h = build();
    const mine   = JSON.stringify(h._semanticCaptures({ victim: 'Hitya', counter: 3, L: 'a' }));
    const theirs = JSON.stringify(h._semanticCaptures({ victim: 'Hitya', counter: 41, L: 'b' }));
    expect(mine).toBe(theirs);
  });
});

// ── overlay: the render invariants ─────────────────────────────────────────
const renderBlock = sliceBlock(
  overlay,
  '  const TIMER_SLOW_RX',
  'return { visible: loot.concat(shown), hidden: rest.length - shown.length };\n  }',
);
function render() {
   
  return new Function(renderBlock + '\nreturn { timerEffectClass, collapseTimers, splitVisible, MAX_TIMER_ROWS };')();
}
const CHIP = (over = {}) => ({ id: 'x', target: 'A Shissar Templar', effect: 'Shaman Slow landed', remaining_ms: 60_000, ...over });

describe('one row per mob (v2 §2)', () => {
  it('eight slow fires on ONE mob collapse to a single row', () => {
    // The Ssra wall of rows. The upstream causes are fixed; this is the
    // invariant that means a NEW cause still cannot draw a second bar.
    const r = render();
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(CHIP({ id: 'id' + i, remaining_ms: 60_000 + i * 1000 }));
    const out = r.collapseTimers(rows);
    expect(out).toHaveLength(1);
    expect(out[0].remaining_ms, 'the longest-remaining survives').toBe(67_000);
  });

  it('different mobs keep their own rows', () => {
    const r = render();
    expect(r.collapseTimers([CHIP({ id: 'a' }), CHIP({ id: 'b', target: 'a temple skirmisher' })])).toHaveLength(2);
  });

  it('same mob, different effect classes → two rows (only slows collapse)', () => {
    const r = render();
    const out = r.collapseTimers([CHIP({ id: 'a' }), CHIP({ id: 'b', effect: 'Death touch' })]);
    expect(out).toHaveLength(2);
  });

  it('a targetless countdown never collapses into another', () => {
    // Feign Death CD, "Casting Spell" bars etc. carry no mob — collapsing them
    // by effect alone would silently eat independent timers.
    const r = render();
    const out = r.collapseTimers([
      CHIP({ id: 'a', target: null, effect: 'Slow CD' }),
      CHIP({ id: 'b', target: '',   effect: 'Slow CD' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('classifies the labels the guild actually uses', () => {
    const r = render();
    expect(r.timerEffectClass('Shaman Slow landed')).toBe('slow');
    expect(r.timerEffectClass('SHM SLOW')).toBe('slow');
    expect(r.timerEffectClass('Slowed')).toBe('slow');
    expect(r.timerEffectClass('Death touch')).toBeNull();
    expect(r.timerEffectClass(undefined)).toBeNull();
  });
});

describe('hard cap + "+N more" (v2 §3)', () => {
  it('caps the visible rows and reports the remainder', () => {
    const r = render();
    const rows = [];
    for (let i = 0; i < 10; i++) rows.push(CHIP({ id: 'id' + i, target: 'mob' + i }));
    const split = r.splitVisible(rows);
    expect(split.visible).toHaveLength(r.MAX_TIMER_ROWS);
    expect(split.hidden).toBe(10 - r.MAX_TIMER_ROWS);
  });

  it('keeps the HEAD of the list — the agent sorts pinned-then-soonest', () => {
    const r = render();
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push(CHIP({ id: 'id' + i, target: 'mob' + i }));
    expect(r.splitVisible(rows).visible.map(t => t.id)).toEqual(['id0','id1','id2','id3','id4','id5']);
  });

  it('an open loot auction is never capped away (#129)', () => {
    const r = render();
    const rows = [];
    for (let i = 0; i < 9; i++) rows.push(CHIP({ id: 'id' + i, target: 'mob' + i }));
    rows.push(CHIP({ id: 'loot|sig', kind: 'loot', target: null, effect: 'Cloak of Flames' }));
    const split = r.splitVisible(rows);
    expect(split.visible.some(t => t.kind === 'loot'), 'a bid window a raider cannot see is a lost item').toBe(true);
    expect(split.visible).toHaveLength(r.MAX_TIMER_ROWS + 1);
    expect(split.hidden, 'loot does not inflate the overflow count').toBe(3);
  });

  it('nothing hidden → no overflow row', () => {
    const r = render();
    expect(r.splitVisible([CHIP({ id: 'a' })]).hidden).toBe(0);
  });
});

describe('the overlay surface itself', () => {
  it('EVERY countdown carries a ✕, not only the ones the server marks dismissible', () => {
    // ⚠ This used to match the COMMENT "#207: EVERY countdown gets a ✕" —
    // caught by the 2026-08-30 comment-strip sweep: deleting the ✕ code while
    // keeping the comment left it green. Assert the code that builds the ✕.
    expect(overlay).toMatch(/x\.className = 'timer-x'/);
    expect(overlay).toMatch(/x\.textContent = '✕'/);
    expect(overlay).toMatch(/dismissTimer\(t\.id\)/);
    expect(overlay, 'the #107 loot-only gate is gone').not.toMatch(/if \(t\.dismissible\)\{/);
  });

  it('the ✕, the 🗑 clear-all and the sticky row all do the hover handshake', () => {
    // Locked overlays are click-through: without the handshake the click falls
    // through to EQ and "the button does nothing" (CLAUDE.md checklist item 3).
    const clearBtn = sliceBlock(overlay, "  var clearBtn = document.getElementById('clear-btn');", '\n  }');
    expect(clearBtn).toMatch(/mouseenter[\s\S]*overlayHoverInteractive\(true\)/);
    expect(clearBtn).toMatch(/mouseleave[\s\S]*overlayHoverInteractive\(false\)/);
    expect(clearBtn).toMatch(/clearAllCallouts\(\)/);
    const chipX = sliceBlock(overlay, '        // #207: EVERY countdown gets a ✕', 'row.appendChild(x);');
    expect(chipX).toMatch(/mouseenter[\s\S]*overlayHoverInteractive\(true\)/);
    expect(chipX).toMatch(/mouseleave[\s\S]*overlayHoverInteractive\(false\)/);
  });

  it('the clear-all button sits clear of the fixed ✕ gutter', () => {
    // The Buff queue lost a click to exactly this (CLAUDE.md): anything at the
    // title bar's right edge lands under the fixed ✕.
    expect(overlay).toMatch(/#clear-btn\{position:fixed;top:6px;right:28px/);
    expect(overlay).toMatch(/#hide-btn\{position:fixed;top:6px;right:6px/);
  });

  it('the timer stack is bottom-anchored and grows upward', () => {
    expect(overlay).toMatch(/#timers\{position:fixed;bottom:8px/);
    expect(overlay).toMatch(/flex-direction:column-reverse/);
    expect(overlay, 'the old top-anchored stack is gone').not.toMatch(/#timers\{position:fixed;top:34px/);
  });

  it('dismissing tells the agent WHY, so the row can be attributed', () => {
    expect(overlay).toMatch(/reason: 'chip_x'/);
    expect(overlay).toMatch(/all: true, reason: 'clear_all'/);
    // A sticky row that ages out is the control group, not a dismissal.
    expect(overlay).toMatch(/dismissSticky\(key, 'expired'\)/);
  });
});

// ── main.js: bottom-anchored by default ────────────────────────────────────
const growUpBlock = sliceBlock(mainSrc, 'const _GROW_UP_DEFAULT_KEYS', '_GROW_UP_DEFAULT_KEYS.has(key);\n}');
function growUp() {
   
  return new Function(growUpBlock + '\nreturn { _growUpSetting, _GROW_UP_DEFAULT_KEYS };')();
}

describe('the trigger overlay is bottom-anchored by default', () => {
  it('defaults ON for the trigger overlay and OFF for everything else', () => {
    const g = growUp();
    expect(g._growUpSetting({}, 'trigger')).toBe(true);
    expect(g._growUpSetting({}, 'hud')).toBe(false);
    expect(g._growUpSetting({}, null)).toBe(false);
  });

  it('an explicit choice wins in BOTH directions', () => {
    const g = growUp();
    expect(g._growUpSetting({ overlayGrowUp: { trigger: false } }, 'trigger')).toBe(false);
    expect(g._growUpSetting({ overlayGrowUp: { hud: true } }, 'hud')).toBe(true);
  });

  it('the ⬆ toggle flips the EFFECTIVE value, not the raw map entry', () => {
    // `map[key] = !map[key]` on a default-on overlay computes true from
    // undefined, so the first click would look like it did nothing.
    const handler = sliceBlock(mainSrc, "ipcMain.handle('wp-growup-toggle'", '\n});');
    expect(handler).toMatch(/map\[key\] = !_growUpSetting\(cfg, key\);/);
    expect(handler).not.toMatch(/map\[key\] = !map\[key\];/);
  });

  it('the menu checkbox reads the same helper as the resize path', () => {
    expect(mainSrc).toMatch(/growUp: _growUpSetting\(cfg, key\),/);
  });
});

// ── the durable half: the bot + the migration ──────────────────────────────
describe('the two implicit directions reach the table', () => {
  it('the bot accepts them from one shared list', () => {
    expect(botSrc).toMatch(/const TRIGGER_FEEDBACK_DIRECTIONS = \['earlier', 'good', 'too_early', 'dismissed', 'expired'\];/);
    expect(botSrc).toMatch(/TRIGGER_FEEDBACK_DIRECTIONS\.includes\(String\(v\.direction\)\)/);
    expect(botSrc, 'the hard-coded three are gone').not.toMatch(/\['earlier','good','too_early'\]\.includes\(String\(v\.direction\)\)/);
  });

  it('the agent endpoint accepts them and funnels them into one recorder', () => {
    expect(agentSrc).toMatch(/if \(dir === 'dismissed' \|\| dir === 'expired'\)/);
  });

  it('the migration widens the CHECK constraint idempotently', () => {
    // Without this the insert is REJECTED and the agent's durable queue retries
    // a row that can never land.
    const sql = readSource(path.join(ROOT, 'supabase', 'migrations',
      '20260811120000_trigger_feedback_dismissal_directions.sql'));
    expect(sql).toMatch(/drop constraint if exists trigger_timing_feedback_direction_check/);
    for (const d of ['earlier', 'good', 'too_early', 'dismissed', 'expired']) {
      expect(sql).toContain(`'${d}'::text`);
    }
  });
});
