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
    return { _syncListEndpoint, _lastFullSweepAt, calls };
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
