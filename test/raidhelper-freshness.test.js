// test/raidhelper-freshness.test.js — noticing when the only copy stops arriving.
//
// The rh_* mirror is the ONLY durable record of who said they were coming: the
// Raid-Helper board upstream is cleared on raid day. So a sync that quietly
// stops working does not degrade, it deletes — permanently, silently, and with
// nothing anywhere saying so. It ran unmonitored for months.
//
// Two failures worth telling apart, because they need different answers:
//   • STALE  — nothing has synced in a long time. Key expired, host moved
//     (Raid-Helper has done that once already, .dev → .xyz), route changed.
//   • BLIND  — a raid is coming and we hold no sign-ups for it. The sync can
//     look healthy (events arriving) while the half that matters is empty.
//
// The alarm must also not cry wolf: it runs every 30 minutes and posts to an
// officer channel, so a rule that fires on an ordinary quiet Tuesday is a rule
// people learn to ignore, which is worse than no alarm.
//
// Run: npx vitest run test/raidhelper-freshness.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { assessFreshness, RH_STALE_HOURS, RH_BLIND_SPOT_HOURS } =
  require(path.join(ROOT, 'utils', 'raidhelperApi.js'));

const NOW = Date.parse('2026-08-14T04:00:00Z');
const hoursAgo = h => NOW - h * 3_600_000;
const hoursOut = h => NOW + h * 3_600_000;
const ev = (h, signupCount, id = 'e1') =>
  ({ id, title: 'Wolf Pack Raid', startMs: hoursOut(h), signupCount });

describe('a healthy sync says nothing', () => {
  it('is ok when it just ran and the next raid has sign-ups', () => {
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.05), upcoming: [ev(18, 34)] });
    expect(v.level).toBe('ok');
  });

  it('is ok with no upcoming raid at all', () => {
    // A quiet stretch between raid weeks is not a fault. Alarming here is how
    // an alarm gets muted.
    expect(assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.5), upcoming: [] }).level).toBe('ok');
  });

  it('is ok when the empty raid is still far away', () => {
    // Nobody has signed up for next week yet, and that is normal.
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.5),
                                upcoming: [ev(RH_BLIND_SPOT_HOURS + 10, 0)] });
    expect(v.level).toBe('ok');
  });

  it('does not fire just under the staleness threshold', () => {
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(RH_STALE_HOURS - 0.1),
                                upcoming: [ev(18, 34)] });
    expect(v.level).toBe('ok');
  });
});

describe('a mirror that stopped arriving', () => {
  it('fires once the last sync is old enough', () => {
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(RH_STALE_HOURS + 1), upcoming: [] });
    expect(v.level).toBe('stale');
    expect(v.reason).toBe('age');
    expect(v.ageHours).toBeGreaterThan(RH_STALE_HOURS);
  });

  it('fires when nothing has EVER synced', () => {
    // Distinct from "old": a fresh deploy with a bad key looks like this, and
    // "never" points at configuration rather than at an outage.
    for (const bad of [0, null, undefined, NaN]) {
      const v = assessFreshness({ nowMs: NOW, lastSyncMs: bad, upcoming: [ev(18, 34)] });
      expect(v.level).toBe('stale');
      expect(v.reason).toBe('never');
    }
  });

  it('outranks a blind spot — fix the sync first', () => {
    // Both are true at once; reporting "no sign-ups for Sunday" when the real
    // problem is that nothing syncs would send someone chasing the wrong thing.
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(RH_STALE_HOURS + 1),
                                upcoming: [ev(18, 0)] });
    expect(v.level).toBe('stale');
  });
});

describe('a raid we hold nothing for', () => {
  it('fires when the next raid inside the window has no sign-ups', () => {
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.5), upcoming: [ev(18, 0)] });
    expect(v.level).toBe('blind');
    expect(v.event.startMs).toBe(hoursOut(18));
  });

  it('names the SOONEST empty raid, not just any', () => {
    // Whichever one is about to have its board cleared is the urgent one.
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.5),
                                upcoming: [ev(RH_BLIND_SPOT_HOURS - 2, 0, 'later'), ev(6, 0, 'sooner')] });
    expect(v.event.id).toBe('sooner');
  });

  it('still reports a later empty raid when the soonest one is fine', () => {
    // It checks every raid inside the window, not just the next one — a healthy
    // Sunday does not excuse an empty Wednesday. The window (not the ordering)
    // is what keeps this quiet: anything further out than RH_BLIND_SPOT_HOURS
    // is simply not looked at, because not-yet-signed-up is normal out there.
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.5),
                                upcoming: [ev(6, 40, 'sooner'), ev(RH_BLIND_SPOT_HOURS - 2, 0, 'later')] });
    expect(v.level).toBe('blind');
    expect(v.event.id).toBe('later');
  });

  it('ignores raids already in the past', () => {
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.5),
                                upcoming: [{ id: 'past', title: 'x', startMs: hoursAgo(2), signupCount: 0 }] });
    expect(v.level).toBe('ok');
  });

  it('survives junk rows without alarming on them', () => {
    const v = assessFreshness({ nowMs: NOW, lastSyncMs: hoursAgo(0.5),
                                upcoming: [null, {}, { startMs: NaN, signupCount: 0 }] });
    expect(v.level).toBe('ok');
  });
});

describe('the alarm is wired up and latched', () => {
  const src = require('node:fs').readFileSync(path.join(ROOT, 'index.js'), 'utf8');

  it('runs after every sync, including a failed one', () => {
    // .finally, not .then — a sync that THREW is exactly when we most want the
    // freshness check to run.
    expect(src).toMatch(/\.finally\(\(\) => _checkRaidHelperFreshness\(\)/);
  });

  it('latches in bot_kv, not in memory', () => {
    // state.json does not survive a Railway deploy, so an in-process latch
    // would re-alarm on every redeploy — the eleven-raid-reviews trap.
    expect(src).toMatch(/_RH_FRESH_KEY = 'rh_freshness_alarm'/);
    expect(src).toMatch(/key: _RH_FRESH_KEY/);
  });

  it('keys the latch on the SHAPE of the problem, so a second kind still gets heard', () => {
    expect(src).toMatch(/verdict\.level \+ ':' \+ \(verdict\.event\?\.id \|\| verdict\.reason\)/);
  });

  it('clears the latch on recovery so the next episode alarms again', () => {
    expect(src).toMatch(/\[raidhelper-freshness\] recovered/);
  });

  it('never lets the check break the sync', () => {
    expect(src).toMatch(/_checkRaidHelperFreshness\(\)\.catch\(/);
  });
});

// The guild lead, 2026-11-02: "Raid-Helper sync has never landed" had posted dozens of times since August while the
// mirror was syncing every 30 minutes. Each post was ONE failed database read read as "never synced", and a single
// healthy check cleared the latch, so the next blip posted again.
describe('a failed read is no verdict, and a warning is not repeated within a day', () => {
  it('freshnessSnapshot answers null when a read fails (never "never synced")', async () => {
    const supabase = require(path.join(ROOT, 'utils', 'supabase.js'));
    const { freshnessSnapshot } = require(path.join(ROOT, 'utils', 'raidhelperApi.js'));
    const saved = { select: supabase.select, isEnabled: supabase.isEnabled };
    try {
      supabase.isEnabled = () => true;
      supabase.select = async () => null;
      expect(await freshnessSnapshot()).toBeNull();
      supabase.select = async (t) => (t === 'rh_signups' ? [{ synced_at: new Date().toISOString() }] : null);
      expect(await freshnessSnapshot()).toBeNull();
    } finally { Object.assign(supabase, saved); }
  });

  const src = require('node:fs').readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  const start = src.indexOf("const _RH_FRESH_KEY = 'rh_freshness_alarm';");
  const fnAt = src.indexOf('async function _checkRaidHelperFreshness() {', start);
  const end = src.indexOf('\n}\n', fnAt) + 3;
  function harness(kv, verdict) {
    const posts = [];
    const supabase = {
      isEnabled: () => true,
      select: async () => (kv.value ? [{ value: kv.value }] : []),
      upsert: async (_t, rows) => { kv.value = rows[0].value; },
    };
    const rh = { isEnabled: () => true, freshnessSnapshot: async () => ({}), assessFreshness: () => verdict() };
    const client = { channels: { fetch: async () => ({ send: async (m) => posts.push(m) }) } };
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'client', 'process', 'console',
      src.slice(start, end) + '\nreturn _checkRaidHelperFreshness;')(
      (p) => (p.endsWith('raidhelperApi') ? rh : supabase), client,
      { env: { OFFICER_ALERT_CHANNEL_ID: '1' } }, { log() {}, warn() {} });
    return { fn, posts };
  }
  const stale = { level: 'stale', reason: 'never', ageHours: 0, event: null };
  const ok = { level: 'ok', reason: null, ageHours: 0, event: null };

  it('alarm, recovery, the same alarm again: posted once', async () => {
    const kv = {};
    let v = stale;
    const { fn, posts } = harness(kv, () => v);
    await fn(); v = ok; await fn(); v = stale; await fn();
    expect(posts).toHaveLength(1);
    expect(kv.value).toMatchObject({ lastKey: 'stale:never' });   // recovery kept what was said, and when
  });

  it('a day later the same problem is heard again', async () => {
    const kv = { value: { lastKey: 'stale:never', lastAt: new Date(Date.now() - 25 * 3600_000).toISOString() } };
    const { fn, posts } = harness(kv, () => stale);
    await fn();
    expect(posts).toHaveLength(1);
  });
});
