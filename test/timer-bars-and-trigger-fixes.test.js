// The bard co-leader's EQLogParser switch (2026-09-26): "the only thing i need
// to get is the recharm tick count down timer … and i could get rid of
// eqlogparser i think", plus "i added 'rampage on you' to personal triggers,
// then deleted it … now i cant get it back" and "the 'charm break' is a few
// seconds late".
//
// Every test below drives the SHIPPED agent (require) or a slice of the shipped
// overlay, so a comment cannot satisfy it.
//
// Run: npx vitest run test/timer-bars-and-trigger-fixes.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, stripCss, ROOT, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
// Real lines: the rampage and charm-break lines are from test/fixtures/golden/raid-pull.log.
const RAMPAGE_ON_ME    = '[Sun Aug 02 20:41:34 2026] Lord of Ire goes on a RAMPAGE against Fenrisk!';
const RAMPAGE_ON_OTHER = '[Sun Aug 02 20:41:34 2026] Lord of Ire goes on a RAMPAGE against Torvahk!';
const CHARM_BROKE      = '[Sun Aug 02 20:41:38 2026] Your charm spell has worn off.';

function tpl(id) { return agent.SUGGESTED_TRIGGERS.find(t => t.id === id); }
function compiledFromTemplate(id) { return agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl(id))); }
function firesFor(name) { return agent._fireLog.filter(f => f.name === name).length; }

beforeEach(() => {
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
  agent._charmTickTracker.clear();
  agent._buffLandingsByTarget.clear();
  agent._builtinTimerHidden.clear();
  agent._setPersonalTriggersForTest([]);
});

describe('an unticked personal trigger does not fire', () => {
  it('live line evaluator skips enabled:false and still fires enabled:true', () => {
    const on  = agent._compilePersonalTrigger({ id: 'p_on',  name: 'tf-on',  pattern: 'Your charm spell has worn off', enabled: true,
      actions: [{ type: 'text_overlay', text: 'X', duration_ms: 1000 }] });
    const off = agent._compilePersonalTrigger({ id: 'p_off', name: 'tf-off', pattern: 'Your charm spell has worn off', enabled: false,
      actions: [{ type: 'text_overlay', text: 'X', duration_ms: 1000 }] });
    agent._setPersonalTriggersForTest([on, off]);
    const a = firesFor('tf-on'), b = firesFor('tf-off');
    agent.evaluateTriggersAgainstLine(CHARM_BROKE, Date.now());
    expect(firesFor('tf-on')).toBe(a + 1);
    expect(firesFor('tf-off')).toBe(b);
  });
  it('replay evaluator skips enabled:false', () => {
    const off = agent._compilePersonalTrigger({ id: 'p_off2', name: 'tf-off2', pattern: 'Your charm spell has worn off', enabled: false,
      actions: [{ type: 'text_overlay', text: 'X', duration_ms: 1000 }] });
    agent._setPersonalTriggersForTest([off]);
    expect(agent._replayEvaluateLine(CHARM_BROKE, Date.now(), { cooldowns: new Map() })).toBe(false);
    agent._setPersonalTriggersForTest([{ ...off, enabled: true }]);
    expect(agent._replayEvaluateLine(CHARM_BROKE, Date.now(), { cooldowns: new Map() })).toBe(true);
  });
  it('Zeal gauge evaluator skips enabled:false', () => {
    const mk = (id, enabled) => agent._compilePersonalTrigger({ id, name: id, pattern: '', enabled,
      zeal_condition: { field: 'self_hp_pct', op: '<=', value: 30 }, actions: [{ type: 'text_overlay', text: 'LOW', duration_ms: 1000 }] });
    agent._setPersonalTriggersForTest([mk('tf-zeal-on', true), mk('tf-zeal-off', false)]);
    agent._setZealStateForTest(ME, { self_hp_pct: 10 });
    const a = firesFor('tf-zeal-on'), b = firesFor('tf-zeal-off');
    agent._evaluateZealConditions(ME, Date.now());
    agent._setZealStateForTest(ME, null);
    expect(firesFor('tf-zeal-on')).toBe(a + 1);
    expect(firesFor('tf-zeal-off')).toBe(b);
  });
});

describe('Suggested "Rampage on you" matches the line EQ actually prints', () => {
  it('fires on a rampage against you, not against someone else', () => {
    const t = compiledFromTemplate('mob_rampage');
    expect(t._regex.test(RAMPAGE_ON_ME)).toBe(true);
    expect(t._regex.test(RAMPAGE_ON_OTHER)).toBe(false);
  });
  it('the retired pattern really was dead on that line', () => {
    const old = agent.SUGGESTED_RETIRED_PATTERNS.mob_rampage[0];
    expect(new RegExp(old, 'i').test(RAMPAGE_ON_ME)).toBe(false);
  });
  it('a row saved with the dead pattern is moved to the new one on load; a hand edit is not', () => {
    const saved = { id: 'suggested:mob_rampage', pattern: agent.SUGGESTED_RETIRED_PATTERNS.mob_rampage[0] };
    expect(agent._migrateRetiredSuggestedPattern(saved)).toBe(true);
    expect(saved.pattern).toBe(tpl('mob_rampage').pattern);
    const edited = { id: 'suggested:mob_rampage', pattern: 'RAMPAGE against (?:Fenrisk|Torvahk)' };
    expect(agent._migrateRetiredSuggestedPattern(edited)).toBe(false);
    expect(edited.pattern).toBe('RAMPAGE against (?:Fenrisk|Torvahk)');
  });
});

describe('{c} in a personal trigger re-binds once the watched characters are known', () => {
  it('a trigger compiled before the log scan starts matching after the recompile', () => {
    agent._setWatchedLogsForTest([]);
    agent._recompilePersonalTriggersForChars();            // key '' — the startup state
    const early = compiledFromTemplate('mob_rampage');       // {c} left literal
    agent._setPersonalTriggersForTest([early]);
    expect(agent._getPersonalTriggersForTest()[0]._regex.test(RAMPAGE_ON_ME)).toBe(false);
    agent._setWatchedLogsForTest([{ character: ME }]);
    expect(agent._recompilePersonalTriggersForChars()).toBe(true);
    expect(agent._getPersonalTriggersForTest()[0]._regex.test(RAMPAGE_ON_ME)).toBe(true);
    expect(agent._recompilePersonalTriggersForChars()).toBe(false);   // unchanged set → no work
  });
});

describe('Suggested "Your charm broke" fires on the log line itself', () => {
  it('matches the bard\'s real break line', () => {
    expect(compiledFromTemplate('self_charm_broke')._regex.test(CHARM_BROKE)).toBe(true);
  });
});

describe('charm mob-tick anchor is not reset by the Zeal "still alive" poll', () => {
  it('keeps last_tick_at at the land, records the sighting separately', () => {
    const landed = Date.now() - 20_000;
    agent._bumpCharmTick('a fear touched drolvarg', ME, 'land', landed);
    agent._setZealStateForTest(ME, { gauges: [{ slot: 16, text: 'a fear touched drolvarg' }] });
    agent._reconcileGaugeCharms();
    const c = agent._charmTickTracker.get('a fear touched drolvarg');
    expect(c.last_tick_at).toBe(landed);
    expect(Date.now() - c.last_seen_at).toBeLessThan(1000);
    agent._setZealStateForTest(ME, null);
  });
  it('a pet seen a moment ago is not called broken just because the land was long ago', () => {
    agent._bumpCharmTick('a fear touched drolvarg', ME, 'land', Date.now() - 60_000);
    const c = agent._charmTickTracker.get('a fear touched drolvarg');
    c.last_seen_at = Date.now() - 1000;
    agent._setZealStateForTest(ME, { gauges: [{ slot: 6, text: 'Lord of Ire' }] });   // pet slot empty this frame
    agent._reconcileGaugeCharms();
    expect(agent._charmTickTracker.get('a fear touched drolvarg').is_active).toBe(true);
    c.last_seen_at = Date.now() - 7000;                                                  // gone past the grace
    agent._reconcileGaugeCharms();
    expect(agent._charmTickTracker.get('a fear touched drolvarg').is_active).toBe(false);
    agent._setZealStateForTest(ME, null);
  });
});

describe('mob tick: learned from DoT ticks and log breaks, not from the charm landing', () => {
  // A mob whose tick falls 400 ms into a second. The agent reads the log
  // ~300 ms after each line is written.
  const T0 = Date.UTC(2026, 8, 26, 22, 0, 0) + 400;
  const sec = (ms) => Math.floor(ms / 1000) * 1000;
  const stamp = (ms) => '[Sat Sep 26 ' + new Date(sec(ms)).toISOString().slice(11, 19) + ' 2026] ';
  const dot = (ms, src) => stamp(ms) + 'A soriz skeleton has taken 24 damage from ' + (src || 'your Chant of Frost') + '.';
  const cd = (a, b) => { const d = (((a - b) % 6000) + 6000) % 6000; return Math.min(d, 6000 - d); };   // distance on the 6s cycle
  beforeEach(() => { agent._mobTicks.clear(); agent._dotLastHit.clear(); });

  it('one DoT hit says nothing; the next one a tick later is a tick', () => {
    expect(agent._noteDotTickLine(dot(T0), sec(T0), T0 + 300)).toBe(null);
    const t = agent._noteDotTickLine(dot(T0 + 6000), sec(T0 + 6000), T0 + 6300);
    expect(t).not.toBe(null);
    expect(t.src).toBe('dot');
  });
  it('hits that are not a whole number of ticks apart are ignored', () => {
    agent._noteDotTickLine(dot(T0), sec(T0), T0 + 300);
    expect(agent._noteDotTickLine(dot(T0 + 9000), sec(T0 + 9000), T0 + 9300)).toBe(null);
  });
  it('different sources are separate streams', () => {
    agent._noteDotTickLine(dot(T0), sec(T0), T0 + 300);
    expect(agent._noteDotTickLine(dot(T0 + 6000, "Aldenmar's Venom of the Snake"), sec(T0 + 6000), T0 + 6300)).toBe(null);
  });
  it('several ticks narrow the estimate, and the real tick stays inside it', () => {
    // The agent reads the log every ~500 ms, so how long after the write a line
    // is read varies; the earliest read is what bounds the tick from above.
    const lags = [450, 120, 300, 60, 380, 200];
    let first = null;
    lags.forEach((lag, k) => {
      const t = agent._noteDotTickLine(dot(T0 + k * 6000), sec(T0 + k * 6000), T0 + k * 6000 + lag);
      if (t && first == null) first = t.half;
    });
    const t = agent._mobTickFor('a soriz skeleton', T0 + 36000);
    expect(cd(t.at, T0)).toBeLessThanOrEqual(t.half);
    expect(t.half).toBeLessThan(first);
    expect(t.half).toBeLessThanOrEqual(250);
  });
  it('one stray observation does not knock out a good estimate; two agreeing ones do', () => {
    for (let k = 0; k < 4; k++) agent._noteMobTick('a soriz skeleton', sec(T0 + k * 6000), T0 + k * 6000 + 300, 'dot');
    const good = agent._mobTickFor('a soriz skeleton', T0).at;
    const stray = T0 + 30000 + 3000;                                           // half a tick off
    agent._noteMobTick('a soriz skeleton', sec(stray), stray + 300, 'dot');
    expect(agent._mobTickFor('a soriz skeleton', stray).at).toBe(good);
    agent._noteMobTick('a soriz skeleton', sec(stray + 6000), stray + 6300, 'break');
    const moved = agent._mobTickFor('a soriz skeleton', stray + 6000).at;
    expect(cd(good, T0)).toBeLessThanOrEqual(500);
    expect(cd(moved, stray)).toBeLessThanOrEqual(700);
  });
  it('a backfilled line (read long after it was written) is not a live observation', () => {
    expect(agent._noteMobTick('a soriz skeleton', sec(T0), T0 + 5 * 60_000, 'break')).toBe(null);
  });
  it('a death clears it, so the next spawn learns its own', () => {
    agent._noteMobTick('a soriz skeleton', sec(T0), T0 + 300, 'break');
    agent._clearNameObservations('a soriz skeleton');
    expect(agent._mobTickFor('a soriz skeleton', T0)).toBe(null);
  });
  it('a log charm break teaches that mob\'s tick', () => {
    const b = new agent.EncounterBuilder({ character: ME, onFlush: () => {} });
    agent._bumpCharmTick('a fear touched drolvarg', ME, 'land', Date.now() - 20000);
    const now = Date.now();
    b.add({ ts: new Date(sec(now)).toISOString(), type: 'charm_break', pet: 'a fear touched drolvarg' });
    const t = agent._mobTickFor('a fear touched drolvarg', now);
    expect(t && t.src).toBe('break');
  });
  it('the live tail feeds every line to the DoT tick learner', () => {
    // main()'s tail loop cannot be driven from a test; the call is checked on
    // comment-stripped source instead.
    expect(stripJs(readSource(AGENT_INDEX))).toMatch(/try \{ _noteDotTickLine\(line, ts \? ts\.getTime\(\) : NaN, Date\.now\(\)\); \} catch/);
  });
  it('the server tick comes from the owner\'s Zeal gauge 24', () => {
    const now = Date.now();
    agent._setZealStateForTest(ME, { updatedAt: now, gauges: [{ slot: 24, hp_pct: 50, text: '3' }] });
    const at = agent._serverTickAtFor(ME.toLowerCase(), now);
    agent._setZealStateForTest(ME, null);
    expect(at - now).toBe(3000);
    expect(agent._serverTickAtFor('Nobody', now)).toBe(null);
  });
});

describe('charm overlay: two tick rows', () => {
  const charm = readSource(path.join(ROOT, 'apps', 'mimic', 'charm.html'));
  const block = sliceBlock(charm, "  var TICK_SRV = '#58a6ff'", '\n\n  // Per-charm session memory');
  const h = new Function('function esc(s){ return String(s); }\n' + block + '\nreturn { tickLeft, tickRowsHtml };')();
  it('counts each clock down from its own tick', () => {
    const now = 1_000_000;
    expect(h.tickLeft(now + 2500, now)).toBe(2500);
    expect(h.tickLeft(now - 1000, now)).toBe(5000);
    expect(h.tickLeft(null, now)).toBe(null);
  });
  it('shows both, and says "learning" instead of guessing an unknown mob tick', () => {
    const now = 1_000_000;
    const known = h.tickRowsHtml({ server_tick_at: now + 3200, mob_tick_at: now + 1400, mob_tick_half_ms: 150, mob_tick_src: 'break' }, now);
    expect(known).toMatch(/server<\/span><span class="tv">3\.2s/);
    expect(known).toMatch(/mob<\/span><span class="tv">1\.4s/);
    const unknown = h.tickRowsHtml({ server_tick_at: now + 3200, mob_tick_at: null }, now);
    expect(unknown).toMatch(/mob<\/span><span class="tv">—<\/span><span class="tn">learning/);
  });
  it('the old landing-anchored countdown is gone', () => {
    expect(stripJs(charm)).not.toMatch(/next mob tick/);
  });
});

describe('timer bars', () => {
  const on = (...ids) => agent._setPersonalTriggersForTest(ids.map(compiledFromTemplate));

  it('nothing is built while every switch is off', () => {
    agent._bumpCharmTick('a fear touched drolvarg', ME, 'land', Date.now() - 8000);
    expect(agent._builtinTimerRows(Date.now())).toEqual([]);
  });
  it('Recharm tick waits for the mob\'s learned tick, then counts it down, pinned, as a cycle', () => {
    const now = Date.now();
    agent._mobTicks.clear();
    agent._bumpCharmTick('a fear touched drolvarg', ME, 'land', now - 8000);
    agent._bumpCharmTick('a mud golem', 'Torvahk', 'land', now - 8000);          // not ours
    on('timer_recharm_tick');
    expect(agent._builtinTimerRows(now)).toEqual([]);                            // the landing says nothing about the tick
    agent._mobTicks.set('a fear touched drolvarg', { at: now - 2000, half: 150, n: 3, seen_at: now - 2000, src: 'break', cand: null });
    agent._mobTicks.set('a mud golem', { at: now - 2000, half: 150, n: 3, seen_at: now - 2000, src: 'dot', cand: null });
    const rows = agent._builtinTimerRows(now);
    expect(rows.map(r => r.target)).toEqual(['a fear touched drolvarg']);
    expect(rows[0].remaining_ms).toBe(4000);
    expect(rows[0]).toMatchObject({ cycle_ms: 6000, pinned: true, duration_sec: 6, effect: 'Recharm tick' });
    expect(rows[0].bar_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('a ticked-off switch builds nothing', () => {
    agent._bumpCharmTick('a fear touched drolvarg', ME, 'land', Date.now() - 8000);
    agent._setPersonalTriggersForTest([{ ...compiledFromTemplate('timer_recharm_tick'), enabled: false }]);
    expect(agent._builtinTimerRows(Date.now())).toEqual([]);
  });

  function seedLandings(now) {
    const mp = new Map();
    mp.set('tashania', { name: 'Tashania', dur_ticks: 110, landed_at: now - 2000, cast_by: ME, target_name: 'A Soriz Skeleton' });
    mp.set('pacify',   { name: 'Pacify',   dur_ticks: 70,  landed_at: now,        owner: ME,   target_name: 'A Soriz Skeleton' });
    mp.set('chant of battle', { name: 'Chant of Battle', dur_ticks: 3, landed_at: now, cast_by: ME });   // 18s bard song
    mp.set('malaise',  { name: 'Malaise',  dur_ticks: 20,  landed_at: now, cast_by: null });             // someone else's
    mp.set('clarity',  { name: 'Clarity',  dur_ticks: 20,  landed_at: now - 200_000, cast_by: ME });      // already over
    agent._buffLandingsByTarget.set('a soriz skeleton', mp);
  }
  it('lull switch: only your Pacify, labelled mob - spell', () => {
    const now = Date.now(); seedLandings(now); on('timer_lull');
    const rows = agent._builtinTimerRows(now);
    expect(rows.map(r => r.effect)).toEqual(['Pacify']);
    expect(rows[0]).toMatchObject({ target: 'A Soriz Skeleton', remaining_ms: 420_000, duration_sec: 420 });
  });
  it('every-spell switch: your spells of 30s or more, nobody else\'s, nothing expired', () => {
    const now = Date.now(); seedLandings(now); on('timer_my_spells');
    const got = agent._builtinTimerRows(now).map(r => r.effect).sort();
    expect(got).toEqual(['Pacify', 'Tashania']);
  });
  it('✕ hides that instance only; a fresh land shows again', () => {
    const now = Date.now(); seedLandings(now); on('timer_lull');
    const [row] = agent._builtinTimerRows(now);
    agent._builtinTimerHidden.add(row.id);
    expect(agent._builtinTimerRows(now)).toEqual([]);
    agent._buffLandingsByTarget.get('a soriz skeleton').get('pacify').landed_at = now + 1;   // recast
    expect(agent._builtinTimerRows(now + 1).map(r => r.effect)).toEqual(['Pacify']);
    expect(agent._builtinTimerHidden.has(row.id)).toBe(false);                             // pruned
  });
  it('rides the same snapshot the trigger overlay polls', () => {
    const now = Date.now(); seedLandings(now); on('timer_lull');
    expect(agent._activeTimersSnapshot().some(r => r.kind === 'builtin' && r.effect === 'Pacify')).toBe(true);
  });
});

describe('the dashboard\'s whole-list save keeps what an EQLogParser import carries', () => {
  const src = readSource(AGENT_INDEX);
  const handler = sliceBlock(src, "if (req.url === '/api/personal-triggers' && req.method === 'POST') {",
    'stored: compiled.length, errors }));\n      }');
  async function post(triggers) {
    const res = { writeHead() {}, end(b) { this.body = b; return b; } };
    const run = new Function('req', 'res', '_readBody', '_compilePersonalTrigger', 'savePersonalTriggers',
      'BUILTIN_TIMER_KINDS', 'PERSONAL_CARRY_FIELDS', 'ctx',
      'let _personalTriggers; return (async () => { ' + handler + ' })().then(() => { ctx.out = _personalTriggers; });');
    const ctx = {};
    await run({ url: '/api/personal-triggers', method: 'POST' }, res, async () => JSON.stringify({ triggers }),
      (t) => ({ ...t }), () => true, new Set(['recharm_tick', 'lull', 'my_spells']), agent.PERSONAL_CARRY_FIELDS, ctx);
    return ctx.out;
  }
  it('warning, end text and bar colour survive a round trip', async () => {
    const [row] = await post([{ id: 'p1', name: 'Mez', pattern: 'x', timer_duration_sec: 60,
      warning_seconds: 10, warning_text: 'MEZ SOON', end_text: 'MEZ OFF', bar_color: '#1f6feb', pinned: true }]);
    expect(row).toMatchObject({ warning_seconds: 10, warning_text: 'MEZ SOON', end_text: 'MEZ OFF', bar_color: '#1f6feb', pinned: true });
  });
  it('a timer-bar switch (no pattern, no gauge) is kept, not dropped', async () => {
    const out = await post([{ id: 'suggested:timer_lull', name: 'lulls', pattern: '', builtin_timer: 'lull' }]);
    expect(out.map(t => t.builtin_timer)).toEqual(['lull']);
  });
});

describe('dashboard: the Suggested panel cannot go stale after a personal-list change', () => {
  const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
  it('redrawing the personal list redraws the Suggested panel', () => {
    // Up to the empty-list early return, so the refresh cannot sit behind it.
    const head = stripJs(sliceBlock(dash, 'async function fetchAndRenderList(', 'if (triggers.length === 0)'));
    expect(head).toMatch(/window\._wpSuggestedTriggers\.refresh\(\)/);
  });
  it('a timer-bar row draws no 🔊 box', () => {
    const row = stripJs(sliceBlock(dash, '  function rowHtml(t){', '\n  }'));
    expect(row).toMatch(/t\.no_tts\s*\n?\s*\?/);
  });
});

describe('trigger overlay: filled bars and a wrapping cycle', () => {
  const trig = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
  const paint = sliceBlock(trig, '  function paintTimers(){', '\n    requestAutoHeight();\n  }');
  function harness() {
    return new Function('var PART = null; const timerNodes = new Map(); function fmtRemain(ms){ return String(ms); }'
      + ' function fire(){} function requestAutoHeight(){}\n' + paint + '\nreturn { paintTimers, timerNodes };')();
  }
  function node(extra) {
    const cls = new Set();
    return Object.assign({ row: { classList: { add: c => cls.add(c), remove: c => cls.delete(c) }, remove() { this.gone = true; } },
      remain: {}, bar: { style: {} }, duration_sec: 6, warnings: [], cls }, extra);
  }
  it('a cycle row wraps past zero instead of being dropped, and never pulses', () => {
    const h = harness();
    // 3s past zero → wraps to ~3s left: inside the 5s warn window, so the
    // no-pulse guard is what keeps `warn` off (not the remaining time).
    const n = node({ ends_at_local: Date.now() - 3000, cycle_ms: 6000 });
    h.timerNodes.set('bt|recharm|x', n);
    h.paintTimers();
    expect(h.timerNodes.has('bt|recharm|x')).toBe(true);
    const left = n.ends_at_local - Date.now();
    expect(left).toBeGreaterThan(2000);
    expect(left).toBeLessThan(5000);
    expect(n.cls.has('warn')).toBe(false);
  });
  it('an ordinary countdown still expires at zero', () => {
    const h = harness();
    h.timerNodes.set('t', node({ ends_at_local: Date.now() - 500 }));
    h.paintTimers();
    expect(h.timerNodes.has('t')).toBe(false);
  });
  it('the fill style paints the bar full-height in the row colour', () => {
    const css = stripCss(trig);
    expect(css).toMatch(/\.timer-row\.fill \.timer-bar\{top:0;height:auto;[^}]*background:var\(--fill\)/);
    expect(stripJs(trig)).toMatch(/n\.row\.classList\.add\('fill'\)/);
  });
});
