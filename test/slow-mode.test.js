// test/slow-mode.test.js — Bastion of Thunder slow mode (the guild lead, 2026-10-11).
//
// While the server is in slow mode the four second-floor named respawn in 18h instead of 3h. The rule
// lives in utils/slowMode.js and is applied ONCE, in the exported recordKill wrapper of utils/state.js,
// so these tests run the real wrapper (with state held in memory) rather than any copy of the rule.
// Names in the log lines below are invented.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const slowMode = require('../utils/slowMode.js');
const bosses = require('../data/bosses.json');
const byId = (id) => bosses.find((b) => b.id === id);
const H = 3600000;
const T0 = Date.parse('2026-10-11T22:00:00Z');   // slow mode goes on

// The real recordKill + its notifying wrapper, state in memory, the real slowMode module.
function makeRecordKill() {
  const stateSrc = readSource(path.join(ROOT, 'utils', 'state.js'));
  const inner = sliceBlock(stateSrc, 'function recordKill(', '\n}\n');
  const wrapper = sliceBlock(stateSrc, 'const _killListeners = [];', '  return entry;\n}\n');
  const S = { bosses: {}, dailyKills: [] };
  const rk = new Function('S', 'slowMode',
    `const loadState = () => S; const saveState = () => {};\n${inner}\n${wrapper}\nreturn recordKillNotifying;`)(S, slowMode);
  return { rk, S };
}

describe('the slow-mode timer rule, through the real recordKill', () => {
  beforeEach(async () => { await slowMode.setSlowMode(true, '111111111111111111', T0); });

  it('gives a second-floor named 18h while slow mode is on', () => {
    const { rk } = makeRecordKill();
    const killedAt = T0 + 1 * H;
    const e = rk('auliffe_chaoswind', byId('auliffe_chaoswind').timerHours, 'u', killedAt);
    expect(e.nextSpawn - e.killedAt).toBe(18 * H);
  });

  it('keeps a first-floor named at 3h while slow mode is on', () => {
    const { rk } = makeRecordKill();
    const e = rk('gaukr_sandstorm', byId('gaukr_sandstorm').timerHours, 'u', T0 + 1 * H);
    expect(e.nextSpawn - e.killedAt).toBe(3 * H);
  });

  it('keeps a second-floor named at 3h once the switch is off', async () => {
    await slowMode.setSlowMode(false, '111111111111111111', T0 + 2 * H);
    const { rk } = makeRecordKill();
    const e = rk('brynju_thunderclap', 3, 'u', T0 + 3 * H);
    expect(e.nextSpawn - e.killedAt).toBe(3 * H);
  });

  it('keeps a second-floor named at 3h after auto_off_at (8h), even if nobody switched it off', () => {
    const { rk } = makeRecordKill();
    expect(rk('kuanbyr_hailstorm', 3, 'u', T0 + 8 * H + 1).nextSpawn - (T0 + 8 * H + 1)).toBe(3 * H);
    expect(rk('kuanbyr_hailstorm', 3, 'u', T0 + 8 * H - 1000).nextSpawn - (T0 + 8 * H - 1000)).toBe(18 * H);
  });

  it('judges a late-relayed kill by when it happened, not by now', async () => {
    const { rk } = makeRecordKill();
    // The switch is off now, but the kill was inside the window it ran.
    await slowMode.setSlowMode(false, '111111111111111111', T0 + 2 * H);
    expect(rk('eindride_icestorm', 3, 'u', T0 + 1 * H).nextSpawn - (T0 + 1 * H)).toBe(18 * H);
    // A kill from before the switch went on was not in slow mode.
    expect(rk('eindride_icestorm', 3, 'u', T0 - 1 * H).nextSpawn - (T0 - 1 * H)).toBe(3 * H);
  });

  it('auto_off_at is 8 hours after the switch goes on', () => {
    const f = slowMode.getSlowMode();
    expect(Date.parse(f.auto_off_at) - Date.parse(f.set_at)).toBe(8 * H);
    expect(f.set_by).toBe('111111111111111111');
  });
});

describe('the affected list is data', () => {
  it('exactly the four second-floor named carry slowModeHours: 18', () => {
    const slow = bosses.filter((b) => b.slowModeHours).map((b) => b.id).sort();
    expect(slow).toEqual(['auliffe_chaoswind', 'brynju_thunderclap', 'eindride_icestorm', 'kuanbyr_hailstorm']);
    for (const id of slow) { expect(byId(id).slowModeHours).toBe(18); expect(byId(id).timerHours).toBe(3); }
    for (const id of ['gaukr_sandstorm', 'hreidar_lynhillig', 'laef_windfall', 'oreen_wavecrasher']) {
      expect(byId(id).slowModeHours).toBeUndefined();
    }
  });

  it('marks a longer-than-usual timer on the board, and only for those bosses', () => {
    const b = byId('auliffe_chaoswind');
    expect(slowMode.isSlowModeTimer(b, { killedAt: T0, nextSpawn: T0 + 18 * H })).toBe(true);
    expect(slowMode.isSlowModeTimer(b, { killedAt: T0, nextSpawn: T0 + 3 * H })).toBe(false);
    expect(slowMode.isSlowModeTimer(byId('gaukr_sandstorm'), { killedAt: T0, nextSpawn: T0 + 18 * H })).toBe(false);
  });
});

describe('the server\'s slow-mode ENDING message', () => {
  const OFF = "[Wed Oct 07 21:43:05 2026] Druzzil Ro tells the guild, 'A ripple passes through your guild's thread of time. Aldenmar has asked the Timekeeper of Druzzil Ro to set its weave right. Beware! Time has returned to its natural pace, and those walking it have been drawn back to Tranquility.'";
  const PULLED = "[Sun Oct 11 21:43:36 2026] Druzzil Ro's voice fills your mind. \"How curious. Your guild's thread of time has shifted. I've pulled you out before you become too tangled in the mess they're making.\"";
  const KILL = "[Wed Oct 07 21:50:00 2026] Druzzil Ro tells the guild, 'Brackwyn of <Some Guild> has killed Auliffe Chaoswind in Bastion of Thunder!'";

  it('reads the OFF wording into { state, at, by }', () => {
    const r = slowMode.parseSlowModeLine(OFF, () => Date.parse('2026-10-08T01:43:05Z'));
    expect(r).toEqual({ state: 'off', at: '2026-10-08T01:43:05.000Z', by: 'Aldenmar' });
  });

  it('reads the stamp itself when no zone is given', () => {
    const r = slowMode.parseSlowModeLine(OFF);
    expect(r.at).toBe(new Date('Wed Oct 07 21:43:05 2026').toISOString());
  });

  it('returns null for the "pulled out" line, a guild-kill broadcast and other noise', () => {
    expect(slowMode.parseSlowModeLine(PULLED)).toBeNull();
    expect(slowMode.parseSlowModeLine(KILL)).toBeNull();
    expect(slowMode.parseSlowModeLine("[Wed Oct 07 21:43:05 2026] Aldenmar tells the guild, 'time has returned to its natural pace'")).toBeNull();
    expect(slowMode.parseSlowModeLine('')).toBeNull();
    expect(slowMode.parseSlowModeLine(undefined)).toBeNull();
  });
});

describe('an agent reporting a state change', () => {
  beforeEach(async () => { await slowMode.setSlowMode(true, '111111111111111111', T0); });

  it('OFF ends the window at the line\'s time: earlier kills keep 18h, later ones do not', async () => {
    const r = await slowMode.applyDetectedSlowMode('off', T0 + 2 * H, 'Aldenmar');
    expect(r.changed).toBe(true);
    const { rk } = makeRecordKill();
    expect(rk('auliffe_chaoswind', 3, 'u', T0 + 1 * H).nextSpawn - (T0 + 1 * H)).toBe(18 * H);
    expect(rk('auliffe_chaoswind', 3, 'u', T0 + 3 * H).nextSpawn - (T0 + 3 * H)).toBe(3 * H);
  });

  it('is idempotent: every raider\'s agent hears the same line', async () => {
    expect((await slowMode.applyDetectedSlowMode('off', T0 + 2 * H, 'Aldenmar')).changed).toBe(true);
    const again = await slowMode.applyDetectedSlowMode('off', T0 + 2 * H, 'Brackwyn');
    expect(again).toMatchObject({ changed: false, reason: 'no-open-window' });
  });

  it('ignores an old OFF line replayed from before the window opened', async () => {
    const r = await slowMode.applyDetectedSlowMode('off', T0 - 24 * H, 'Aldenmar');
    expect(r.changed).toBe(false);
    expect(slowMode.slowModeOnAt(T0 + 1 * H)).toBe(true);
  });

  it('rejects a bad state, a bad time and a time in the future', async () => {
    expect((await slowMode.applyDetectedSlowMode('maybe', T0)).reason).toBe('bad-state');
    expect((await slowMode.applyDetectedSlowMode('off', NaN)).reason).toBe('bad-time');
    expect((await slowMode.applyDetectedSlowMode('off', Date.now() + 3 * H)).reason).toBe('in-the-future');
  });

  it('ON opens a window with the same 8h auto-off', async () => {
    const at = Date.now() - 60000;
    await slowMode.setSlowMode(false, 'x', at - H);
    const r = await slowMode.applyDetectedSlowMode('on', at, 'Aldenmar');
    expect(r.changed).toBe(true);
    expect(Date.parse(slowMode.getSlowMode().auto_off_at) - at).toBe(8 * H);
  });
});

describe('wiring', () => {
  const src = stripJs(readSource(BOT_INDEX));
  it('/api/agent/slow-mode is a budgeted, bearer-auth route', () => {
    expect(src).toMatch(/req\.url === '\/api\/agent\/slow-mode'[\s\S]{0,200}_overBudget\('slow_mode'/);
    expect(src).toMatch(/async function _handleAgentSlowMode[\s\S]{0,200}requireAgentAuth/);
    expect(src).toMatch(/slow_mode:\s+\{ perMin: \d+,\s+durable: true \}/);
  });
  it('the exported recordKill goes through the slow-mode rule', () => {
    const state = stripJs(readSource(path.join(ROOT, 'utils', 'state.js')));
    expect(state).toMatch(/slowMode\.timerHoursForKill\(bossId, timerHours, killedAt\)/);
  });
});
