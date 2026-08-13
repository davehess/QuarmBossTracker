// #205 — the group-HP death watcher. SOURCE-SLICE fidelity tier.
//
// Every death this platform ever recorded came from one sentence in one log
// file, and that is exactly what let the feign bug ("<Name> dies." is the Feign
// Death emote) bank 44% of every stored death as false: nothing could contradict
// the log, because nothing else was watching. The watcher is the second witness —
// Zeal's group gauges read the client's MEMORY, not its text — and it feeds the
// SAME death registry rather than keeping one of its own.
//
// The bugs these cases exist to prevent, in order of how much they would cost:
//   1. A FEIGNING knight entering the corpse list. The whole design rests on
//      "feign does not change hit points", which has never been checked against
//      a live feigning groupmate's gauge. One monk in the rez queue and the
//      feature gets switched off.
//   2. A GROUP PET at 0% (gauges 17-21) read as a raider death.
//   3. A single-sample zero. Zeal emits negative per-mille values and Mimic
//      clamps them into [0,100] — a lone 0 is a known artifact shape.
//   4. Re-stamping a death the log already recorded, which would push the
//      15-minute forget window forward and tombstone someone all night.
//   5. Clearing a fresh log death off a gauge frame that has not ticked yet.
//
// Run: npx vitest run test/group-death-watcher.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { AGENT_INDEX, readSource, sliceBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// ── the slice ──────────────────────────────────────────────────────────────
// The watcher block, verbatim from the shipped agent. Its registry calls
// (_noteDeath/_clearDeath/_isDead/_deadSince) are free identifiers, so they
// resolve to the stubs installed on globalThis below — which is precisely what
// lets us assert "did NOT record a death" and see WHY.
const block = sliceBlock(
  src,
  'const GROUP_HP_GAUGE_SLOTS = [11, 12, 13, 14, 15];',
  '      cleared_at: t.clearedAt || 0, observer: t.observer || null,\n    });\n  }\n  return out;\n}',
);
const W = new Function(
  block + '\nreturn { _groupHpObservations, _noteGroupHpFromState, _groupDeathWatchSnapshot,'
        + ' noteFeignEmoteLine, _feignedRecently, _groupHpTrack, _feignSince,'
        + ' GROUP_DEATH_ZERO_DWELL_MS, GROUP_ALIVE_CLEAR_MIN_AGE_MS, FEIGN_SUPPRESS_MS };',
)();

// ── a stand-in registry with the real one's semantics ──────────────────────
const DEAD_FORGET_MS = 15 * 60_000;
let noted = [];
let cleared = [];
globalThis._deadSince = new Map();
globalThis._noteDeath = (name, at) => {
  noted.push({ name, at });
  globalThis._deadSince.set(String(name || '').toLowerCase(), at || Date.now());
};
globalThis._clearDeath = (name) => {
  cleared.push(String(name || ''));
  globalThis._deadSince.delete(String(name || '').toLowerCase());
};
globalThis._isDead = (k, now) => {
  const t = globalThis._deadSince.get(String(k || '').toLowerCase());
  return t != null && ((now || Date.now()) - t) <= DEAD_FORGET_MS;
};

const T0 = 1_700_000_000_000;
const gaugeState = (slot, name, pct) => ({ gauges: [{ slot, hp_pct: pct, text: name }] });
const watchOf = (nameLower) => W._groupDeathWatchSnapshot(T0).find(r => r.name_lower === nameLower);
// Alive, then a zero held long enough to clear the dwell guard.
const kill = (name, { start = T0, observer = 'Hitya' } = {}) => {
  W._noteGroupHpFromState(observer, gaugeState(11, name, 42), start);
  W._noteGroupHpFromState(observer, gaugeState(11, name, 0), start + 1000);
  W._noteGroupHpFromState(observer, gaugeState(11, name, 0), start + 4000);
};

beforeEach(() => {
  noted = []; cleared = [];
  globalThis._deadSince.clear();
  W._groupHpTrack.clear();
  W._feignSince.clear();
});

describe('the slice is the shipped code', () => {
  it('sliced all five entry points', () => {
    for (const fn of ['_groupHpObservations', '_noteGroupHpFromState', '_groupDeathWatchSnapshot',
      'noteFeignEmoteLine', '_feignedRecently']) {
      expect(typeof W[fn], fn).toBe('function');
    }
  });

  it('is actually WIRED — a function nobody calls is not a feature', () => {
    // Both hooks, asserted against the source: the Zeal-state ingest (the only
    // place sample-to-sample deltas exist) and the raw-line feign hook.
    expect(src).toContain('_noteGroupHpFromState(character, st, Date.now())');
    expect(src).toContain('noteFeignEmoteLine(line,');
  });
});

describe('_groupHpObservations — which gauges are group members', () => {
  it('reads group HP gauges 11-15 with the member name', () => {
    const obs = W._groupHpObservations({
      gauges: [
        { slot: 11, hp_pct: 100, text: 'Uilnayar' },
        { slot: 15, hp_pct: 12,  text: 'Canopy' },
      ],
    }, 'Hitya');
    expect([...obs.keys()].sort()).toEqual(['canopy', 'uilnayar']);
    expect(obs.get('canopy').pct).toBe(12);
  });

  it('IGNORES self (1), target (6), pet (16) and the group PET band (17-21)', () => {
    // Bug 2: a charmed pet dropping to 0% is not a raider death. Group pets sit
    // in their own gauge band and must never reach the registry.
    const obs = W._groupHpObservations({
      gauges: [
        { slot: 1,  hp_pct: 0, text: 'Hitya' },
        { slot: 6,  hp_pct: 0, text: 'Emperor Ssraeshza' },
        { slot: 16, hp_pct: 0, text: 'Gorak' },
        { slot: 17, hp_pct: 0, text: 'Ghoulbane' },
        { slot: 21, hp_pct: 0, text: 'Warder' },
      ],
    }, 'Hitya');
    expect(obs.size).toBe(0);
  });

  it('drops NPC-shaped names and the observer themselves', () => {
    const obs = W._groupHpObservations({
      gauges: [
        { slot: 11, hp_pct: 0, text: 'a shissar disciple' },
        { slot: 12, hp_pct: 0, text: 'Lord Inquisitor Seru' },
        { slot: 13, hp_pct: 0, text: 'Hitya' },            // the observer
        { slot: 14, hp_pct: 0, text: '' },                 // empty slot
      ],
    }, 'Hitya');
    expect(obs.size).toBe(0);
  });

  it('exact /pipeverbose HP beats the gauge percentage for the same name', () => {
    const obs = W._groupHpObservations({
      gauges: [{ slot: 11, hp_pct: 3, text: 'Hawkner' }],
      group_members: [{ name: 'Hawkner', hp_current: 0, hp_max: 7075 }],
    }, 'Hitya');
    expect(obs.get('hawkner').pct).toBe(0);
    expect(obs.get('hawkner').verbose).toBe(true);
  });

  it('flags a member the verbose zone_id proves is in ANOTHER zone', () => {
    const obs = W._groupHpObservations({
      zone: 158,
      group_members: [
        { name: 'Hawkner',  hp_current: 0, hp_max: 7075, zone_id: 158 },
        { name: 'Currygoat', hp_current: 0, hp_max: 7075, zone_id: 202 },
      ],
    }, 'Hitya');
    expect(obs.get('hawkner').offZone).toBe(false);
    expect(obs.get('currygoat').offZone).toBe(true);
  });

  it('a NON-verbose group row (no hp_current) contributes nothing', () => {
    // Without /pipeverbose the type-6 payload is name/loc only. Reading a
    // missing hp_current as 0 would declare the whole group dead.
    const obs = W._groupHpObservations({
      group_members: [{ name: 'Hawkner', hp_current: null, hp_max: null }],
    }, 'Hitya');
    expect(obs.size).toBe(0);
  });
});

describe('a zero has to earn its way into the registry', () => {
  it('a live group member is never dead', () => {
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 32), T0);
    expect(noted).toEqual([]);
    expect(globalThis._isDead('hawkner', T0)).toBe(false);
  });

  it('BUG 3: one lone zero sample is a Zeal artifact, not a corpse', () => {
    // Zeal emits negative per-mille values (observed -3, 2026-08-03) and Mimic
    // clamps them to 0. A single frame must never tombstone anyone.
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 87), T0);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 500);
    expect(noted).toEqual([]);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 91), T0 + 1200);
    expect(globalThis._isDead('hawkner', T0 + 2000)).toBe(false);
  });

  it('two zeros inside the dwell window are still not enough', () => {
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 87), T0);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 500);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 900);
    expect(noted).toEqual([]);
    expect(W.GROUP_DEATH_ZERO_DWELL_MS).toBeGreaterThan(900);
  });

  it('a zero that HOLDS is a death, stamped at the first zero sample', () => {
    kill('Hawkner');
    expect(noted.length).toBe(1);
    expect(noted[0].name).toBe('Hawkner');
    // The moment they died, not the moment we finished being sure.
    expect(noted[0].at).toBe(T0 + 1000);
    expect(globalThis._isDead('hawkner', T0 + 4000)).toBe(true);
  });

  it('the exact /pipeverbose path proves a death too', () => {
    const verbose = (cur) => ({ group_members: [{ name: 'Currygoat', hp_current: cur, hp_max: 7075 }] });
    W._noteGroupHpFromState('Hitya', verbose(7075), T0);
    W._noteGroupHpFromState('Hitya', verbose(0), T0 + 1000);
    W._noteGroupHpFromState('Hitya', verbose(0), T0 + 4000);
    expect(globalThis._isDead('currygoat', T0 + 4000)).toBe(true);
  });

  it('never fires on a name first SEEN at zero — that is an unrendered gauge', () => {
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 4000);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 9000);
    expect(noted).toEqual([]);
    expect(watchOf('hawkner').saw_alive).toBe(false);
  });

  it('emits ONCE per collapse, not once per sample', () => {
    kill('Hawkner');
    for (let i = 1; i <= 5; i++) {
      W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 4000 + i * 1000);
    }
    expect(noted.length).toBe(1);
  });
});

describe('zoning is not dying', () => {
  // A groupmate who zones sits at 0% in the group window for as long as the
  // load takes — longer than any dwell. When verbose tells us where they are,
  // that zero proves nothing.
  const away = (pct, zone_id) => ({ zone: 158, group_members: [{ name: 'Currygoat', hp_current: pct === 0 ? 0 : 7000, hp_max: 7075, zone_id }] });

  it('a held zero from ANOTHER zone is not a death', () => {
    W._noteGroupHpFromState('Hitya', away(70, 158), T0);          // alive, with us
    W._noteGroupHpFromState('Hitya', away(0, 202), T0 + 1000);    // zoning out
    W._noteGroupHpFromState('Hitya', away(0, 202), T0 + 6000);
    W._noteGroupHpFromState('Hitya', away(0, 202), T0 + 11_000);
    expect(noted).toEqual([]);
    expect(globalThis._isDead('currygoat', T0 + 11_000)).toBe(false);
  });

  it('but the SAME collapse in our own zone is', () => {
    // The guard must be about the zone, not about verbose rows in general.
    W._noteGroupHpFromState('Hitya', away(70, 158), T0);
    W._noteGroupHpFromState('Hitya', away(0, 158), T0 + 1000);
    W._noteGroupHpFromState('Hitya', away(0, 158), T0 + 6000);
    expect(noted.length).toBe(1);
  });

  it('coming back ALIVE from another zone still clears — that is the bind run', () => {
    // Vex Thal binds are right outside: death → bind → run back is 5-10s, and
    // the alive frame on the way back must not be discarded as "off zone".
    globalThis._deadSince.set('currygoat', T0 - 30_000);
    W._noteGroupHpFromState('Hitya', away(70, 202), T0);
    expect(globalThis._isDead('currygoat', T0)).toBe(false);
  });
});

describe('BUG 1 — a feign must never become a corpse', () => {
  it('"<Name> dies." is a feign marker, and it blocks the zero', () => {
    W.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] Syko dies.', T0 - 5000);
    kill('Syko');
    expect(noted, 'a feigning knight must not enter the death registry').toEqual([]);
    expect(globalThis._isDead('syko', T0 + 4000)).toBe(false);
    expect(watchOf('syko').suppressed_feign_at).toBeGreaterThan(0);
  });

  it('the suppression is a WINDOW, not permanent immunity', () => {
    // A knight who feigns and later genuinely dies must still be recorded.
    W.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] Syko dies.', T0);
    const later = T0 + W.FEIGN_SUPPRESS_MS + 10_000;
    kill('Syko', { start: later });
    expect(noted.length).toBe(1);
    expect(globalThis._isDead('syko', later + 4000)).toBe(true);
  });

  it('only player-shaped names are feign markers', () => {
    expect(W.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] Syko dies.', T0)).toBe('Syko');
    // Mobs are multi-word or lowercase — a charm pet feigning is not a raider.
    expect(W.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] a shissar disciple dies.', T0)).toBeNull();
    expect(W.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] Lord Inquisitor Seru dies.', T0)).toBeNull();
  });

  it('the INVERSE bug: a real death line must not read as a feign', () => {
    // "died." is a real death. Treating it as a feign would blind the watcher
    // for a minute at exactly the moment its evidence matters most.
    expect(W.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] Syko died.', T0)).toBeNull();
    expect(W.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] Syko has been slain by Lord Inquisitor Seru!', T0)).toBeNull();
    expect(W._feignedRecently('syko', T0)).toBe(false);
  });
});

describe('the watcher is a SOURCE, not a second registry', () => {
  it('BUG 4: a death the log already recorded is corroborated, never re-stamped', () => {
    // The real sequence: HP collapses, the log line lands mid-collapse, then the
    // watcher finishes being sure. Re-noting at that point would move the death
    // forward and extend the 15-minute forget window — the one thing the
    // registry is deliberately built not to do.
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 42), T0);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 1000);
    globalThis._deadSince.set('hawkner', T0 + 1100);          // "Hawkner died." arrives
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 0), T0 + 4000);
    expect(noted, 'no second _noteDeath for a death we already hold').toEqual([]);
    expect(globalThis._deadSince.get('hawkner')).toBe(T0 + 1100);
    expect(watchOf('hawkner').corroborated_at).toBeGreaterThan(0);
  });

  it('alive evidence clears a death — that is the registry\'s own rule', () => {
    kill('Hawkner');
    expect(globalThis._isDead('hawkner', T0 + 4000)).toBe(true);
    const rez = T0 + 4000 + W.GROUP_ALIVE_CLEAR_MIN_AGE_MS + 1000;
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 24), rez);
    expect(cleared.length).toBe(1);
    expect(globalThis._isDead('hawkner', rez)).toBe(false);
  });

  it('BUG 5: a gauge frame that has not ticked yet cannot erase a fresh death', () => {
    // The log line and the gauge race. Right after a death the gauge can still
    // be carrying the last live value; clearing on that would let a stale frame
    // overrule a corpse-run-confirmed log death.
    globalThis._deadSince.set('hawkner', T0 - 1000);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 32), T0);
    expect(cleared, 'a 1s-old death survives a stale alive frame').toEqual([]);
    expect(globalThis._isDead('hawkner', T0)).toBe(true);
  });

  it('a death older than the race window IS cleared by alive evidence', () => {
    globalThis._deadSince.set('hawkner', T0 - 30_000);
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 32), T0);
    expect(globalThis._isDead('hawkner', T0)).toBe(false);
  });

  it('a fresh collapse after a rez is recorded again', () => {
    kill('Hawkner');
    const rez = T0 + 20_000;
    W._noteGroupHpFromState('Hitya', gaugeState(11, 'Hawkner', 60), rez);
    globalThis._deadSince.clear();
    kill('Hawkner', { start: rez + 5000 });
    expect(noted.length).toBe(2);
  });
});

// ── the shipped module, not the slice ──────────────────────────────────────
// The slice proves the logic; this proves the logic is bolted to the REAL
// registry — the integration the whole feature is (a second source feeding
// _noteDeath, not a parallel bookkeeping of its own).
describe('end to end against the real death registry', () => {
  const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');

  it('a held zero on the real watcher marks the real registry', () => {
    const now = Date.now();
    agent._clearDeath('Zzwatchertest');
    agent._noteGroupHpFromState('Hitya', { gauges: [{ slot: 11, hp_pct: 55, text: 'Zzwatchertest' }] }, now - 9000);
    expect(agent._isDead('zzwatchertest', now)).toBe(false);
    agent._noteGroupHpFromState('Hitya', { gauges: [{ slot: 11, hp_pct: 0, text: 'Zzwatchertest' }] }, now - 8000);
    agent._noteGroupHpFromState('Hitya', { gauges: [{ slot: 11, hp_pct: 0, text: 'Zzwatchertest' }] }, now - 5000);
    expect(agent._isDead('zzwatchertest', now)).toBe(true);
    expect(agent._deadNamesSnapshot(now).some(r => r.name === 'zzwatchertest')).toBe(true);
    agent._clearDeath('Zzwatchertest');
  });

  it('a feign on the real watcher does not', () => {
    const now = Date.now();
    agent._clearDeath('Zzfeigntest');
    agent.noteFeignEmoteLine('[Sun Aug 02 20:55:33 2026] Zzfeigntest dies.', now - 10_000);
    expect(agent._feignedRecently('zzfeigntest', now)).toBe(true);
    agent._noteGroupHpFromState('Hitya', { gauges: [{ slot: 11, hp_pct: 80, text: 'Zzfeigntest' }] }, now - 9000);
    agent._noteGroupHpFromState('Hitya', { gauges: [{ slot: 11, hp_pct: 0, text: 'Zzfeigntest' }] }, now - 8000);
    agent._noteGroupHpFromState('Hitya', { gauges: [{ slot: 11, hp_pct: 0, text: 'Zzfeigntest' }] }, now - 5000);
    expect(agent._isDead('zzfeigntest', now)).toBe(false);
  });
});
