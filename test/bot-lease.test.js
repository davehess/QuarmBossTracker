// test/bot-lease.test.js — the Discord login lease (utils/botLease.js).
//
// Only the lease holder logs in; null from rpc means "unknown", never "lost". Runs the real module against
// an in-memory fake of the SQL semantics driven by a manual fake clock.
//
// Run: npx vitest run test/bot-lease.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { createLease } = nodeRequire('../utils/botLease.js');

function makeClock() {
  let t = 1_000_000;
  let seq = 0;
  let timers = [];
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const h = { id: ++seq, at: t + ms, fn, unrefCalled: false, unref() { this.unrefCalled = true; } };
      timers.push(h);
      return h;
    },
    clearTimeout(h) { timers = timers.filter((x) => x !== h); },
    pending: () => timers.length,
    all: () => timers,
    async advance(ms) {
      const target = t + ms;
      await flush();
      for (;;) {
        const due = timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = Math.max(t, due.at);
        due.fn();
        await flush();
      }
      t = target;
      await flush();
    },
  };
}

// In-memory SQL semantics: name -> { holder, expiresAt }.
function makeStore(clock) {
  const rows = new Map();
  const calls = [];
  const rpc = async (fn, p) => {
    calls.push([fn, p]);
    if (fn === 'bot_lease_acquire') {
      const row = rows.get(p.p_name);
      if (!row || row.expiresAt <= clock.now() || row.holder === p.p_holder) {
        rows.set(p.p_name, { holder: p.p_holder, expiresAt: clock.now() + p.p_ttl_seconds * 1000 });
        return true;
      }
      return false;
    }
    if (fn === 'bot_lease_release') {
      const row = rows.get(p.p_name);
      if (row && row.holder === p.p_holder) rows.delete(p.p_name);
      return null;
    }
    return null;
  };
  return { rows, calls, rpc };
}

// Scripted responses: array consumed in order, last one repeats. Functions are called.
function scripted(responses) {
  const calls = [];
  let i = 0;
  const rpc = async (fn, p) => {
    calls.push([fn, p]);
    if (fn !== 'bot_lease_acquire') return null;
    const r = responses[Math.min(i++, responses.length - 1)];
    return typeof r === 'function' ? r() : r;
  };
  return { calls, rpc, acquires: () => calls.filter((c) => c[0] === 'bot_lease_acquire').length };
}

function mk(clock, rpc, extra = {}) {
  const logs = [];
  const lease = createLease({
    rpc, isEnabled: () => true, name: 'discord:test', holder: 'h1',
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    log: (m) => logs.push(m), ...extra,
  });
  return { lease, logs };
}

describe('disabled', () => {
  it('resolves immediately via disabled, holder, no rpc calls, renewing never starts', async () => {
    const clock = makeClock();
    const s = scripted([true]);
    const { lease } = mk(clock, s.rpc, { isEnabled: () => false });
    expect(await lease.waitForLease()).toEqual({ via: 'disabled' });
    expect(lease.isHolder()).toBe(true);
    lease.startRenewing(() => {});
    await clock.advance(60_000);
    await lease.release();
    expect(s.calls).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it('defaultLease honours BOT_LEASE=off', () => {
    const saved = process.env.BOT_LEASE;
    process.env.BOT_LEASE = 'off';
    const sbPath = nodeRequire.resolve('../utils/supabase.js');
    const leasePath = nodeRequire.resolve('../utils/botLease.js');
    delete nodeRequire.cache[leasePath];
    try {
      const fresh = nodeRequire('../utils/botLease.js');
      const d = fresh.defaultLease();
      expect(fresh.defaultLease()).toBe(d); // memoised
      expect(d.status().name).toMatch(/^discord:/);
      expect(d.status().holder).toMatch(/:[0-9a-f]{8}$/);
      return d.waitForLease().then((r) => {
        expect(r).toEqual({ via: 'disabled' });
        expect(sbPath).toBeTruthy();
      });
    } finally {
      if (saved === undefined) delete process.env.BOT_LEASE; else process.env.BOT_LEASE = saved;
      delete nodeRequire.cache[leasePath];
    }
  });
});

describe('acquiring', () => {
  it('true on the first try resolves acquired as holder', async () => {
    const clock = makeClock();
    const store = makeStore(clock);
    const { lease } = mk(clock, store.rpc);
    expect(lease.role()).toBe('starting');
    expect(await lease.waitForLease()).toEqual({ via: 'acquired' });
    expect(lease.role()).toBe('holder');
    expect(lease.isHolder()).toBe(true);
    expect(store.calls[0][1]).toEqual({ p_name: 'discord:test', p_holder: 'h1', p_ttl_seconds: 30 });
  });

  it('standby while another holds; polls every pollMs; takes over on expiry; two log lines only', async () => {
    const clock = makeClock();
    const store = makeStore(clock);
    store.rows.set('discord:test', { holder: 'other', expiresAt: clock.now() + 10_000 });
    const { lease, logs } = mk(clock, store.rpc);
    let result = null;
    lease.waitForLease().then((r) => { result = r; });
    await clock.advance(0);
    expect(lease.role()).toBe('standby');
    expect(result).toBe(null);
    await clock.advance(3_000);
    await clock.advance(3_000);
    expect(store.calls.length).toBe(3); // t=0, 3s, 6s: one per pollMs
    expect(result).toBe(null);
    await clock.advance(6_000); // 12s: expired at 10s
    expect(result).toEqual({ via: 'acquired' });
    expect(lease.role()).toBe('holder');
    expect(logs.length).toBe(2);
    expect(logs[0]).toBe('[lease] another bot holds discord:test; waiting as standby');
    expect(logs[1]).toMatch(/acquired/);
  });

  it('never uses console.warn or console.error', async () => {
    const clock = makeClock();
    const s = scripted([false, false, null, true]);
    const warns = [];
    const w = console.warn, e = console.error;
    console.warn = (...a) => warns.push(a); console.error = (...a) => warns.push(a);
    try {
      const lease = createLease({ rpc: s.rpc, isEnabled: () => true, name: 'n', holder: 'h',
        now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, log: () => {} });
      lease.waitForLease();
      await clock.advance(20_000);
    } finally { console.warn = w; console.error = e; }
    expect(warns).toEqual([]);
  });
});

describe('unknown (null) while waiting', () => {
  it('null for unknownGraceMs resolves fail_open with one log line', async () => {
    const clock = makeClock();
    const s = scripted([null]);
    const { lease, logs } = mk(clock, s.rpc);
    let result = null;
    lease.waitForLease().then((r) => { result = r; });
    await clock.advance(44_000);
    expect(result).toBe(null);
    expect(lease.isHolder()).toBe(false);
    await clock.advance(3_000);
    expect(result).toEqual({ via: 'fail_open' });
    expect(lease.isHolder()).toBe(true);
    expect(lease.role()).toBe('holder');
    expect(logs.length).toBe(1);
    expect(logs[0]).toMatch(/without the lease.*did not answer/);
  });

  it('a false resets the null run', async () => {
    const clock = makeClock();
    // nulls for ~30s, one false, then nulls again: grace restarts at the false
    const seq = [];
    for (let i = 0; i < 10; i++) seq.push(null);
    seq.push(false);
    seq.push(null);
    const s = scripted(seq);
    const { lease } = mk(clock, s.rpc);
    let result = null;
    lease.waitForLease().then((r) => { result = r; });
    await clock.advance(60_000); // would have failed open at 45s without the reset
    expect(result).toBe(null);
    await clock.advance(30_000);
    expect(result).toEqual({ via: 'fail_open' });
  });

  it('an rpc that throws counts as unknown', async () => {
    const clock = makeClock();
    const { lease } = mk(clock, async () => { throw new Error('boom'); });
    let result = null;
    lease.waitForLease().then((r) => { result = r; });
    await clock.advance(50_000);
    expect(result).toEqual({ via: 'fail_open' });
  });
});

describe('renewing', () => {
  it('calls acquire every renewMs and keeps the row alive past the ttl', async () => {
    const clock = makeClock();
    const store = makeStore(clock);
    const { lease } = mk(clock, store.rpc);
    await lease.waitForLease();
    let lost = 0;
    lease.startRenewing(() => lost++);
    await clock.advance(120_000);
    expect(store.calls.length).toBe(1 + 12);
    expect(lost).toBe(0);
    expect(lease.isHolder()).toBe(true);
    expect(store.rows.get('discord:test').holder).toBe('h1');
  });

  it('null keeps holding, logs once per null run, and keeps renewing', async () => {
    const clock = makeClock();
    const s = scripted([true, null, null, null, true, null]);
    const { lease, logs } = mk(clock, s.rpc);
    await lease.waitForLease();
    let lost = 0;
    lease.startRenewing(() => lost++);
    await clock.advance(30_000); // renews at 10, 20, 30: null x3
    expect(lease.isHolder()).toBe(true);
    expect(lost).toBe(0);
    expect(logs.filter((l) => /did not answer/.test(l)).length).toBe(1);
    await clock.advance(20_000); // true then null: a second run logs again
    expect(logs.filter((l) => /did not answer/.test(l)).length).toBe(2);
    expect(lease.isHolder()).toBe(true);
  });

  it('false stops renewing, goes standby, calls onLost exactly once', async () => {
    const clock = makeClock();
    const s = scripted([true, true, false, true]);
    const { lease } = mk(clock, s.rpc);
    await lease.waitForLease();
    let lost = 0;
    lease.startRenewing(() => lost++);
    await clock.advance(100_000);
    expect(lost).toBe(1);
    expect(lease.role()).toBe('standby');
    expect(lease.isHolder()).toBe(false);
    expect(s.acquires()).toBe(3); // initial + 2 renewals, then it stopped
    expect(clock.pending()).toBe(0);
  });

  it('fail_open still renews, and a false there calls onLost', async () => {
    const clock = makeClock();
    let answer = null;
    const s = scripted([() => answer]);
    const { lease } = mk(clock, s.rpc, { renewMs: 10_000 });
    let result = null;
    lease.waitForLease().then((r) => { result = r; });
    await clock.advance(50_000);
    expect(result).toEqual({ via: 'fail_open' });
    let lost = 0;
    lease.startRenewing(() => lost++);
    const before = s.acquires();
    await clock.advance(10_000);
    expect(s.acquires()).toBe(before + 1);
    expect(lost).toBe(0);
    answer = true; // the store answers: we take the row
    await clock.advance(10_000);
    expect(lost).toBe(0);
    answer = false; // someone else really holds it
    await clock.advance(10_000);
    expect(lost).toBe(1);
    expect(lease.isHolder()).toBe(false);
  });

  it('takeover scenario: a holder that is superseded is told it lost', async () => {
    const clock = makeClock();
    const store = makeStore(clock);
    const { lease } = mk(clock, store.rpc);
    await lease.waitForLease();
    let lost = 0;
    lease.startRenewing(() => lost++);
    store.rows.set('discord:test', { holder: 'other', expiresAt: clock.now() + 60_000 });
    await clock.advance(10_000);
    expect(lost).toBe(1);
  });
});

describe('release', () => {
  it('stops renewing and releases once; second call is a no-op; not a holder afterwards', async () => {
    const clock = makeClock();
    const store = makeStore(clock);
    const { lease } = mk(clock, store.rpc);
    await lease.waitForLease();
    lease.startRenewing(() => {});
    await lease.release();
    await lease.release();
    const rel = store.calls.filter((c) => c[0] === 'bot_lease_release');
    expect(rel.length).toBe(1);
    expect(rel[0][1]).toEqual({ p_name: 'discord:test', p_holder: 'h1' });
    expect(store.rows.has('discord:test')).toBe(false);
    expect(lease.isHolder()).toBe(false);
    const n = store.calls.length;
    await clock.advance(60_000);
    expect(store.calls.length).toBe(n); // no renewals after release
    expect(clock.pending()).toBe(0);
  });

  it('releases a fail_open hold too', async () => {
    const clock = makeClock();
    const s = scripted([null]);
    const { lease } = mk(clock, s.rpc);
    lease.waitForLease();
    await clock.advance(50_000);
    await lease.release();
    expect(s.calls.filter((c) => c[0] === 'bot_lease_release').length).toBe(1);
  });

  it('a standby stopped while its acquire is in flight gives a won row straight back and never becomes holder', async () => {
    // 2026-11-11: a standby being shut down mid-deploy took the lease on its way out; the next bot waited out the TTL.
    const clock = makeClock();
    const store = makeStore(clock);
    store.rows.set('discord:test', { holder: 'old', expiresAt: clock.now() + 30_000 });
    let gate;
    const rpc = async (fn, p) => {
      if (fn === 'bot_lease_acquire' && store.rows.get('discord:test')?.holder === 'old' && gate === undefined) {
        // the old holder lets go while our acquire is on the wire
        await new Promise((r) => { gate = r; });
        store.rows.delete('discord:test');
      }
      return store.rpc(fn, p);
    };
    const { lease } = mk(clock, rpc);
    let resolved = false;
    lease.waitForLease().then(() => { resolved = true; });
    await clock.advance(0);
    lease.release();          // SIGTERM lands while the acquire is in flight
    gate();
    await clock.advance(10_000);
    expect(resolved).toBe(false);
    expect(lease.isHolder()).toBe(false);
    expect(store.rows.has('discord:test')).toBe(false);   // taken and handed straight back
    expect(store.calls.filter((c) => c[0] === 'bot_lease_release').length).toBe(1);
  });

  it('does not call release when disabled or after losing the lease', async () => {
    const clock = makeClock();
    const s = scripted([true, false]);
    const { lease } = mk(clock, s.rpc);
    await lease.waitForLease();
    lease.startRenewing(() => {});
    await clock.advance(10_000);
    await lease.release();
    expect(s.calls.filter((c) => c[0] === 'bot_lease_release').length).toBe(0);

    const s2 = scripted([true]);
    const d = mk(makeClock(), s2.rpc, { isEnabled: () => false }).lease;
    await d.waitForLease();
    await d.release();
    expect(s2.calls).toEqual([]);
  });

  it('swallows rpc errors and caps a hung release at 3 s', async () => {
    const clock = makeClock();
    const calls = [];
    const rpc = async (fn) => {
      calls.push(fn);
      if (fn === 'bot_lease_acquire') return true;
      return new Promise(() => {}); // never answers
    };
    const { lease } = mk(clock, rpc);
    await lease.waitForLease();
    let done = false;
    lease.release().then(() => { done = true; });
    await clock.advance(2_900);
    expect(done).toBe(false);
    await clock.advance(200);
    expect(done).toBe(true);

    const bad = mk(makeClock(), async (fn) => { if (fn === 'bot_lease_acquire') return true; throw new Error('x'); }).lease;
    await bad.waitForLease();
    await expect(bad.release()).resolves.toBeUndefined();
  });
});

describe('timers', () => {
  it('every handle goes through the injected setTimeout and is unref\'d', async () => {
    const clock = makeClock();
    const store = makeStore(clock);
    store.rows.set('discord:test', { holder: 'other', expiresAt: clock.now() + 5_000 });
    const { lease } = mk(clock, store.rpc);
    const p = lease.waitForLease();
    await clock.advance(1);
    expect(clock.all().length).toBeGreaterThan(0);
    await clock.advance(6_000);
    await p;
    lease.startRenewing(() => {});
    expect(clock.all().length).toBe(1);
    expect(clock.all().every((h) => h.unrefCalled)).toBe(true);
  });
});

describe('status', () => {
  it('is small and carries no secrets', async () => {
    const clock = makeClock();
    const store = makeStore(clock);
    const { lease } = mk(clock, store.rpc);
    await lease.waitForLease();
    const s = lease.status();
    expect(Object.keys(s).sort()).toEqual(['holder', 'name', 'role', 'since', 'via']);
    expect(s).toMatchObject({ role: 'holder', name: 'discord:test', holder: 'h1', via: 'acquired' });
  });
});
