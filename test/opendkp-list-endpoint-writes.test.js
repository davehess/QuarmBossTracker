// test/opendkp-list-endpoint-writes.test.js — the OpenDKP list sync must not
// rewrite rows it already holds.
//
// The bug this locks down (measured 2026-08-07, bot 3.1.x):
//   opendkp_audits — 47,279 rows, 47,279 inserts, 0 deletes … and
//   141,184,337 UPDATEs. ~2,986 rewrites per row, and 3,170 autovacuum cycles
//   against 36 on chat_messages and 26 on encounter_threat_snapshots.
//
// Cause: _syncListEndpoint stamped `fetched_at: new Date().toISOString()` on
// every row of every page and wrote with PostgREST `merge-duplicates`
// (ON CONFLICT DO UPDATE). fetched_at differs on every run by construction, so
// every one of the 48 daily runs rewrote the entire table even when the
// upstream payload was byte-identical. The tell: all 47,279 rows carried a
// fetched_at inside the same 9.4-second window.
//
// Audits and adjustments are append-only logs — a row that exists upstream
// never changes — so the write is now insert-only (ON CONFLICT DO NOTHING),
// watermarked by max(id) so known rows are not even sent.
//
// Run: npx vitest run test/opendkp-list-endpoint-writes.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';
import path from 'node:path';

const SRC = path.join(ROOT, 'utils', 'openDkpSync.js');
const src = readSource(SRC);

// Slice the real helper block + the walk itself, so the watermark and
// full-sweep logic under test are the shipped ones, not a paraphrase.
const block = sliceBlock(
  src,
  'function _pkColFor(idKeys) {',
  '\n    full_sweep: fullSweep,\n  };\n}',
);

const srcText = src;
// _inRaidWindow is pure; slice it out and exercise the shipped copy directly.
const _raidFn = new Function('return ' + src.slice(
  src.indexOf('function _inRaidWindow'),
  src.indexOf('function _backoffCapMs')).trim())();
const h_inRaid = (d) => _raidFn(d);

// NOTE: _pkColFor sits ABOVE the backoff helpers in the file, so the original
// block already carries them — no second slice needed. (Two earlier attempts
// got this wrong in opposite directions: moving the start marker dropped
// _pkColFor, and prepending a second slice declared _idleStreak twice.)
function build({ mirroredIds = [], pages = [], envHours = null } = {}) {
  const calls = { selects: [], inserts: [], upserts: [] };
  const harness = `
    const AUDIT_PAGE_LIMIT = 25;
    const _mirrored = new Set(${JSON.stringify(mirroredIds)});
    const supabase = {
      isEnabled: () => true,
      async select(table, q) {
        calls.selects.push({ table, q });
        const max = _mirrored.size ? Math.max(...[..._mirrored]) : null;
        // Mimic PostgREST: array of rows, or [] when the table is empty.
        return max == null ? [] : [{ audit_id: max, adjustment_id: max }];
      },
      async insertIgnoreDuplicates(table, rows) {
        calls.inserts.push({ table, rows });
        for (const r of rows) _mirrored.add(Number(r.audit_id ?? r.adjustment_id));
        return null;   // return=minimal → empty body → _request yields null
      },
      async upsert(table, rows, pk) {
        calls.upserts.push({ table, rows, pk });   // must never be called
        return rows;
      },
    };
    function _envNum(name, dflt) { return ${envHours == null ? 'dflt' : envHours}; }
    function _firstNumber(row, ...keys) {
      for (const k of keys) { const v = row?.[k]; if (typeof v === 'number') return v; }
      return null;
    }
    function _firstString(row, ...keys) {
      for (const k of keys) { const v = row?.[k]; if (typeof v === 'string' && v) return v; }
      return null;
    }
    const console = { log() {}, warn() {} };
  ` + block + `
    // Pin the raid-window check OFF. Without this the backoff tests depend on
    // the wall clock and fail during an actual raid window (Sun/Wed/Thu evening
    // ET) — which is precisely when someone is most likely to be running the
    // suite. The window's own behaviour is asserted separately, from the pure
    // function, in the 'never backs off during a raid window' cases.
    _inRaidWindow = () => false;
    return { _syncListEndpoint, _lastFullSweepAt, _nextDueAt, _idleStreak, _lastPageHint,
             _lastSweepAnchor, _sweepDecision, calls };
  `;
  // eslint-disable-next-line no-new-func
  const made = new Function('calls', harness)(calls);

  const remaining = pages.slice();
  const fetchPage = async () => remaining.shift() ?? { Audits: [] };
  return { ...made, fetchPage, calls };
}

// A sweep marker old enough to be due under ANY schedule — past the 96h safety
// net, so these cases don't depend on which day of the week the suite runs.
// (Before 2026-08-27 they relied on "no marker → sweep due"; a cold process now
// adopts the current anchor instead, because a per-boot full sweep was most of
// what remained of the audits bill.)
const SWEEP_DUE = () => Date.now() - 8 * 24 * 3600 * 1000;

const AUDIT_ARGS = {
  label: 'audits',
  table: 'opendkp_audits',
  idKeys: ['AuditId', 'Id', 'audit_id'],
  tsKeys: ['Timestamp', 'CreatedAt', 'Date', 'timestamp'],
};

const audits = (...ids) => ({
  Audits: ids.map(id => ({ AuditId: id, Timestamp: '2026-08-07T03:32:45Z', Action: 'Raid Updated' })),
  TotalPages: 1,
  CurrentPage: 1,
});

// Multi-page variant for the early-break cases: page N of M.
const auditsPage = (page, totalPages, ...ids) => ({
  ...audits(...ids), TotalPages: totalPages, CurrentPage: page,
});

describe('_syncListEndpoint write path', () => {
  it('never uses merge-duplicates — the write is insert-only', async () => {
    const h = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3, 4)] });
    await h._syncListEndpoint({ ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true } });
    expect(h.calls.upserts).toHaveLength(0);
  });

  it('sends nothing when the walk finds no new rows (the 141M-update bug)', async () => {
    const h = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3)] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());   // not due for a sweep

    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });

    expect(h.calls.inserts).toHaveLength(0);
    expect(res.upserted).toBe(0);
    expect(res.offered).toBe(0);
    expect(res.pages).toBe(1);          // it still walked — it just wrote nothing
  });

  it('sends only rows above the watermark', async () => {
    const h = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3, 4, 5)] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());

    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });

    expect(h.calls.inserts).toHaveLength(1);
    expect(h.calls.inserts[0].rows.map(r => r.audit_id)).toEqual([4, 5]);
    expect(res.upserted).toBe(2);
  });

  it('offers every row on a full sweep, but still counts only new ones', async () => {
    const h = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3, 4)] });
    h._lastFullSweepAt.set('opendkp_audits', SWEEP_DUE());

    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });

    expect(res.full_sweep).toBe(true);
    expect(h.calls.inserts[0].rows.map(r => r.audit_id)).toEqual([1, 2, 3, 4]);
    expect(res.offered).toBe(4);
    expect(res.upserted).toBe(1);       // only #4 is genuinely new
  });

  it('stops sweeping once one has run, and resumes at the next anchor', async () => {
    const h = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3), audits(1, 2, 3)] });
    h._lastFullSweepAt.set('opendkp_audits', SWEEP_DUE());

    const first = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(first.full_sweep).toBe(true);

    const second = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(second.full_sweep).toBe(false);
    expect(second.offered).toBe(0);

    // Age the marker past every anchor → due again.
    const h2 = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3)] });
    h2._lastFullSweepAt.set('opendkp_audits', SWEEP_DUE());
    const third = await h2._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h2.fetchPage, shapeFlag: { value: true },
    });
    expect(third.full_sweep).toBe(true);
  });

  it('treats an empty mirror as watermark 0 and inserts everything', async () => {
    const h = build({ mirroredIds: [], pages: [audits(7, 8)] });
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(h.calls.inserts[0].rows.map(r => r.audit_id)).toEqual([7, 8]);
    expect(res.upserted).toBe(2);
  });

  it('derives the PK column from the first id key', async () => {
    const h = build({ mirroredIds: [], pages: [audits(1)] });
    await h._syncListEndpoint({ ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true } });
    expect(h.calls.selects[0].q).toContain('select=audit_id');
    expect(h.calls.inserts[0].rows[0]).toHaveProperty('audit_id', 1);
  });
});

// ── Early break (2026-08-25, the Moncs incident) ─────────────────────────────
// The endpoints have no "since" filter, so before this the walk pulled every
// page every run — OpenDKP re-serialised its whole 48k-row audit table 48×/day
// for three months. Pages are newest-first, so a page with nothing above our
// watermark means every later page is older still. The break requires PROOF of
// newest-first ordering (page 1's max id >= watermark); anything else walks
// exactly as before.
describe('_syncListEndpoint early break', () => {
  it('stops after page 1 when nothing is new (the steady state)', async () => {
    const h = build({ mirroredIds: [10, 11, 12], pages: [
      auditsPage(1, 3, 12, 11, 10), auditsPage(2, 3, 9, 8), auditsPage(3, 3, 7),
    ] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(res.pages).toBe(1);          // pages 2 and 3 were never requested
    expect(h.calls.inserts).toHaveLength(0);
  });

  it('walks exactly to the first all-known page, writing the fresh rows first', async () => {
    const h = build({ mirroredIds: [10], pages: [
      auditsPage(1, 3, 13, 12, 11), auditsPage(2, 3, 10, 9), auditsPage(3, 3, 8),
    ] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(res.pages).toBe(2);          // page 3 skipped
    expect(res.upserted).toBe(3);       // 13, 12, 11 written before the break
  });

  it('never breaks on page 1 when the ordering is oldest-first', async () => {
    // Oldest-first puts the SMALLEST ids on page 1 — all below the watermark.
    // Breaking there would silently miss the new tail pages. (It no longer
    // walks pages 2..N either; see the cold-start jump below. What matters
    // here is that the new tail rows are still caught.)
    const h = build({ mirroredIds: [100], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    const byPage = { 1: [1, 2, 3], 2: [4, 5], 3: [101, 102] };
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => ({ ...auditsPage(p, 3, ...(byPage[p] || [])) }),
    });
    expect(res.upserted).toBe(2);       // still caught 101, 102
  });

  it('a full sweep still walks every page', async () => {
    const h = build({ mirroredIds: [10, 11, 12], pages: [
      auditsPage(1, 3, 12, 11, 10), auditsPage(2, 3, 9), auditsPage(3, 3, 8),
    ] });
    h._lastFullSweepAt.set('opendkp_audits', SWEEP_DUE());
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(res.full_sweep).toBe(true);
    expect(res.pages).toBe(3);
  });
});

// ── Idle backoff (2026-08-26) ───────────────────────────────────────────────
// Hitya, looking at the live counter: "the dkp numbers don't change outside of
// raids unless we have to override something. why are we auditing so
// frequently". Measured that day: 17 calls / 6.2 MB EVERY 30 MINUTES, byte for
// byte identical — 297 MB/day spent discovering nothing had happened. The
// endpoint has no `since` filter and does not page newest-first, so there is no
// cheap way to ASK; the fix is to ask less often when the answer keeps being no.
describe('idle backoff', () => {
  const buildB = (over = {}) => {
    const h = build(over);
    // Reach into the sliced module's own state, so these exercise the SHIPPED
    // maps rather than a paraphrase of them.
    return h;
  };

  it('skips the walk entirely — no HTTP — once backed off', async () => {
    const h = buildB({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3), audits(1, 2, 3)] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    const first = await h._syncListEndpoint({ ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true } });
    expect(first.pages).toBe(1);                 // it walked once and found nothing

    const second = await h._syncListEndpoint({ ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true } });
    expect(second.skipped).toBe('idle-backoff');
    expect(second.pages).toBe(0);                // the point: zero calls made
  });

  it('resets the moment something new appears', async () => {
    const h = buildB({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3), audits(1, 2, 3, 4)] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    await h._syncListEndpoint({ ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true } });
    // Force the backoff to have elapsed, then a pass that DOES find a new row.
    h._nextDueAt.delete('opendkp_audits');
    const withNew = await h._syncListEndpoint({ ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true } });
    expect(withNew.upserted).toBe(1);
    expect(h._nextDueAt.get('opendkp_audits')).toBeUndefined();   // streak cleared
  });

  it('never backs off during a raid window', () => {
    // DKP moves during raids; a 6h delay there would be the one time it matters.
    // Sun/Wed/Thu 8pm-midnight ET, hour either side.
    // (First draft used Aug 30 01:00Z, which is SATURDAY 21:00 ET — not a raid
    // night at all, so it asserted the opposite of what it claimed.)
    expect(h_inRaid(new Date('2026-08-31T01:00:00Z'))).toBe(true);   // Sun 21:00 ET
    expect(h_inRaid(new Date('2026-08-27T01:00:00Z'))).toBe(true);   // Wed 21:00 ET
  });

  it('DOES back off on a non-raid night', () => {
    // Without this the raid-window test would pass on a function that always
    // returned true, which would disable the backoff entirely.
    expect(h_inRaid(new Date('2026-08-26T01:00:00Z'))).toBe(false);  // Mon 21:00 ET
    expect(h_inRaid(new Date('2026-08-27T18:00:00Z'))).toBe(false);  // Thu 14:00 ET
  });

  it('is disableable, so a bad backoff can never wedge the sync', () => {
    expect(srcText).toContain('OPENDKP_LIST_IDLE_BACKOFF');
    expect(srcText).toContain('OPENDKP_LIST_IDLE_MAX_HOURS');
  });
});

// ── Oldest-first fast path (2026-08-26, PROVED not assumed) ─────────────────
// The ordering probe shipped in 3.1.75 logged, from production:
//
//   audits: page1 ids 1669729..1968002 vs watermark 4627656 — NOT newest-first
//
// Page 1 holds the OLDEST audits by 2.7 MILLION ids, so a forward walk from
// page 1 can never reach a new row. The logs confirm the waste exactly:
// `audits_pages: 17, audits_offered: 0`, every pass, 6.2 MB a time.
//
// New rows land at the END, so the fast path checks the LAST page and stops.
describe('oldest-first fast path', () => {
  const paged = (page, total, ...ids) => ({
    Audits: ids.map(id => ({ AuditId: id, Timestamp: '2026-08-26T03:32:45Z', Action: 'Raid Updated' })),
    TotalPages: total, CurrentPage: page,
  });

  it('learns the page count from a normal walk', async () => {
    const h = build({ mirroredIds: [10], pages: [paged(1, 3, 10)] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    await h._syncListEndpoint({ ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true } });
    expect(h._lastPageHint.get('opendkp_audits')).toBe(3);
  });

  it('then checks ONLY the last page and stops — 1 call, not 17', async () => {
    const h = build({ mirroredIds: [10], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    h._lastPageHint.set('opendkp_audits', 17);
    h._nextDueAt.delete('opendkp_audits');
    const asked = [];
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 17, 9, 10); },  // all <= watermark
    });
    expect(asked).toEqual([17]);                 // the whole point
    expect(res.fast_path).toBe('last-page');
    expect(res.pages).toBe(1);
  });

  it('follows the page count when it has grown since we cached it', async () => {
    const h = build({ mirroredIds: [10], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    h._lastPageHint.set('opendkp_audits', 17);
    h._nextDueAt.delete('opendkp_audits');
    const asked = [];
    await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 18, 9, 10); },
    });
    expect(asked).toEqual([17, 18]);             // corrected itself, still cheap
    expect(h._lastPageHint.get('opendkp_audits')).toBe(18);
  });

  it('COLLECTS new rows from the last page in one call — the raid-night case', async () => {
    // v1 fell through to the full 17-page walk whenever the last page held
    // anything new, and during a raid EVERY pass does (loot and ticks generate
    // audits). So the "fast" path was fast only while idle and reverted to
    // 6.2 MB a pass exactly when raiding. Oldest-first means new rows APPEND,
    // so the last page already has them — there is nothing to go back for.
    const h = build({ mirroredIds: [10], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    h._lastPageHint.set('opendkp_audits', 2);
    h._nextDueAt.delete('opendkp_audits');
    const asked = [];
    const byPage = { 1: [8, 9], 2: [10, 11] };   // 11 is above the watermark
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 2, ...(byPage[p] || [])); },
    });
    expect(asked).toEqual([2]);                  // ONE call, not the whole walk
    expect(res.fast_path).toBe('last-page');
    expect(res.upserted).toBe(1);
    expect(h.calls.inserts[0].rows.map(r => r.audit_id)).toEqual([11]);
  });

  it('falls through only when the last page is ENTIRELY new (a page rollover)', async () => {
    // If every row on the last page is fresh, the boundary is on an earlier
    // page and we genuinely do have to go back. At ~37 audits/day against a
    // ~2,800-row page that is roughly a once-every-couple-of-months event.
    const h = build({ mirroredIds: [10], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    h._lastPageHint.set('opendkp_audits', 2);
    h._nextDueAt.delete('opendkp_audits');
    const asked = [];
    const byPage = { 1: [9, 10], 2: [11, 12] };  // page 2 is 100% above watermark
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 2, ...(byPage[p] || [])); },
    });
    expect(res.fast_path).toBeUndefined();
    expect(asked.length).toBeGreaterThan(1);
  });

  it('a full sweep still walks everything, fast path or not', async () => {
    const h = build({ mirroredIds: [10], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', SWEEP_DUE());
    h._lastPageHint.set('opendkp_audits', 2);
    const asked = [];
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 2, 9, 10); },
    });
    expect(res.full_sweep).toBe(true);
    expect(asked[0]).toBe(1);                    // never short-circuited
  });

  it('an unknown payload shape does NOT read as "nothing new"', async () => {
    // Silently treating an unrecognised response as empty would stop the sync
    // dead while reporting success — the worst possible failure here.
    const h = build({ mirroredIds: [10], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    h._lastPageHint.set('opendkp_audits', 2);
    h._nextDueAt.delete('opendkp_audits');
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async () => ({ Unexpected: 'shape' }),
    });
    expect(res.fast_path).toBeUndefined();       // fell through, did not claim done
  });
});

// ── Raid-anchored full sweep (Hitya, 2026-08-27) ────────────────────────────
// "we don't need a full download that often, just before a raid. three times
// a week." The full sweep re-offers EVERY row — 17 pages / 6.2 MB on audits —
// so its cadence IS the bill. A 24h rolling timer fired it at whatever time of
// day the process last booted, which on 2026-08-26 was mid-raid.
//
// August 2026 is EDT (UTC-4), so the 6pm ET anchor is 22:00Z. 2026-08-23 is a
// Sunday, -26 a Wednesday, -27 a Thursday.
describe('full sweep anchors to raid nights', () => {
  const H = build();
  const anchor = (iso) => new Date(H._lastSweepAnchor(new Date(iso).getTime())).toISOString();

  it('lands on 6pm ET of the raid day once that hour has passed', () => {
    expect(anchor('2026-08-26T23:00:00Z')).toBe('2026-08-26T22:00:00.000Z');  // Wed 19:00 ET
  });

  it('reaches BACK to the previous raid night before the hour arrives', () => {
    // Wed 17:00 ET — the anchor is still Sunday's. Without this the sweep would
    // fire at midnight on a raid day, i.e. at an arbitrary hour again.
    expect(anchor('2026-08-26T21:00:00Z')).toBe('2026-08-23T22:00:00.000Z');  // Sun
  });

  it('holds the Thursday anchor across the whole Fri/Sat gap', () => {
    expect(anchor('2026-08-28T12:00:00Z')).toBe('2026-08-27T22:00:00.000Z');  // Fri
    expect(anchor('2026-08-29T23:00:00Z')).toBe('2026-08-27T22:00:00.000Z');  // Sat
  });

  it('produces exactly THREE anchors a week — the whole ask', () => {
    // Sample every hour for a week. A mutation that widened the anchor days,
    // or that fell back to a rolling interval, changes this count.
    const start = new Date('2026-08-23T00:00:00Z').getTime();
    const seen = new Set();
    for (let h = 0; h < 24 * 7; h++) seen.add(H._lastSweepAnchor(start + h * 3600 * 1000));
    // 3 anchors inside the week, plus the one carried in from the Thursday
    // before it (Sun 00:00Z is Sat 8pm ET, still on the prior anchor).
    expect(seen.size).toBe(4);
    const days = [...seen].sort().map(ms =>
      new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric' }));
    expect(days.map(d => d.replace(',', ''))).toEqual(['Thu 6 PM', 'Sun 6 PM', 'Wed 6 PM', 'Thu 6 PM']);
  });

  it('a cold process adopts the anchor instead of sweeping', () => {
    // THE point of the change. main takes 12-42 pushes a day and the marker is
    // process-local, so "no marker → sweep" meant a 6.2 MB full download per
    // deploy — measured 2026-08-27: three deploys inside ten minutes, 17 calls
    // and 6.2 MB apiece.
    const now = new Date('2026-08-26T23:00:00Z').getTime();
    const d = H._sweepDecision(null, now, H._lastSweepAnchor(now), 96 * 3600 * 1000);
    expect(d.due).toBe(false);
    expect(d.adopt).toBe(H._lastSweepAnchor(now));
  });

  it('sweeps once an anchor has passed since the last one', () => {
    const now  = new Date('2026-08-26T23:00:00Z').getTime();   // Wed 19:00 ET
    const anch = H._lastSweepAnchor(now);                      // Wed 18:00 ET
    const max  = 96 * 3600 * 1000;
    expect(H._sweepDecision(anch - 1, now, anch, max).due).toBe(true);   // before it
    expect(H._sweepDecision(anch + 1, now, anch, max).due).toBe(false);  // after it
  });

  it('still has a max-age safety net if the anchor math is ever wrong', () => {
    const now = new Date('2026-08-26T23:00:00Z').getTime();
    const anch = H._lastSweepAnchor(now);
    // A marker in the FUTURE would never be < the anchor, so without the net a
    // clock skew could wedge the healing pass off forever.
    expect(H._sweepDecision(now - 200 * 3600 * 1000, now, anch, 96 * 3600 * 1000).due).toBe(true);
  });

  it('the cadence is tunable, so a bad anchor can be moved without a deploy', () => {
    expect(srcText).toContain('OPENDKP_LIST_FULL_SWEEP_HOUR_ET');
    expect(srcText).toContain('OPENDKP_LIST_FULL_SWEEP_MAX_HOURS');
  });
});

// ── Cold-start jump (2026-08-27) ────────────────────────────────────────────
// The last-page fast path needs a cached page count, and a fresh process has
// none — so every redeploy re-walked all 17 pages to re-learn what page 1 had
// just told it. Measured that night, the per-boot walk was most of what
// remained of the audits bill, dwarfing the periodic sweep.
describe('cold-start jump', () => {
  const paged = (page, total, ...ids) => ({
    Audits: ids.map(id => ({ AuditId: id, Timestamp: '2026-08-26T03:32:45Z', Action: 'Raid Updated' })),
    TotalPages: total, CurrentPage: page,
  });

  it('goes straight to the last page once page 1 proves oldest-first', async () => {
    const h = build({ mirroredIds: [100], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());   // not a sweep pass
    // deliberately NO _lastPageHint — this is a process that just booted
    const asked = [];
    const byPage = { 1: [1, 2, 3], 2: [4, 5], 3: [6, 7], 4: [99, 101] };
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 4, ...(byPage[p] || [])); },
    });
    expect(asked).toEqual([1, 4]);        // pages 2 and 3 never requested
    expect(res.upserted).toBe(1);         // and 101 still landed
    expect(h.calls.inserts[0].rows.map(r => r.audit_id)).toEqual([101]);
  });

  it('walks the middle when the last page is ENTIRELY new (a rollover)', async () => {
    // The one case the jump can be wrong about: the boundary sits on an
    // earlier page. Correctness wins — hand the saved calls back.
    const h = build({ mirroredIds: [100], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    const asked = [];
    const byPage = { 1: [1, 2], 2: [3, 4], 3: [99, 101], 4: [102, 103] };
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 4, ...(byPage[p] || [])); },
    });
    expect(asked).toEqual([1, 4, 2, 3]);  // jumped, backed off, never re-fetched 4
    expect(res.upserted).toBe(3);         // 102, 103 from the jump + 101 from page 3
  });

  it('does NOT jump when page 1 is newest-first — the early break owns that', async () => {
    const h = build({ mirroredIds: [100], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    const asked = [];
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 4, 100, 99, 98); },
    });
    expect(asked).toEqual([1]);           // broke on page 1, did not jump to 4
    expect(res.upserted).toBe(0);
  });

  it('a full sweep never jumps — it is the pass that must see everything', async () => {
    const h = build({ mirroredIds: [100], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', SWEEP_DUE());
    const asked = [];
    const byPage = { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [99, 101] };
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 4, ...(byPage[p] || [])); },
    });
    expect(res.full_sweep).toBe(true);
    expect(asked).toEqual([1, 2, 3, 4]);
  });
});
