// linkEncounterToRaidNight — SOURCE-SLICE fidelity tier.
//
// raid_nights was designed and never implemented: empty table, no writer, and
// encounters.raid_night_id NULL on all 1,526 rows despite a real FK. History is
// backfilled by migration; this function keeps it true going forward
// (Uilnayar 2026-08-03).
//
// The property that matters and could silently drift: the LIVE path and the SQL
// BACKFILL must agree on what night an encounter belongs to. The backfill
// reimplements the window in SQL (anchor = local ET − 6h; in-window = anchor
// weekday ∈ Sun/Wed/Thu AND (spillover OR ≥20:30)). This pins the JS side to the
// same cases the SQL was cross-checked against, so a change to raidNight.js that
// moves one and not the other fails here.
//
// Run: npx vitest run test/raid-night-link.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { readSource, sliceBlock } from './_source-slice.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_UTIL = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'utils', 'supabase.js',
);

const block = sliceBlock(
  readSource(SUPABASE_UTIL),
  'async function linkEncounterToRaidNight(',
  '\n}',
);

// Stub the module-internal helpers the slice closes over, and record the calls.
function build({ enabled = true, nightRows = [{ id: 'night-uuid-1' }], insertFails = false } = {}) {
  const harness = `
    const calls = { inserts: [], selects: [], updates: [] };
    function isEnabled() { return ${enabled}; }
    function _guildId() { return 'wolfpack'; }
    async function insertIgnoreDuplicates(table, rows) {
      calls.inserts.push({ table, rows });
      return ${insertFails} && rows[0].zone_main ? null : rows;
    }
    async function select(table, q) { calls.selects.push({ table, q }); return ${JSON.stringify(nightRows)}; }
    async function update(table, q, body) { calls.updates.push({ table, q, body }); return body; }
    const console = { warn() {} };
    function require(m) {
      if (m === './raidNight') return __raidNight;
      throw new Error('unexpected require ' + m);
    }
  ` + block + `
    return { linkEncounterToRaidNight, calls };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('__raidNight', harness);
}

let raidNight;
beforeAll(async () => {
  process.env.DEFAULT_TIMEZONE = 'America/New_York';
  const { createRequire } = await import('node:module');
  raidNight = createRequire(import.meta.url)('../utils/raidNight.js');
});

const mk = (opts) => build(opts)(raidNight);

// The exact timestamps the SQL backfill was cross-checked against.
const SUN_2054_ET   = Date.parse('2026-08-03T00:54:21Z');  // Sun Aug 2, 20:54 ET — in raid
const SPILLOVER     = Date.parse('2026-07-31T00:58:28Z');  // Thu Jul 30 raid, 00:58 ET Fri
const SUN_1400_ET   = Date.parse('2026-08-02T18:00:00Z');  // Sun Aug 2, 14:00 ET — daytime
const TUE_2100_ET   = Date.parse('2026-08-05T01:00:00Z');  // Tue — not a raid day

describe('linkEncounterToRaidNight', () => {
  it('sliced the real function', () => {
    expect(typeof mk().linkEncounterToRaidNight).toBe('function');
  });

  it('links an in-raid encounter to the night named by nightKey', async () => {
    const h = mk();
    const id = await h.linkEncounterToRaidNight({ encounterId: 'enc-1', startedAtMs: SUN_2054_ET });
    expect(id).toBe('night-uuid-1');
    // Night date must be the ANCHOR date (Aug 2), not the UTC date (Aug 3).
    expect(h.calls.inserts[0].rows[0]).toMatchObject({ guild_id: 'wolfpack', date: '2026-08-02' });
    expect(h.calls.updates[0].body).toEqual({ raid_night_id: 'night-uuid-1' });
  });

  it('a past-midnight kill keeps the night it STARTED on', async () => {
    const h = mk();
    await h.linkEncounterToRaidNight({ encounterId: 'enc-2', startedAtMs: SPILLOVER });
    expect(h.calls.inserts[0].rows[0].date).toBe('2026-07-30');
  });

  it('a daytime kill on a raid day is NOT linked', async () => {
    const h = mk();
    expect(await h.linkEncounterToRaidNight({ encounterId: 'enc-3', startedAtMs: SUN_1400_ET })).toBeNull();
    expect(h.calls.inserts, 'must not create a raid night for an XP group').toHaveLength(0);
    expect(h.calls.updates).toHaveLength(0);
  });

  it('a kill on a non-raid day is NOT linked', async () => {
    const h = mk();
    expect(await h.linkEncounterToRaidNight({ encounterId: 'enc-4', startedAtMs: TUE_2100_ET })).toBeNull();
    expect(h.calls.inserts).toHaveLength(0);
  });

  it('only stamps an encounter whose raid_night_id is still NULL', async () => {
    const h = mk();
    await h.linkEncounterToRaidNight({ encounterId: 'enc-5', startedAtMs: SUN_2054_ET });
    expect(h.calls.updates[0].q).toContain('raid_night_id=is.null');
  });

  it('carries zone_main, and retries WITHOUT it when the eqemu_zone FK rejects', async () => {
    const ok = mk();
    await ok.linkEncounterToRaidNight({ encounterId: 'e', startedAtMs: SUN_2054_ET, zoneShort: 'thedeep' });
    expect(ok.calls.inserts).toHaveLength(1);
    expect(ok.calls.inserts[0].rows[0].zone_main).toBe('thedeep');

    // An unknown zone trips the FK — the night must still be created + linked.
    const bad = mk({ insertFails: true });
    const id = await bad.linkEncounterToRaidNight({ encounterId: 'e', startedAtMs: SUN_2054_ET, zoneShort: 'notazone' });
    expect(bad.calls.inserts).toHaveLength(2);
    expect(bad.calls.inserts[1].rows[0]).not.toHaveProperty('zone_main');
    expect(id, 'losing the zone label must not lose the link').toBe('night-uuid-1');
  });

  it('no-ops safely on bad input or a disabled backend', async () => {
    expect(await mk().linkEncounterToRaidNight({ encounterId: null, startedAtMs: SUN_2054_ET })).toBeNull();
    expect(await mk().linkEncounterToRaidNight({ encounterId: 'e', startedAtMs: NaN })).toBeNull();
    expect(await mk({ enabled: false }).linkEncounterToRaidNight({ encounterId: 'e', startedAtMs: SUN_2054_ET })).toBeNull();
  });

  it('returns null (rather than throwing) when the night row cannot be resolved', async () => {
    const h = mk({ nightRows: [] });
    expect(await h.linkEncounterToRaidNight({ encounterId: 'e', startedAtMs: SUN_2054_ET })).toBeNull();
    expect(h.calls.updates).toHaveLength(0);
  });
});
