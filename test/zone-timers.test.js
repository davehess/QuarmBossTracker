// test/zone-timers.test.js — a long zone-wide countdown follows you into the zone (utils/zoneTimers.js).
//
// The guild lead, 2026-10-08, on the Plane of Tactics stampede: "if one person had the stampede window it
// should go to anyone currently in the zone when it opens" — the timer follows you in. The window has an
// EARLIEST bound ("window opens", 2400 s) and a LATEST ("stampede by", 7200 s); it clears for everyone
// when the latest passes unobserved or a fresh sighting replaces it, and it survives a bot restart in
// bot_kv.
//
// Run: npx vitest run test/zone-timers.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX } from './_source-slice.js';

const zt = createRequire(BOT_INDEX)('./utils/zoneTimers.js');

const ZONE = 'Drunder, the Fortress of Zek';
const T0 = 1_800_000_000_000;
const MIN = 60_000;
const PACK = 'potactics-stampede';
const OPENS = { trigger_id: 'opens', name: 'Tactics: stampede window opens', duration_sec: 2400, end_text: 'Stampede possible now', cooldown_seconds: 120 };
const BY    = { trigger_id: 'by', name: 'Tactics: stampede by', duration_sec: 7200, end_text: 'Stampede is overdue', cooldown_seconds: 120 };

const quietLog = { warn() {} };
function rig({ supabase = null } = {}) {
  const clock = { t: T0 };
  const ledger = zt.create({ supabase, guildId: 'wolfpack', now: () => clock.t, log: quietLog });
  return { clock, ledger };
}
const sight = (ledger, over = {}) => ledger.record({
  pack: PACK, timers: [OPENS, BY], origin_zones: [ZONE], fired_at_ms: T0, fired_at_true_ms: T0,
  uploaded_by: 'observer', ...over,
});
const here = (...z) => new Set(z.length ? z : [ZONE]);

// A bot_kv stand-in: one row per (guild_id, key), select/upsert like utils/supabase.
function fakeKv({ fail = false } = {}) {
  const rows = new Map();
  let upserts = 0;
  return {
    rows, upserts: () => upserts,
    isEnabled: () => true,
    async select(table, q) {
      if (fail) throw new Error('down');
      expect(table).toBe('bot_kv');
      const key = /key=eq\.([^&]+)/.exec(q)[1];
      const r = rows.get(key);
      return r ? [{ value: JSON.parse(JSON.stringify(r.value)) }] : [];
    },
    async upsert(table, list, onConflict) {
      if (fail) throw new Error('down');
      expect(table).toBe('bot_kv'); expect(onConflict).toBe('guild_id,key');
      upserts++;
      for (const r of list) rows.set(r.key, JSON.parse(JSON.stringify(r)));
    },
  };
}
const flush = () => new Promise(r => setTimeout(r, 0));

describe('the tag contract', () => {
  it('reads zone-timer from a text[] or a CSV, nothing else', () => {
    expect(zt.hasZoneTimerTag(['potactics', 'zone-timer'])).toBe(true);
    expect(zt.hasZoneTimerTag('pop, Zone-Timer')).toBe(true);
    expect(zt.hasZoneTimerTag(['potactics', 'stampede'])).toBe(false);
    expect(zt.hasZoneTimerTag(null)).toBe(false);
  });
});

describe('a window', () => {
  it('has the earliest and latest bound of its pack, and a status derived from them', () => {
    const { clock, ledger } = rig();
    const w = sight(ledger);
    expect(w.zone).toBe(ZONE);
    expect(w.min_at_ms).toBe(T0 + 2400_000);
    expect(w.max_at_ms).toBe(T0 + 7200_000);
    expect(w.trigger_name).toBe(BY.name);
    expect(zt.statusOf(w, clock.t)).toBe('waiting');
    expect(zt.statusOf(w, T0 + 41 * MIN)).toBe('open');
    expect(zt.statusOf(w, T0 + 121 * MIN)).toBe('over');
  });

  it('two observers of one emote (both rows each, clocks apart) are ONE window', () => {
    const { ledger } = rig();
    const a = sight(ledger);
    sight(ledger, { timers: [OPENS, BY] });                                       // the other row's relay
    const b = sight(ledger, { uploaded_by: 'observer2', fired_at_true_ms: T0 + 40_000 });
    expect(b.window_id).toBe(a.window_id);
    expect(ledger.snapshot().windows).toHaveLength(1);
    // Neither observer is handed their own window back.
    expect(ledger.lateJoinFires('observer', here())).toEqual([]);
    expect(ledger.lateJoinFires('observer2', here())).toEqual([]);
  });

  it('a sender who cannot be placed in ONE zone opens nothing; a known zone places a boxer', () => {
    const { ledger } = rig();
    expect(sight(ledger, { origin_zones: [] })).toBe(null);
    expect(sight(ledger, { origin_zones: [ZONE, 'The Bazaar'] })).toBe(null);   // first sighting, ambiguous
    sight(ledger);                                                                // a one-zone observer places it
    const again = sight(ledger, { origin_zones: [ZONE, 'The Bazaar'], uploaded_by: 'boxer', fired_at_true_ms: T0 + 1000 });
    expect(again && again.zone).toBe(ZONE);
    expect(ledger.snapshot().windows.map(w => w.zone)).toEqual([ZONE]);
  });

  it('ignores a backlog replay of a window that has already ended', () => {
    const { ledger } = rig();
    expect(sight(ledger, { fired_at_true_ms: T0 - 121 * MIN })).toBe(null);
  });
});

describe('the timer follows you in', () => {
  it('a listener in the zone gets every running countdown, full length, from the ORIGINAL fire, with no actions', () => {
    const { clock, ledger } = rig();
    sight(ledger);
    clock.t = T0 + 10 * MIN;
    const fires = ledger.lateJoinFires('joiner', here());
    expect(fires.map(f => f.trigger_id).sort()).toEqual(['by', 'opens']);
    for (const f of fires) {
      expect(f.late_join).toBe(true);
      expect(f.actions).toEqual([]);
      expect(f.fired_at_true_ms).toBe(T0);
      expect(f.fired_at_ms).toBe(T0);
    }
    const opens = fires.find(f => f.trigger_id === 'opens');
    expect(opens.timer_duration_sec).toBe(2400);
    expect(opens.remaining_sec).toBe(30 * 60);
    expect(opens.end_text).toBe('Stampede possible now');
    expect(opens.window_status).toBe('waiting');
  });

  it('after the earliest bound only the latest countdown is handed out', () => {
    const { clock, ledger } = rig();
    sight(ledger);
    clock.t = T0 + 50 * MIN;
    const fires = ledger.lateJoinFires('joiner', here());
    expect(fires.map(f => f.trigger_id)).toEqual(['by']);
    expect(fires[0].remaining_sec).toBe(70 * 60);
    expect(fires[0].window_status).toBe('open');
  });

  it('is handed once per listener while they stay; leaving and coming back hands it again', () => {
    const { clock, ledger } = rig();
    sight(ledger);
    clock.t = T0 + 5 * MIN;
    expect(ledger.lateJoinFires('joiner', here())).toHaveLength(2);
    expect(ledger.lateJoinFires('joiner', here())).toEqual([]);
    expect(ledger.lateJoinFires('joiner', here('Plane of Knowledge'))).toEqual([]);
    expect(ledger.lateJoinFires('joiner', here())).toHaveLength(2);
    expect(ledger.lateJoinFires('someone-else', here())).toHaveLength(2);
  });

  it('a listener in another zone, or one we cannot place, gets nothing', () => {
    const { ledger } = rig();
    sight(ledger);
    expect(ledger.lateJoinFires('joiner', here('Plane of Knowledge'))).toEqual([]);
    expect(ledger.lateJoinFires('joiner', new Set())).toEqual([]);
    expect(ledger.lateJoinFires('joiner', null)).toEqual([]);
  });
});

describe('clearing, for everyone', () => {
  it('the latest bound passing unobserved clears the window and leaves a nameless record', () => {
    const { clock, ledger } = rig();
    sight(ledger);
    clock.t = T0 + 120 * MIN + 1;
    expect(ledger.hasActive()).toBe(false);
    expect(ledger.lateJoinFires('joiner', here())).toEqual([]);
    const snap = ledger.snapshot();
    expect(snap.windows).toEqual([]);
    expect(snap.cleared).toEqual([{ trigger_name: BY.name, zone: ZONE, at_ms: T0 + 7200_000, reason: 'expired_unobserved', pack: PACK }]);
  });

  it('a fresh sighting REPLACES the window: new clock for everyone, old one never handed out again', () => {
    const { clock, ledger } = rig();
    const old = sight(ledger);
    clock.t = T0 + 30 * MIN;
    expect(ledger.lateJoinFires('joiner', here())).toHaveLength(2);
    clock.t = T0 + 90 * MIN;
    const fresh = sight(ledger, { uploaded_by: 'camper', fired_at_true_ms: clock.t, fired_at_ms: clock.t });
    expect(fresh.window_id).not.toBe(old.window_id);
    const snap = ledger.snapshot();
    expect(snap.windows.map(w => w.window_id)).toEqual([fresh.window_id]);
    expect(snap.cleared).toEqual([{ trigger_name: BY.name, zone: ZONE, at_ms: clock.t, reason: 'replaced_by_sighting', pack: PACK }]);
    // The joiner who held the old window is handed the new one, from the new sighting.
    const fires = ledger.lateJoinFires('joiner', here());
    expect(fires).toHaveLength(2);
    expect(fires.every(f => f.fired_at_true_ms === clock.t && f.window_id === fresh.window_id)).toBe(true);
    // A straggler from the replaced window does not bring it back.
    expect(sight(ledger, { uploaded_by: 'late-queue', fired_at_true_ms: T0 + 1000 })).toBe(null);
  });

  it('keeps ONE cleared record per pack and zone', () => {
    const { clock, ledger } = rig();
    sight(ledger);
    clock.t = T0 + 50 * MIN; sight(ledger, { fired_at_true_ms: clock.t });
    clock.t = T0 + 100 * MIN; sight(ledger, { fired_at_true_ms: clock.t });
    expect(ledger.snapshot().cleared).toHaveLength(1);
    clock.t = T0 + 300 * MIN; ledger.hasActive();
    expect(ledger.snapshot().cleared.map(c => c.reason)).toEqual(['expired_unobserved']);
  });

  it('the ledger stays bounded', () => {
    const { ledger } = rig();
    for (let i = 0; i < zt.MAX_WINDOWS + 15; i++) {
      sight(ledger, { pack: 'pack' + i, origin_zones: ['Zone ' + i], fired_at_true_ms: T0 + i });
    }
    expect(ledger.snapshot().windows).toHaveLength(zt.MAX_WINDOWS);
    expect(ledger.snapshot().windows[0].zone).toBe('Zone 15');   // oldest dropped
  });
});

describe('bot_kv: the ledger survives a restart', () => {
  it('round-trips the documented shape, with no member identifiers', async () => {
    const kv = fakeKv();
    const a = rig({ supabase: kv });
    await a.ledger.load();
    sight(a.ledger);
    await flush();
    const stored = kv.rows.get(zt.KV_KEY).value;
    expect(Object.keys(stored).sort()).toEqual(['cleared', 'windows']);
    expect(stored.windows[0]).toMatchObject({ trigger_name: BY.name, zone: ZONE, observed_at_ms: T0,
      min_at_ms: T0 + 2400_000, max_at_ms: T0 + 7200_000 });
    expect(typeof stored.windows[0].window_id).toBe('string');
    expect(JSON.stringify(stored)).not.toContain('observer');
  });

  it('a window recorded before a restart still follows a joiner in after it', async () => {
    const kv = fakeKv();
    const before = rig({ supabase: kv });
    await before.ledger.load();
    sight(before.ledger);
    await flush();
    const after = rig({ supabase: kv });             // a new process: empty memory
    after.clock.t = T0 + 20 * MIN;
    await after.ledger.load();
    const fires = after.ledger.lateJoinFires('joiner', here());
    expect(fires.map(f => [f.trigger_id, f.fired_at_true_ms, f.remaining_sec]).sort()).toEqual([
      ['by', T0, 100 * 60], ['opens', T0, 20 * 60]]);
    // Who saw it is memory only, so the observer is handed it once more after the restart. Harmless:
    // the agent skips a late join for a countdown it already runs (test/zone-timers-agent.test.js).
    expect(after.ledger.lateJoinFires('observer', here())).toHaveLength(2);
  });

  it('a window that ran out while the bot was down is dropped on load and cleared as unobserved', async () => {
    const kv = fakeKv();
    const before = rig({ supabase: kv });
    await before.ledger.load();
    sight(before.ledger);
    await flush();
    const after = rig({ supabase: kv });
    after.clock.t = T0 + 3 * 3600_000;
    await after.ledger.load();
    // Checked straight after the load, before anything else could expire it.
    expect(after.ledger.snapshot().windows).toEqual([]);
    expect(kv.rows.get(zt.KV_KEY).value.windows).toEqual([]);
    expect(kv.rows.get(zt.KV_KEY).value.cleared[0].reason).toBe('expired_unobserved');
    expect(after.ledger.hasActive()).toBe(false);
    expect(after.ledger.lateJoinFires('joiner', here())).toEqual([]);
  });

  it('a sighting before the load finishes is merged, not overwritten', async () => {
    const kv = fakeKv();
    const a = rig({ supabase: kv });
    sight(a.ledger);                                   // not loaded yet: nothing written
    expect(kv.upserts()).toBe(0);
    await a.ledger.load();
    expect(kv.rows.get(zt.KV_KEY).value.windows).toHaveLength(1);
  });

  it('bot_kv down: logs, never throws, and the ledger works from memory', async () => {
    const kv = fakeKv({ fail: true });
    const { clock, ledger } = rig({ supabase: kv });
    await expect(ledger.load()).resolves.toBe(false);
    expect(() => sight(ledger)).not.toThrow();
    await flush();
    clock.t = T0 + MIN;
    expect(ledger.lateJoinFires('joiner', here())).toHaveLength(2);
  });
});
