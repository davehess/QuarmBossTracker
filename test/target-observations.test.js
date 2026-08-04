// Target history append-on-change — SOURCE-SLICE fidelity tier.
//
// The agent has always uploaded target_name (Zeal gauge slot 6) on the
// live_state stream, and it is event-driven: a target switch uploads
// immediately, plus a 45s heartbeat. The bot upserts that into
// character_live_state keyed (guild_id, character), so every switch overwrote
// the last — 576 rows for the whole guild, forever, and no history for healing
// attribution / off-tank detection / add assignment (Uilnayar 2026-08-03).
//
// _noteTargetSwitches appends to target_observations, but ONLY on an actual
// change, using an in-memory last-known map so it costs zero extra Supabase
// reads on a hot path. The load-bearing property this file pins: rows are
// proportional to TARGET SWITCHES, not to samples. A 45s heartbeat on a stable
// target must write nothing — otherwise 40 raiders on a long boss fight would
// bury the table.
//
// Run: npx vitest run test/target-observations.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'const _lastTargetByChar = new Map();',
  '  return out.length;\n}',
);

// The slice calls require('./utils/supabase'); hand it a fake so we can read
// exactly what would have been written.
const harness = `
  const __inserted = [];
  let __enabled = true;
  function require(mod) {
    if (mod === './utils/supabase') {
      return {
        isEnabled: () => __enabled,
        insert: async (table, rows) => { __inserted.push({ table, rows }); return rows; },
      };
    }
    throw new Error('unexpected require: ' + mod);
  }
  const console = { warn() {}, log() {} };
` + block + `
  return {
    _noteTargetSwitches, _lastTargetByChar,
    inserted: () => __inserted,
    reset: () => { __inserted.length = 0; _lastTargetByChar.clear(); },
    setEnabled: (v) => { __enabled = v; },
  };
`;
// eslint-disable-next-line no-new-func
const H = new Function(harness)();

// One live_state row as the ingest handler builds it, trimmed to what the
// target-history path reads.
function row(character, targetName, extra = {}) {
  return {
    guild_id:      'wolfpack',
    character,
    target_name:   targetName,
    target_hp_pct: targetName ? 87 : null,
    zone_name:     'The Deep',
    updated_at:    '2026-08-03T01:00:00.000Z',
    uploaded_by:   '12345',
    ...extra,
  };
}
const written = () => H.inserted().flatMap(i => i.rows);

beforeEach(() => H.reset());

describe('_noteTargetSwitches — append on change only', () => {
  it('sliced the real function', () => {
    expect(typeof H._noteTargetSwitches).toBe('function');
  });

  it('records the first sighting of a real target', async () => {
    await H._noteTargetSwitches([row('Fargan', 'Thought Horror Overfiend')]);
    expect(written()).toHaveLength(1);
    expect(written()[0]).toMatchObject({
      guild_id: 'wolfpack', character: 'Fargan',
      target_name: 'Thought Horror Overfiend', target_hp_pct: 87,
    });
    expect(H.inserted()[0].table).toBe('target_observations');
  });

  it('THE LOAD-BEARING CASE: repeated heartbeats on a stable target write nothing', async () => {
    await H._noteTargetSwitches([row('Fargan', 'Thought Horror Overfiend')]);
    for (let i = 0; i < 10; i++) {
      await H._noteTargetSwitches([row('Fargan', 'Thought Horror Overfiend')]);
    }
    expect(written(), '11 samples of one target must be 1 row, not 11').toHaveLength(1);
  });

  it('records a switch to a different target', async () => {
    await H._noteTargetSwitches([row('Fargan', 'Thought Horror Overfiend')]);
    await H._noteTargetSwitches([row('Fargan', 'A Burrower Parasite')]);
    const w = written();
    expect(w).toHaveLength(2);
    expect(w.map(r => r.target_name)).toEqual(['Thought Horror Overfiend', 'A Burrower Parasite']);
  });

  it('records CLEARING a target, so the interval can close', async () => {
    await H._noteTargetSwitches([row('Fargan', 'Thought Horror Overfiend')]);
    await H._noteTargetSwitches([row('Fargan', null)]);
    const w = written();
    expect(w).toHaveLength(2);
    // Without this row the last target looks like it persisted until the next
    // switch, which could be an hour later.
    expect(w[1].target_name).toBeNull();
    expect(w[1].target_hp_pct).toBeNull();
  });

  it('does NOT write a row for a cold start with no target', async () => {
    await H._noteTargetSwitches([row('Fargan', null)]);
    expect(written(), 'no-target-at-first-sight is the default, not an observed switch').toHaveLength(0);
  });

  it('keys per character — two raiders on the same mob are two rows', async () => {
    await H._noteTargetSwitches([
      row('Fargan', 'Thought Horror Overfiend'),
      row('Aimey',  'Thought Horror Overfiend'),
    ]);
    expect(written()).toHaveLength(2);
    expect(written().map(r => r.character).sort()).toEqual(['Aimey', 'Fargan']);
  });

  it('character matching is case-insensitive (no double-count on casing drift)', async () => {
    await H._noteTargetSwitches([row('Fargan', 'Thought Horror Overfiend')]);
    await H._noteTargetSwitches([row('fargan', 'Thought Horror Overfiend')]);
    expect(written()).toHaveLength(1);
  });

  it('a flip back to a previous target IS a new row', async () => {
    await H._noteTargetSwitches([row('Fargan', 'Overfiend')]);
    await H._noteTargetSwitches([row('Fargan', 'an add')]);
    await H._noteTargetSwitches([row('Fargan', 'Overfiend')]);
    expect(written()).toHaveLength(3);
  });

  it('no-ops when supabase is disabled, and on empty input', async () => {
    expect(await H._noteTargetSwitches([])).toBe(0);
    expect(await H._noteTargetSwitches(null)).toBe(0);
    H.setEnabled(false);
    expect(await H._noteTargetSwitches([row('Fargan', 'Overfiend')])).toBe(0);
    expect(written()).toHaveLength(0);
    H.setEnabled(true);
  });

  it('rows scale with switches, not with sample count', async () => {
    // 3 real switches buried in 60 heartbeat samples.
    const script = [
      ...Array(20).fill('Overfiend'),
      ...Array(20).fill('A Burrower Parasite'),
      ...Array(20).fill('Va Dyn Khar'),
    ];
    for (const t of script) await H._noteTargetSwitches([row('Fargan', t)]);
    expect(written()).toHaveLength(3);
  });
});
