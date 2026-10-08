// test/zone-timers-agent.test.js — the agent half of "the timer follows you in": a late_join fire from
// the bot arms the trigger's own countdown from the ORIGINAL fire time, and does nothing else.
//
// The guild lead, 2026-10-08, on the Plane of Tactics stampede: "if one person had the stampede window it
// should go to anyone currently in the zone when it opens." Drives the REAL _consumeRelayFires,
// _runLateJoinFire, _relayFiredAtLocal and _startTimer.
//
// Run: npx vitest run test/zone-timers-agent.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock } from './_source-slice.js';

const SRC = readSource(AGENT_INDEX);
function sliceFunction(name) {
  const m = new RegExp('^function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('slice: function not found: ' + name);
  return SRC.slice(m.index, SRC.indexOf('\n}\n', m.index) + 3);
}
const BLOCK = [
  /^const _NON_SEMANTIC_CAPTURES = .*$/m.exec(SRC)[0],
  ...['_semanticCaptureKeys', '_timerWarnings', '_parseDurationText', '_timerDurationSec', '_startTimer',
    '_relayFiredAtLocal', '_consumeRelayFires'].map(sliceFunction),
  sliceBlock(SRC, 'const LATE_JOIN_SAME_WINDOW_MS', '\n  return true;\n}\n'),
].join('\n');

const MIN = 60_000;
const DEF = { id: 'by', name: 'Tactics: stampede by', timer_duration_sec: 7200, actions: [],
  end_text: 'Stampede is overdue', tags: ['stampede', 'zone-timer'] };
let env;
function load({ guildTriggers = [DEF], clockOffsetMs = null } = {}) {
  const e = {
    _activeTimers: new Map(), journal: [], ran: [], seen: [],
    stats: { guildTriggers, clockOffsetMs, currentEncounterThreat: null },
  };
  const inj = {
    _activeTimers: e._activeTimers, stats: e.stats,
    TJ: { MATCHED: 2, DISPATCHED: 5 }, RELAY_STALE_MS: 15_000,
    _journalTrigger: (j) => e.journal.push(j),
    _runRelayedFire: (f) => e.ran.push(f),
    _hasRecentFire: () => false, _markFireSeen: (k) => e.seen.push(k),
    _consumeLootPosted: () => {}, _lastRelayFireId: 0,
  };
  const names = Object.keys(inj);
  // eslint-disable-next-line no-new-func
  e.fns = new Function(...names, BLOCK + '\nreturn { _consumeRelayFires, _runLateJoinFire };')(...names.map(n => inj[n]));
  return e;
}
const lateFire = (over = {}) => {
  const at = Date.now() - 50 * MIN;
  return { id: 'w|by', name: 'Tactics: stampede by', key: 'Tactics: stampede by:{}', captures: {}, actions: [],
    timer_duration_sec: 7200, trigger_id: 'by', cooldown_seconds: 120, fired_at_ms: at, fired_at_true_ms: at,
    late_join: true, window_id: 'w', remaining_sec: 70 * 60, end_text: 'from the bot', ...over };
};

beforeEach(() => { env = load(); });

describe('a late join', () => {
  it('arms the countdown from the original fire, with the trigger\'s own end text, and runs no actions', () => {
    const f = lateFire();
    env.fns._consumeRelayFires({ next_id: 9, fires: [f] });
    const rows = [...env._activeTimers.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].started_at_ms).toBe(f.fired_at_ms);
    expect(rows[0].ends_at_ms).toBe(f.fired_at_ms + 7200_000);
    expect(rows[0].end_text).toBe('Stampede is overdue');       // our definition wins
    expect(rows[0].trigger_id).toBe('by');
    expect(env.ran).toEqual([]);                                  // no overlay / TTS path
    expect(env.seen).toEqual([]);
  });

  it('bypasses the 15 s ghost TTL — only for late_join', () => {
    env.fns._consumeRelayFires({ fires: [lateFire()] });
    expect(env._activeTimers.size).toBe(1);
    const stale = { ...lateFire(), late_join: undefined };
    env.fns._consumeRelayFires({ fires: [stale] });
    expect(env.ran).toEqual([]);
    expect(env.journal.some(j => /stale-skipped/.test(j.reason || ''))).toBe(true);
  });

  it('is skipped when that countdown already runs from the same window (no duplicate end callout)', () => {
    const f = lateFire();
    env._activeTimers.set('by', { trigger_id: 'by', started_at_ms: f.fired_at_ms + 3000, ends_at_ms: f.fired_at_ms + 7203_000, end_text: 'mine' });
    expect(env.fns._runLateJoinFire(f)).toBe(false);
    expect(env._activeTimers.get('by').end_text).toBe('mine');
    expect(env._activeTimers.size).toBe(1);
  });

  it('replaces a countdown from an OLDER window that a fresh sighting has cleared', () => {
    const f = lateFire();
    env._activeTimers.set('by', { trigger_id: 'by', started_at_ms: f.fired_at_ms - 60 * MIN, ends_at_ms: f.fired_at_ms + 60 * MIN, end_text: 'old' });
    expect(env.fns._runLateJoinFire(f)).toBe(true);
    expect(env._activeTimers.get('by').started_at_ms).toBe(f.fired_at_ms);
  });

  it('lands on OUR clock when the bot sent a true stamp', () => {
    env = load({ clockOffsetMs: 30_000 });                       // we run 30 s behind
    const f = lateFire();
    env.fns._runLateJoinFire(f);
    expect([...env._activeTimers.values()][0].started_at_ms).toBe(f.fired_at_true_ms - 30_000);
  });

  it('falls back to the bot\'s fields for a trigger we have not loaded; a finished countdown arms nothing', () => {
    env = load({ guildTriggers: [] });
    expect(env.fns._runLateJoinFire(lateFire())).toBe(true);
    expect([...env._activeTimers.values()][0].end_text).toBe('from the bot');
    env = load();
    expect(env.fns._runLateJoinFire(lateFire({ fired_at_ms: Date.now() - 3 * 3600_000, fired_at_true_ms: Date.now() - 3 * 3600_000 }))).toBe(false);
    expect(env._activeTimers.size).toBe(0);
  });
});
