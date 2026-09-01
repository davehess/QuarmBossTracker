// test/ext-target-spawn-id.test.js — separating same-name mobs by spawn id.
//
// Extended Target has always had to guess which "a cliff golem" a raider is on.
// It clusters reporter HP (fails the moment two sit at the same health) and,
// since #194, clusters engaged tanks by position (needs two engaged tanks). The
// overlay asterisks non-unique names because of exactly this.
//
// Zeal PR #229 (approved by the server owner 2026-08-31) puts the spawn id on
// the pipe, and an id does not guess — it says which mob it is.
//
// Three properties carry the risk here:
//
//   1. ⚠ THE KEY IS (ZONE, ID), NEVER THE ID ALONE. `inScope` spans every zone
//      when the same-zone filter is off, and an id is a slot in the ZONE's
//      entity table — slot 4425 in Sebilis is an unrelated mob to slot 4425 in
//      The Deep. Keying on the id alone merges two zones' mobs into one row,
//      which is the upstream /tag bug in zeal-tag-spawn-id-collision.md.
//   2. ⚠ IT MUST BE INERT WITHOUT IDS. No released Zeal emits them; a mixed
//      fleet is the steady state, not a transition.
//   3. ⚠ NOBODY MAY VANISH. Reporters without an id still have to appear.
//
// Run: npx vitest run test/ext-target-spawn-id.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _extIdInstances } = evalBlock(
  sliceBlock(src, 'function _extIdInstances(obs) {', '\n  return insts;\n}'),
  ['_extIdInstances'],
);

// An observation as the aggregation builds it.
const ob = (raider, hp, zone, spawnId) => ({
  raider, hp,
  id: (spawnId != null && zone) ? `${zone}|${spawnId}` : null,
  spawn_id: spawnId != null ? spawnId : null,
});

const raidersOf = (insts) => insts.map(i => [...i.raiders].sort()).sort();

describe('ids prove instances the heuristics cannot', () => {
  it('splits two same-name mobs sitting at IDENTICAL hp', () => {
    // The exact case HP clustering cannot see.
    const insts = _extIdInstances([
      ob('Hitya', 100, 'The Deep', 4425),
      ob('Canopy', 100, 'The Deep', 4426),
    ]);
    expect(insts).toHaveLength(2);
    expect(raidersOf(insts)).toEqual([['Canopy'], ['Hitya']]);
    expect(insts.every(i => i.id_proven)).toBe(true);
    expect(insts.map(i => i.spawn_id).sort()).toEqual([4425, 4426]);
  });

  it('keeps reporters on the SAME id together', () => {
    const insts = _extIdInstances([
      ob('Hitya', 90, 'The Deep', 4425),
      ob('Canopy', 88, 'The Deep', 4425),
      ob('Utoh', 40, 'The Deep', 4426),
    ]);
    expect(insts).toHaveLength(2);
    expect(raidersOf(insts)).toEqual([['Canopy', 'Hitya'], ['Utoh']]);
  });

  it('derives each instance HP only from reporters who named the id', () => {
    const insts = _extIdInstances([
      ob('Hitya', 90, 'The Deep', 4425),
      ob('Canopy', 80, 'The Deep', 4425),
      ob('Utoh', 10, 'The Deep', 4426),
      ob('Melting', 91, null, null),          // no id — must not move the median
    ]);
    const a = insts.find(i => i.spawn_id === 4425);
    expect(a.hp).toBe(85);                     // median(90,80), not median(90,80,91)
  });
});

describe('⚠ the key is (zone, id)', () => {
  it('does NOT merge the same slot number in two different zones', () => {
    const insts = _extIdInstances([
      ob('Hitya', 100, 'Ruins of Sebilis', 4425),
      ob('Canopy', 100, 'The Deep', 4425),      // same number, different mob
    ]);
    expect(insts).toHaveLength(2);
    expect(raidersOf(insts)).toEqual([['Canopy'], ['Hitya']]);
  });

  it('treats an id with no zone as ABSENT rather than trusting it', () => {
    // Unmatchable against another reporter's, so it must not prove anything.
    const insts = _extIdInstances([
      ob('Hitya', 100, null, 4425),
      ob('Canopy', 100, null, 4426),
    ]);
    expect(insts).toEqual([]);
  });
});

describe('⚠ inert without ids, and nobody vanishes', () => {
  it('returns [] when no reporter has an id', () => {
    expect(_extIdInstances([ob('Hitya', 90, 'The Deep', null), ob('Canopy', 40, 'The Deep', null)])).toEqual([]);
  });

  it('returns [] when every reporter is on the SAME mob — nothing proven', () => {
    // One id is not evidence of two mobs; fall through to the old path.
    expect(_extIdInstances([
      ob('Hitya', 90, 'The Deep', 4425),
      ob('Canopy', 90, 'The Deep', 4425),
    ])).toEqual([]);
  });

  it('places an id-less reporter on the instance with the closest HP', () => {
    const insts = _extIdInstances([
      ob('Hitya', 95, 'The Deep', 4425),
      ob('Utoh', 12, 'The Deep', 4426),
      ob('Melting', 14, 'The Deep', null),      // clearly the hurt one
    ]);
    const hurt = insts.find(i => i.spawn_id === 4426);
    expect(hurt.raiders).toContain('Melting');
  });

  it('still shows an id-less reporter who has NO hp to compare', () => {
    const insts = _extIdInstances([
      ob('Hitya', 95, 'The Deep', 4425),
      ob('Utoh', 12, 'The Deep', 4426),
      ob('Aimey', null, 'The Deep', null),
    ]);
    expect(insts.flatMap(i => i.raiders)).toContain('Aimey');
  });

  it('loses nobody, in any mix', () => {
    const obs = [
      ob('Hitya', 95, 'The Deep', 4425), ob('Canopy', 93, 'The Deep', 4425),
      ob('Utoh', 12, 'The Deep', 4426), ob('Melting', null, 'The Deep', null),
      ob('Aimey', 50, 'The Deep', null), ob('Hopeya', 11, null, 4426),
    ];
    const got = _extIdInstances(obs).flatMap(i => i.raiders).sort();
    expect(got).toEqual(obs.map(o => o.raider).sort());
  });

  it('survives an empty or missing observation list', () => {
    expect(_extIdInstances([])).toEqual([]);
    expect(_extIdInstances(undefined)).toEqual([]);
    expect(_extIdInstances([null, undefined])).toEqual([]);
  });
});

describe('wiring (comment-stripped source)', () => {
  const clean = stripJs(src);

  it('ids outrank the HP guess, and the old path is the fallback', () => {
    expect(clean).toContain('const idInstances = _extIdInstances(g.obs);');
    expect(clean).toMatch(/idInstances\.length >= 2\s*\?\s*idInstances/);
    expect(clean).toContain('clusterByHp(g.obs)');       // still there for everyone else
  });

  it('the observation carries a ZONE-SCOPED id', () => {
    expect(clean).toContain('(r.target_id != null && r.zone_name) ?');
  });

  // The off-tank columns sat 100% NULL for weeks because the row was consumed
  // but never written. Both halves, or neither.
  it('target_id is both WRITTEN to and SELECTED from character_live_state', () => {
    expect(clean).toContain('target_id:   targetId,');
    expect(clean).toMatch(/select=character,zone_name,[^`]*target_id/);
  });

  it('the median matches the handler’s, so two rows cannot disagree', () => {
    const mine = sliceBlock(clean, 'function _extIdInstances(obs) {', '\n  const byId = new Map();');
    expect(mine).toContain('a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2)');
    expect(clean).toContain('s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)');
  });
});

describe('what the row tells the overlay', () => {
  const clean = stripJs(src);
  const push = sliceBlock(clean, '      rows.forEach((c, idx) => {', '\n      });\n    }');

  it('flags an id-proven row so the overlay can drop the asterisk', () => {
    expect(push).toContain('...(c.id_proven ? { id_proven: true } : {})');
  });

  // ⚠ The trap: `ambiguous` also gates the NAME-keyed restore cache below, so
  // clearing it on a proven split would let two instances of one name
  // overwrite each other there. The two concepts must stay separate.
  it('does NOT clear `ambiguous` on a proven split', () => {
    expect(push).toContain('ambiguous: cls.ambiguous || multi');
    expect(push).not.toMatch(/ambiguous:[^,]*id_proven/);
  });

  it('emits the pipe spawn_id when there is no tag to prefer', () => {
    expect(push).toContain('(c.spawn_id != null ? { spawn_id: c.spawn_id } : {})');
  });

  it('keeps a tag winning over the pipe id — it carries text and shape too', () => {
    expect(push).toMatch(/c\._tag \? \{ tag_text:[^}]*spawn_id: c\._tag\.spawn_id \}/);
  });
});
