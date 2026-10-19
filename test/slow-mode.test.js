// test/slow-mode.test.js — guild-instance slow mode (the guild lead, 2026-10-11 and 2026-10-14).
//
// While our instances are in slow mode every boss we kill respawns in 18h, whatever its usual timer. The rule
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
  const rk = new Function('S', 'slowMode', 'potime',
    `const loadState = () => S; const saveState = () => {};\n${inner}\n${wrapper}\nreturn recordKillNotifying;`)(S, slowMode, require('../utils/potimeCycle.js'));
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

  // The guild lead, 2026-10-14: "anything that died within our instances since 8pm should be 18 hour
  // respawn" — every boss, shorter and longer timers alike, not only the four second-floor named.
  it('gives EVERY boss 18h while slow mode is on: a 3h first-floor named, a 24h and a 66h PoP boss', () => {
    const { rk } = makeRecordKill();
    for (const id of ['gaukr_sandstorm', 'grummus', 'manaetic_behemoth', 'terris_thule']) {
      const b = byId(id);
      expect(b, id).toBeTruthy();
      expect(b.slowModeHours, id).toBeUndefined();
      const e = rk(id, b.timerHours, 'u', T0 + 1 * H);
      expect(e.nextSpawn - e.killedAt, id).toBe(18 * H);
    }
  });

  it('a boss outside the window keeps its own timer', () => {
    const { rk } = makeRecordKill();
    const e = rk('manaetic_behemoth', byId('manaetic_behemoth').timerHours, 'u', T0 - 1 * H);
    expect(e.nextSpawn - e.killedAt).toBe(byId('manaetic_behemoth').timerHours * H);
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

describe('a per-boss override is still data', () => {
  it('a boss row carrying slowModeHours uses it instead of 18', () => {
    const custom = { id: 'x', timerHours: 3, slowModeHours: 12 };
    const flag = { on: true, set_at: new Date(T0).toISOString(), auto_off_at: new Date(T0 + 8 * H).toISOString() };
    expect(slowMode.effectiveTimerHours(custom, 3, T0 + H, flag)).toBe(12);
    expect(slowMode.effectiveTimerHours({ id: 'y', timerHours: 66 }, 66, T0 + H, flag)).toBe(18);
    expect(slowMode.effectiveTimerHours(null, 66, T0 + H, flag)).toBe(66);
  });
});

describe('the board marks a slow-mode timer', () => {
  beforeEach(async () => { await slowMode.setSlowMode(true, '111111111111111111', T0); });
  it('for a kill inside the window whose length is not the boss\'s own, shorter or longer', () => {
    const k = T0 + H;
    expect(slowMode.isSlowModeTimer(byId('auliffe_chaoswind'), { killedAt: k, nextSpawn: k + 18 * H })).toBe(true);
    expect(slowMode.isSlowModeTimer(byId('manaetic_behemoth'), { killedAt: k, nextSpawn: k + 18 * H })).toBe(true);
    expect(slowMode.isSlowModeTimer(byId('auliffe_chaoswind'), { killedAt: k, nextSpawn: k + 3 * H })).toBe(false);
    expect(slowMode.isSlowModeTimer(byId('manaetic_behemoth'), { killedAt: T0 - H, nextSpawn: T0 + 17 * H })).toBe(false);
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

  it('ON opens a window with the same 8h auto-off, and keeps the line that opened it', async () => {
    const at = Date.now() - 60000;
    await slowMode.setSlowMode(false, 'x', at - H);
    const r = await slowMode.applyDetectedSlowMode('on', at, 'Aldenmar', "Druzzil Ro tells the guild, '… thread of time …'");
    expect(r.changed).toBe(true);
    expect(Date.parse(slowMode.getSlowMode().auto_off_at) - at).toBe(8 * H);
    expect(slowMode.getSlowMode().set_line).toMatch(/thread of time/);
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

// ── the announcement goes to #raid-chat and pings the raider roles (the guild lead, 2026-10-15) ──────────
describe('slow-mode announcement', () => {
  const sent = [];
  const roles = new Map([
    ['r1', { id: 'r1', name: 'Raid Pack' }], ['r2', { id: 'r2', name: 'Raid Recruit' }], ['r3', { id: 'r3', name: 'Officer' }],
  ]);
  const channel = (id) => ({ id, guild: { roles: { cache: roles } }, send: async (m) => { sent.push({ id, m }); } });
  const client = (failIds = []) => ({ channels: { fetch: async (id) => { if (failIds.includes(id)) throw new Error('no access'); return channel(id); } } });
  beforeEach(() => { sent.length = 0; delete process.env.RAID_CHAT_CHANNEL_ID; delete process.env.SLOWMODE_PING_ROLES; process.env.TIMER_CHANNEL_ID = 'timers'; });

  it('posts to #raid-chat (the known id when RAID_CHAT_CHANNEL_ID is unset), not the timer channel', async () => {
    expect(await slowMode.announce(client(), 'Slow mode is on')).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe('1193692008812920863');
  });
  it('pings Raid Pack and Raid Recruit, and only those roles may ping', async () => {
    await slowMode.announce(client(), 'Slow mode is on');
    expect(sent[0].m.content).toBe('<@&r1> <@&r2> Slow mode is on');
    expect(sent[0].m.allowedMentions).toEqual({ parse: [], roles: ['r1', 'r2'] });
  });
  it('honours RAID_CHAT_CHANNEL_ID and SLOWMODE_PING_ROLES', async () => {
    process.env.RAID_CHAT_CHANNEL_ID = 'rc'; process.env.SLOWMODE_PING_ROLES = 'Officer';
    await slowMode.announce(client(), 'x');
    expect(sent[0].id).toBe('rc');
    expect(sent[0].m.content).toBe('<@&r3> x');
  });
  it('falls back to the timer channel only when #raid-chat cannot be reached', async () => {
    await slowMode.announce(client(['1193692008812920863']), 'x');
    expect(sent[0].id).toBe('timers');
  });
});
