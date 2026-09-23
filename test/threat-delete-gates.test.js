// Threat snapshots may only be deleted once they are BOTH on the on-prem archive
// and folded into a stored per-fight graph. The guild lead, 2026-09-22: "per fight,
// consolidate the threat data into a flattened graph, married up with the player
// deaths from those fights. make sure that the data isn't removed from the
// on-prem database then make deletions from the table".
//
// Two deletion paths run at midnight — the 30-day sweep and the 7-day thinning.
// The thinning had NO gate until 2026-09-23 and was dormant only because it
// timed out on a missing index. These tests run the real cutoff rule and check,
// on comment-stripped source, that both paths take it and that the graphs are
// built before either runs.
//
// Run: npx vitest run test/threat-delete-gates.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _threatDeleteCutoff } = evalBlock(
  sliceBlock(src, 'function _threatDeleteCutoff({ archivedThrough, graphThrough, retentionCutoff }) {', '\n}'),
  ['_threatDeleteCutoff'],
);
const d = (s) => new Date(s);

describe('_threatDeleteCutoff — the oldest bound wins, and nothing without both watermarks', () => {
  const retention = d('2026-08-24T00:00:00Z');
  it('no archive watermark → delete nothing', () => {
    expect(_threatDeleteCutoff({ archivedThrough: null, graphThrough: d('2026-09-22'), retentionCutoff: retention })).toBeNull();
  });
  it('no graph watermark → delete nothing', () => {
    expect(_threatDeleteCutoff({ archivedThrough: d('2026-09-22'), graphThrough: null, retentionCutoff: retention })).toBeNull();
  });
  it('retention is the binding bound when both watermarks are newer', () => {
    expect(_threatDeleteCutoff({ archivedThrough: d('2026-09-22'), graphThrough: d('2026-09-22'), retentionCutoff: retention }))
      .toEqual(retention);
  });
  it('a lagging archive holds the cutoff back', () => {
    expect(_threatDeleteCutoff({ archivedThrough: d('2026-08-10'), graphThrough: d('2026-09-22'), retentionCutoff: retention }))
      .toEqual(d('2026-08-10'));
  });
  it('lagging graphs hold the cutoff back', () => {
    expect(_threatDeleteCutoff({ archivedThrough: d('2026-09-22'), graphThrough: d('2026-08-01'), retentionCutoff: retention }))
      .toEqual(d('2026-08-01'));
  });
});

describe('the midnight job uses the gate on BOTH deletion paths', () => {
  const clean = stripJs(src);
  const i = (s) => { const n = clean.indexOf(s); expect(n, s).toBeGreaterThan(-1); return n; };

  it('builds the graphs before the sweep and the thinning', () => {
    const build = i("supabase.rpc('build_encounter_threat_graphs'");
    expect(build).toBeLessThan(i("'encounter_threat_snapshots',\n              `snapshot_at=lt."));
    expect(build).toBeLessThan(i("supabase.rpc('thin_threat_snapshots'"));
  });
  it('the sweep deletes only when the gate returns a cutoff', () => {
    expect(clean).toMatch(/const cutoffDate = _threatDeleteCutoff\(\{ archivedThrough, graphThrough,/);
    expect(clean).toMatch(/if \(!cutoffDate\) \{/);
  });
  it('the thinning runs only when the gate covers the last 7 days', () => {
    expect(clean).toMatch(/const thinCut = _threatDeleteCutoff\(\{ archivedThrough, graphThrough, retentionCutoff: thinFrom \}\);\s*if \(thinCut && thinCut\.getTime\(\) >= thinFrom\.getTime\(\)\) \{\s*const thinned = await supabase\.rpc\('thin_threat_snapshots'/);
  });
});
