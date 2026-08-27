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
    return { _syncListEndpoint, _lastFullSweepAt, _nextDueAt, _idleStreak, _lastPageHint, calls };
  `;
  // eslint-disable-next-line no-new-func
  const made = new Function('calls', harness)(calls);

  const remaining = pages.slice();
  const fetchPage = async () => remaining.shift() ?? { Audits: [] };
  return { ...made, fetchPage, calls };
}

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
    // no _lastFullSweepAt entry → first run for this table → sweep is due

    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });

    expect(res.full_sweep).toBe(true);
    expect(h.calls.inserts[0].rows.map(r => r.audit_id)).toEqual([1, 2, 3, 4]);
    expect(res.offered).toBe(4);
    expect(res.upserted).toBe(1);       // only #4 is genuinely new
  });

  it('stops sweeping once one has run, and resumes after the interval', async () => {
    const h = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3), audits(1, 2, 3)] });

    const first = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(first.full_sweep).toBe(true);

    const second = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(second.full_sweep).toBe(false);
    expect(second.offered).toBe(0);

    // Age the marker past the 24h default → due again.
    h._lastFullSweepAt.set('opendkp_audits', Date.now() - 25 * 3600 * 1000);
    const h2 = build({ mirroredIds: [1, 2, 3], pages: [audits(1, 2, 3)] });
    h2._lastFullSweepAt.set('opendkp_audits', Date.now() - 25 * 3600 * 1000);
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

  it('refuses to break when page 1 disproves newest-first ordering', async () => {
    // Oldest-first would put the SMALLEST ids on page 1 — all below the
    // watermark. Breaking there would silently miss the new tail pages.
    const h = build({ mirroredIds: [100], pages: [
      auditsPage(1, 3, 1, 2, 3), auditsPage(2, 3, 4, 5), auditsPage(3, 3, 101, 102),
    ] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, fetchPage: h.fetchPage, shapeFlag: { value: true },
    });
    expect(res.pages).toBe(3);          // walked everything, exactly as before
    expect(res.upserted).toBe(2);       // and still caught 101, 102
  });

  it('a full sweep still walks every page', async () => {
    const h = build({ mirroredIds: [10, 11, 12], pages: [
      auditsPage(1, 3, 12, 11, 10), auditsPage(2, 3, 9), auditsPage(3, 3, 8),
    ] });
    // no sweep marker → sweep due
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

  it('falls through to the full walk when the last page HAS something new', async () => {
    // Correctness beats cheapness: new rows must still be collected properly.
    const h = build({ mirroredIds: [10], pages: [] });
    h._lastFullSweepAt.set('opendkp_audits', Date.now());
    h._lastPageHint.set('opendkp_audits', 2);
    h._nextDueAt.delete('opendkp_audits');
    const asked = [];
    // Realistic paging: distinct rows per page, newest at the END (oldest-first).
    // My first fixture returned the SAME rows on every page, which double-counted
    // the fresh row and told me nothing.
    const byPage = { 1: [8, 9], 2: [10, 11] };   // 11 is above the watermark
    const res = await h._syncListEndpoint({
      ...AUDIT_ARGS, shapeFlag: { value: true },
      fetchPage: async (p) => { asked.push(p); return paged(p, 2, ...(byPage[p] || [])); },
    });
    expect(res.fast_path).toBeUndefined();
    expect(asked.length).toBeGreaterThan(1);
    expect(res.upserted).toBe(1);
  });

  it('a full sweep still walks everything, fast path or not', async () => {
    const h = build({ mirroredIds: [10], pages: [] });
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
