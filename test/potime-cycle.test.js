// test/potime-cycle.test.js — the Plane of Time cycle ledger (Quarm's October 18 patch).
//
// The guild lead, 2026-10-19 (Decision Desk, DECISIONS §383 `potime-model` C "Hybrid"; the patch is §369):
// the Plane of Time is ONE fixed 6d18h (162 h) cycle from the guild's FIRST ENTRY, and a kill no longer
// extends it. The bot keeps an INFERRED ledger (first activity seen after the previous cycle ended) that any
// OBSERVED value (#timelockout, /sll) overwrites, remembers which one the current value came from, shows it on
// the board, and persists it in bot_kv. These tests run the real module, the real state.js recordKill wrapper
// (state in memory), the real reconcile and the real embed builders. NO `#timelockout` line has been captured,
// so none is parsed here (see the TODO in utils/potimeCycle.js); the observed path is tested through
// applyObservedCycleEnd, the one function a parser will call.
//
// Run: npx vitest run test/potime-cycle.test.js

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readSource, sliceBlock, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';
import { installFakePostgrest } from './_fake-fetch-postgrest.js';
import { makeFakePostgrest } from './_fake-postgrest.js';

const nodeRequire = createRequire(import.meta.url);
const potime = nodeRequire('../utils/potimeCycle.js');
const slowMode = nodeRequire('../utils/slowMode.js');
const supabase = nodeRequire('../utils/supabase.js');
const embeds = nodeRequire('../utils/embeds.js');
const reconcile = nodeRequire('../utils/reconcileKills.js');
const BOSSES = nodeRequire('../data/bosses.json');
const quarm = BOSSES.find((b) => b.id === 'quarm');

const H = 3600000;
const CYCLE = 162 * H;
const T0 = Date.parse('2026-10-20T00:30:00Z');   // the first entry we see

// A board in memory standing in for utils/state.js (which reads and writes the real data/state.json).
function fakeBoard(initial = {}) {
  const bosses = { ...initial };
  return {
    bosses,
    getBossState: (id) => bosses[id] || null,
    overrideTimer: (id, nextSpawn) => { if (!bosses[id]) return false; bosses[id].nextSpawn = nextSpawn; return true; },
  };
}

let board;
beforeEach(() => {
  board = fakeBoard();
  potime._resetForTests(null, board);
  supabase._resetBreaker();
  // A change persists itself, fire-and-forget; nothing in a test may reach a network.
  vi.stubGlobal('fetch', async () => { throw new Error('no network in this test'); });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { potime._resetForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the inference rule', () => {
  it('the first activity starts a 162 h cycle and says it is an estimate', () => {
    expect(potime.noteActivity(T0, 'zone-in')).toBe(true);
    expect(potime.getCycle()).toMatchObject({ startMs: T0, endMs: T0 + CYCLE, source: 'inferred', via: 'zone-in' });
  });

  it('a kill, or anyone else zoning in, inside the cycle changes nothing: kills do not extend it', () => {
    potime.noteActivity(T0, 'zone-in');
    expect(potime.noteActivity(T0 + 3 * H, 'zone-in')).toBe(false);
    expect(potime.noteActivity(T0 + 5 * 24 * H, 'kill')).toBe(false);
    expect(potime.getCycle().endMs).toBe(T0 + CYCLE);
  });

  it('activity at or after the cycle end starts the NEXT cycle from that moment', () => {
    potime.noteActivity(T0, 'zone-in');
    const next = T0 + CYCLE + 2 * H;
    expect(potime.noteActivity(next, 'zone-in')).toBe(true);
    expect(potime.getCycle()).toMatchObject({ startMs: next, endMs: next + CYCLE, source: 'inferred', prevEndMs: T0 + CYCLE });
    // the very instant the cycle ends already counts as after it
    potime._resetForTests({ startMs: T0, endMs: T0 + CYCLE, source: 'inferred', via: 'zone-in', setAt: 0, prevEndMs: 0 }, board);
    expect(potime.noteActivity(T0 + CYCLE, 'kill')).toBe(true);
  });

  it('an earlier-stamped report of the same first entry moves an inferred start back', () => {
    potime.noteActivity(T0, 'zone-in');
    expect(potime.noteActivity(T0 - 40 * 60000, 'kill')).toBe(true);
    expect(potime.getCycle()).toMatchObject({ startMs: T0 - 40 * 60000, endMs: T0 - 40 * 60000 + CYCLE });
  });

  it('but a late report from the PREVIOUS cycle cannot drag a new cycle backwards', () => {
    potime.noteActivity(T0, 'zone-in');
    const next = T0 + CYCLE + 2 * H;
    potime.noteActivity(next, 'zone-in');
    expect(potime.noteActivity(T0 + 10 * H, 'kill')).toBe(false);          // before the previous end
    expect(potime.getCycle().startMs).toBe(next);
  });

  it('ignores a bad time', () => {
    expect(potime.noteActivity(NaN)).toBe(false);
    expect(potime.noteActivity(undefined)).toBe(false);
    expect(potime.getCycle()).toBeNull();
  });
});

describe('an observed value overwrites the inference — and remembers where it came from', () => {
  const now = T0 + 20 * H;

  it('replaces an inferred cycle with the server\'s end, source observed, via recorded', () => {
    potime.noteActivity(T0, 'zone-in');
    const end = now + 100 * H;
    expect(potime.applyObservedCycleEnd(end, 'timelockout', now)).toMatchObject({ changed: true });
    expect(potime.getCycle()).toMatchObject({ startMs: end - CYCLE, endMs: end, source: 'observed', via: 'timelockout' });
  });

  it('a later observed value replaces an earlier one, from either source', () => {
    potime.applyObservedCycleEnd(now + 100 * H, 'sll', now);
    potime.applyObservedCycleEnd(now + 90 * H, 'timelockout', now);
    expect(potime.getCycle()).toMatchObject({ endMs: now + 90 * H, via: 'timelockout' });
  });

  it('inferred activity does NOT overwrite an observed cycle, even from before its start', () => {
    const end = now + 100 * H;
    potime.applyObservedCycleEnd(end, 'sll', now);
    expect(potime.noteActivity(now - 30 * H, 'zone-in')).toBe(false);       // inside the cycle
    expect(potime.noteActivity(end - CYCLE - 5 * H, 'kill')).toBe(false);   // before the observed start
    expect(potime.getCycle()).toMatchObject({ endMs: end, source: 'observed' });
  });

  it('every raider hears the same line: the same value again is a no-op', () => {
    potime.applyObservedCycleEnd(now + 100 * H, 'sll', now);
    expect(potime.applyObservedCycleEnd(now + 100 * H + 20000, 'sll', now)).toEqual({ changed: false, reason: 'unchanged' });
  });

  it('refuses what cannot be a cycle end: past, further than a cycle out, not a number, unknown source', () => {
    expect(potime.applyObservedCycleEnd(now - 1, 'sll', now).reason).toBe('already-over');
    expect(potime.applyObservedCycleEnd(now + CYCLE + 2 * H, 'sll', now).reason).toBe('too-far');
    expect(potime.applyObservedCycleEnd(NaN, 'sll', now).reason).toBe('bad-time');
    expect(potime.applyObservedCycleEnd(now + H, 'a guess', now).reason).toBe('bad-source');
    expect(potime.getCycle()).toBeNull();
  });

  it('after an observed cycle runs out, new activity starts an inferred one again', () => {
    const end = now + 10 * H;
    potime.applyObservedCycleEnd(end, 'timelockout', now);
    potime.noteActivity(end + H, 'zone-in');
    expect(potime.getCycle()).toMatchObject({ source: 'inferred', startMs: end + H, prevEndMs: end });
  });
});

describe('the Quarm timer is the cycle end', () => {
  it('endForKill answers null for every other boss and leaves the ledger alone', () => {
    expect(potime.endForKill('lord_nagafen', T0)).toBeNull();
    expect(potime.getCycle()).toBeNull();
  });

  it('a kill days into the cycle gets the cycle end, not kill + 162 h', () => {
    potime.noteActivity(T0, 'zone-in');
    const killedAt = T0 + 4 * 24 * H;
    expect(potime.endForKill('quarm', killedAt)).toBe(T0 + CYCLE);
    expect(T0 + CYCLE).toBeLessThan(killedAt + CYCLE);
  });

  it('with no ledger yet, the kill itself is the first activity seen (an estimate)', () => {
    expect(potime.endForKill('quarm', T0)).toBe(T0 + CYCLE);
    expect(potime.getCycle()).toMatchObject({ source: 'inferred', via: 'kill' });
  });

  it('a kill the ledger cannot place (older than the cycle) falls back to kill + 162 h', () => {
    potime.applyObservedCycleEnd(T0 + 100 * H, 'sll', T0);
    const old = T0 - 300 * H;
    expect(potime.endForKill('quarm', old)).toBe(old + CYCLE);
  });
});

// The real recordKill + notifying wrapper of utils/state.js, state in memory (the technique of test/slow-mode.test.js).
function makeRecordKill() {
  const stateSrc = readSource(path.join(ROOT, 'utils', 'state.js'));
  const inner = sliceBlock(stateSrc, 'function recordKill(', '\n}\n');
  const wrapper = sliceBlock(stateSrc, 'const _killListeners = [];', '  return entry;\n}\n');
  const S = { bosses: {}, dailyKills: [] };
  const rk = new Function('S', 'slowMode', 'potime',
    `const loadState = () => S; const saveState = () => {};\n${inner}\n${wrapper}\nreturn recordKillNotifying;`)(S, slowMode, potime);
  return { rk, S };
}

describe('through the real recordKill', () => {
  it('Quarm\'s nextSpawn is the cycle end to the millisecond, not killedAt + 162 h', () => {
    const { rk } = makeRecordKill();
    potime.noteActivity(T0, 'zone-in');
    const killedAt = T0 + 3 * 24 * H + 777;
    const e = rk('quarm', quarm.timerHours, 'u', killedAt);
    expect(e.killedAt).toBe(killedAt);
    expect(e.nextSpawn).toBe(T0 + CYCLE);
  });

  it('slow mode\'s 18 h does not shorten Quarm — but still applies to the other bosses', async () => {
    const { rk } = makeRecordKill();
    await slowMode.setSlowMode(true, 'u', T0 - H);
    try {
      potime.noteActivity(T0, 'zone-in');
      const q = rk('quarm', quarm.timerHours, 'u', T0 + 2 * H);
      expect(q.nextSpawn).toBe(T0 + CYCLE);
      const other = BOSSES.find((b) => b.id === 'trakanon');
      const o = rk('trakanon', other.timerHours, 'u', T0 + 2 * H);
      expect(o.nextSpawn - o.killedAt).toBe(18 * H);
    } finally {
      await slowMode.setSlowMode(false, 'u', T0 + 12 * H);
    }
  });

  it('a second Quarm kill in the same cycle does not extend it', () => {
    const { rk } = makeRecordKill();
    potime.noteActivity(T0, 'zone-in');
    rk('quarm', quarm.timerHours, 'u', T0 + 1 * 24 * H);
    const second = rk('quarm', quarm.timerHours, 'u', T0 + 5 * 24 * H);
    expect(second.nextSpawn).toBe(T0 + CYCLE);
  });

  it('a boss that is not Quarm keeps its own timer', () => {
    const { rk } = makeRecordKill();
    const b = BOSSES.find((x) => x.id === 'lord_nagafen');
    const e = rk('lord_nagafen', b.timerHours, 'u', T0 + 30 * H);   // after the slow-mode test's window closed
    expect(e.nextSpawn - e.killedAt).toBe(b.timerHours * H);
    expect(potime.getCycle()).toBeNull();
  });
});

describe('the board follows the ledger', () => {
  it('a Quarm timer already on the board moves to an observed end — later or EARLIER', () => {
    board.bosses.quarm = { killedAt: T0 + 2 * H, nextSpawn: T0 + CYCLE, killedBy: 'u' };
    potime.noteActivity(T0, 'zone-in');
    const now = T0 + 3 * H;
    potime.applyObservedCycleEnd(now + 100 * H, 'sll', now);
    expect(board.bosses.quarm.nextSpawn).toBe(now + 100 * H);
    potime.applyObservedCycleEnd(now + 120 * H, 'timelockout', now);
    expect(board.bosses.quarm.nextSpawn).toBe(now + 120 * H);
    potime.applyObservedCycleEnd(now + 90 * H, 'timelockout', now);
    expect(board.bosses.quarm.nextSpawn).toBe(now + 90 * H);
  });

  it('a cycle running is not a kill: with no Quarm entry, none is created', () => {
    potime.noteActivity(T0, 'zone-in');
    potime.applyObservedCycleEnd(T0 + 100 * H, 'sll', T0 + H);
    expect(board.bosses.quarm).toBeUndefined();
  });
});

describe('the board says where the time came from', () => {
  const entry = (n) => ({ killedAt: T0, nextSpawn: n, killedBy: 'u' });

  it('estimated while inferred; from #timelockout or from /sll once observed', () => {
    potime.noteActivity(T0, 'zone-in');
    expect(potime.boardTag('quarm', entry(T0 + CYCLE))).toBe(' • ⏳ estimated');
    potime.applyObservedCycleEnd(T0 + 100 * H, 'timelockout', T0 + H);
    expect(potime.boardTag('quarm', entry(T0 + 100 * H))).toBe(' • ⏳ from #timelockout');
    potime.applyObservedCycleEnd(T0 + 99 * H, 'sll', T0 + H);
    expect(potime.boardTag('quarm', entry(T0 + 99 * H))).toBe(' • ⏳ from /sll');
  });

  it('no tag when the timer on the board is not the ledger\'s (a hand-set time) or the boss is not Quarm', () => {
    potime.noteActivity(T0, 'zone-in');
    expect(potime.boardTag('quarm', entry(T0 + 5 * H))).toBe('');
    expect(potime.boardTag('lord_nagafen', entry(T0 + CYCLE))).toBe('');
    potime._resetForTests(null, board);
    expect(potime.boardTag('quarm', entry(T0 + CYCLE))).toBe('');
  });

  it('shows on the zone kill card, the active cooldowns card and /timers; and replaces the slow-mode tag', () => {
    potime.noteActivity(T0, 'zone-in');
    const e = entry(T0 + CYCLE);
    vi.spyOn(Date, 'now').mockReturnValue(T0 + H);
    const card = embeds.buildZoneKillCard('Plane of Time', [{ boss: quarm, entry: e, killedBy: '123' }]).toJSON();
    expect(card.fields[0].value).toContain('⏳ estimated');
    expect(JSON.stringify(embeds.buildSummaryCard(BOSSES, { quarm: e }).toJSON())).toContain('⏳ estimated');
    expect(JSON.stringify(embeds.buildExpansionCooldownCard('PoP', BOSSES, { quarm: e }).toJSON())).toContain('⏳ estimated');
    expect(JSON.stringify(embeds.buildStatusEmbed(BOSSES, { quarm: e }, 'Plane of Time').toJSON())).toContain('⏳ estimated');
  });
});

describe('persisted in bot_kv', () => {
  let fake;
  afterEach(() => { fake && fake.restore(); fake = null; });

  it('every change writes the ledger to bot_kv under potime_cycle, with its source', async () => {
    fake = installFakePostgrest({ tables: { bot_kv: [] } });
    potime.noteActivity(T0, 'zone-in');                   // the change itself persists, fire-and-forget
    await vi.waitFor(() => expect(fake.tables.bot_kv.find((r) => r.key === 'potime_cycle')).toBeTruthy());
    const row = fake.tables.bot_kv.find((r) => r.key === 'potime_cycle');
    expect(row.guild_id).toBe(supabase.guildId());
    expect(row.value).toMatchObject({ startMs: T0, endMs: T0 + CYCLE, source: 'inferred' });
  });

  it('boot loads the stored ledger back, observed source included', async () => {
    const stored = { startMs: T0, endMs: T0 + 100 * H, source: 'observed', via: 'timelockout', setAt: T0, prevEndMs: 0 };
    fake = installFakePostgrest({ tables: { bot_kv: [{ guild_id: supabase.guildId(), key: 'potime_cycle', value: stored }] } });
    expect(potime.getCycle()).toBeNull();
    await potime.loadPotimeCycle();
    expect(potime.getCycle()).toEqual(stored);
  });

  it('a junk stored value is not loaded, and a failed read leaves the ledger as it was', async () => {
    fake = installFakePostgrest({ tables: { bot_kv: [{ guild_id: supabase.guildId(), key: 'potime_cycle', value: { startMs: 'x' } }] } });
    await potime.loadPotimeCycle();
    expect(potime.getCycle()).toBeNull();
    potime.noteActivity(T0, 'zone-in');
    fake.failWhen = ({ table, method }) => table === 'bot_kv' && method === 'GET';
    await potime.loadPotimeCycle();
    expect(potime.getCycle()).toMatchObject({ startMs: T0 });
  });
});

describe('timer recovery (utils/reconcileKills.js) uses the cycle for Quarm', () => {
  const STATE_FILE = path.join(ROOT, 'data', 'state.json');
  const NOW = Date.parse('2026-10-21T12:00:00Z');
  let hadState, savedState, keep;
  beforeEach(() => {
    hadState = fs.existsSync(STATE_FILE);
    savedState = hadState ? fs.readFileSync(STATE_FILE, 'utf8') : null;
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, '{}');
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    keep = { isEnabled: supabase.isEnabled, select: supabase.select, rpc: supabase.rpc };
  });
  afterEach(() => {
    Object.assign(supabase, keep);
    vi.useRealTimers();
    if (hadState) fs.writeFileSync(STATE_FILE, savedState);
    else { try { fs.unlinkSync(STATE_FILE); } catch { /* never existed */ } }
  });
  const tables = (killedAgoH) => {
    const idx = BOSSES.findIndex((b) => b.id === 'quarm');
    return {
      bosses_local: BOSSES.map((b, i) => ({ npc_id: 10000 + i, internal_id: b.id, auto_registered: false })),
      encounters: [{ id: 'e1', guild_id: 'wolfpack', npc_id: 10000 + idx, zone_short: 'potimeb',
        started_at: new Date(NOW - killedAgoH * H).toISOString(), ended_at: new Date(NOW - killedAgoH * H + 60000).toISOString() }],
    };
  };
  const use = (fake) => Object.assign(supabase, { isEnabled: () => true, select: fake.select, rpc: fake.rpc });

  it('a recovered Quarm kill gets the observed cycle end, not killedAt + 162 h', async () => {
    const end = NOW + 30 * H;
    potime.applyObservedCycleEnd(end, 'timelockout', NOW);
    use(makeFakePostgrest(tables(20)));
    const r = await reconcile.reconcileKillsFromSupabase({ dryRun: true });
    const q = r.recoverList.find((x) => x.bossId === 'quarm');
    expect(q.killedAt).toBe(NOW - 20 * H);
    expect(q.nextSpawn).toBe(end);
    expect(q.nextSpawn).not.toBe(NOW - 20 * H + CYCLE);
  });

  it('with no ledger the recovered kill seeds an estimate: kill + 162 h, tagged estimated', async () => {
    use(makeFakePostgrest(tables(20)));
    const r = await reconcile.reconcileKillsFromSupabase({ dryRun: true });
    const q = r.recoverList.find((x) => x.bossId === 'quarm');
    expect(q.nextSpawn).toBe(NOW - 20 * H + CYCLE);
    expect(potime.getCycle()).toMatchObject({ source: 'inferred', via: 'kill' });
  });
});

describe('wired into the bot', () => {
  const src = stripJs(readSource(BOT_INDEX));

  it('boot loads the ledger after slow mode, before the board is reconciled', () => {
    const load = src.indexOf("require('./utils/potimeCycle').loadPotimeCycle()");
    expect(load).toBeGreaterThan(0);
    expect(load).toBeGreaterThan(src.indexOf("require('./utils/slowMode').loadSlowMode()"));
  });

  it('a guild member in a Plane of Time zone (live-state upload) is first-entry evidence', () => {
    expect(src).toMatch(/isPotimeZone\(zoneId\)\)[^\n]*noteActivity\(Date\.now\(\), 'zone-in'\)/);
  });

  it('a kill broadcast in the Plane of Time that is not on the board is first-entry evidence too', () => {
    expect(src).toMatch(/\/plane of time\/i\.test\(String\(zone \|\| ''\)\)\)[^\n]*noteActivity\(killedAt, 'kill'\)/);
  });

  it('a Quarm /sll lockout is an observed cycle end', () => {
    expect(src).toMatch(/isPotimeBoss\(boss\.id\)\)[^\n]*applyObservedCycleEnd\(nextSpawn, 'sll'\)/);
  });

  it('the live-state hook fires for exactly the two Plane of Time zones', () => {
    expect([219, 223].every((z) => potime.isPotimeZone(z))).toBe(true);
    expect([218, 220, 222, 0, null, undefined].some((z) => potime.isPotimeZone(z))).toBe(false);
  });
});
