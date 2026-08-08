// test/threat-snapshot-dedup.test.js — don't store a scoreboard that hasn't
// changed.
//
// A threat snapshot is the FULL running scoreboard for a fight, re-sent every
// few seconds. Between pulls, mid-buff, or on a mob nobody is hitting,
// consecutive snapshots are byte-identical. Measured 2026-08-07: 548k rows
// across 28 encounters (~19,580 each), 288 MB of per_player JSONB, with
// adjacent rows carrying identical totals — e.g. two rows six seconds apart
// for "a grimling herbalist", both total 2958, both Tyleza 1233 / Vrarokh 1725.
//
// Run: npx vitest run test/threat-snapshot-dedup.test.js

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block =
  sliceBlock(src, 'function _threatSnapHash(row) {', '\n}') +
  sliceBlock(src, 'function _threatSnapIsDuplicate(row) {', '\n}');

function build() {
  const harness = `
    const crypto = arguments[0];
    const _threatSnapHashes = new Map();
    const THREAT_SNAP_HASH_MAX = 500;
    const THREAT_SNAP_HASH_TTL_MS = 60 * 60 * 1000;
    function require(m) { if (m === 'crypto') return crypto; throw new Error(m); }
  ` + block + `
    return { _threatSnapIsDuplicate, _threatSnapHash, _threatSnapHashes };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)(crypto);
}

const row = (over = {}) => Object.assign({
  guild_id: 'wolfpack', uploader: 'Syko', boss_name: 'a grimling herbalist',
  total: 2958,
  per_player: { Tyleza: { dmg: 1233, swing: 1233, total: 1233 },
                Vrarokh: { dmg: 1725, swing: 1725, total: 1725 } },
}, over);

describe('_threatSnapIsDuplicate', () => {
  it('first snapshot is always written', () => {
    expect(build()._threatSnapIsDuplicate(row())).toBe(false);
  });

  it('an unchanged scoreboard is a duplicate — the actual bug', () => {
    const h = build();
    expect(h._threatSnapIsDuplicate(row())).toBe(false);
    expect(h._threatSnapIsDuplicate(row())).toBe(true);
    expect(h._threatSnapIsDuplicate(row())).toBe(true);
  });

  it('any change in a player total writes again', () => {
    const h = build();
    h._threatSnapIsDuplicate(row());
    expect(h._threatSnapIsDuplicate(row({
      total: 4183,
      per_player: { Tyleza: { dmg: 2458, swing: 2458, total: 2458 },
                    Vrarokh: { dmg: 1725, swing: 1725, total: 1725 } },
    }))).toBe(false);
  });

  it('a NEW player joining the fight writes again', () => {
    const h = build();
    h._threatSnapIsDuplicate(row());
    expect(h._threatSnapIsDuplicate(row({
      per_player: { Tyleza: { dmg: 1233, swing: 1233, total: 1233 },
                    Vrarokh: { dmg: 1725, swing: 1725, total: 1725 },
                    Hitya: { dmg: 0, swing: 0, total: 0 } },
    }))).toBe(false);
  });

  it('key ORDER in per_player does not defeat the dedup', () => {
    // The agent builds this object per upload; insertion order can differ for
    // identical content. Hashing raw JSON.stringify would miss every repeat.
    const h = build();
    h._threatSnapIsDuplicate(row());
    expect(h._threatSnapIsDuplicate(row({
      per_player: { Vrarokh: { dmg: 1725, swing: 1725, total: 1725 },
                    Tyleza: { dmg: 1233, swing: 1233, total: 1233 } },
    }))).toBe(true);
  });

  it('separate uploaders and separate bosses are tracked independently', () => {
    const h = build();
    h._threatSnapIsDuplicate(row());
    expect(h._threatSnapIsDuplicate(row({ uploader: 'Smokestomp' })).valueOf()).toBe(false);
    expect(h._threatSnapIsDuplicate(row({ boss_name: 'Talendor' }))).toBe(false);
    // …and each still dedups on its own key.
    expect(h._threatSnapIsDuplicate(row({ uploader: 'Smokestomp' }))).toBe(true);
  });

  it('a fight that repeats then resumes still records the resume', () => {
    const h = build();
    h._threatSnapIsDuplicate(row());          // written
    h._threatSnapIsDuplicate(row());          // duplicate
    expect(h._threatSnapIsDuplicate(row({ total: 3000 }))).toBe(false);
  });
});
