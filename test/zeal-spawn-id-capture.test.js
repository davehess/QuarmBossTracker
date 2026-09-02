// test/zeal-spawn-id-capture.test.js — capturing Zeal's spawn ids off the pipe.
//
// Zeal PR #229 adds spawn_id / target_id / pet_id to the pipe's `player`
// message. No RELEASED Zeal emits them, so every read is optional and null is
// the normal case — this must be inert on the fleet and only light up on a
// build that carries the patch.
//
// Two behaviours here are not obvious and are the reason this file exists:
//
//   1. Ids MUST be cleared on a zone change. An id is a slot in the ZONE's
//      entity table, not an identity (measured 2026-08-31, see
//      docs/zeal-pipe-protocol.md): you get a new one entering a zone, and the
//      same number means a different mob in a different zone. Carrying one
//      across a zone is the upstream /tag bug where marks land on unrelated
//      mobs.
//   2. The pipe OMITS target_id / pet_id when there is no target / no pet, so
//      each must be explicitly nulled rather than left at its old value —
//      otherwise the last target's id survives clearing target, which is the
//      exact stale-identity failure ids exist to prevent.
//
// Run: npx vitest run test/zeal-spawn-id-capture.test.js

import { describe, it, expect } from 'vitest';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import path from 'node:path';

const MAIN = path.join(ROOT, 'apps', 'mimic', 'main.js');
const src = readSource(MAIN);

// The player-message branch, run FOR REAL. The slice deliberately runs through
// the id reads themselves rather than stopping at autoattack and re-typing them
// here — a harness that reimplements the lines it is testing proves nothing.
const BLOCK = sliceBlock(
  src,
  "  } else if (type === 3) {",
  "      // Live position + facing (Zeal named_pipe.cpp player payload:",
);

function player(state, payload) {
  const { apply } = evalBlock(`
    function apply(s, __payload) {
      const obj = null;
      function _zealParseData() { return __payload; }
      ${BLOCK.replace('  } else if (type === 3) {', '')}
      }
      return s;
    }
  `, ['apply']);
  return apply(state, payload);
}

describe('reading the ids off the player message', () => {
  it('captures all three when present', () => {
    const s = player({ zone: 33 }, { zone: 33, spawn_id: 1313, target_id: 2026, pet_id: 3005 });
    expect(s).toMatchObject({ spawn_id: 1313, target_id: 2026, pet_id: 3005 });
  });

  it('is inert on a released Zeal that emits none of them', () => {
    const s = player({ zone: 33 }, { zone: 33, autoattack: true });
    expect(s.spawn_id).toBe(null);
    expect(s.target_id).toBe(null);
    expect(s.pet_id).toBe(null);
    expect(s.autoattack).toBe(true);   // the rest of the message still works
  });

  // ⚠ The omission case. The pipe drops the key rather than sending a sentinel.
  it('nulls target_id when you clear target, instead of keeping the old one', () => {
    const s = { zone: 33, target_id: 2026 };
    player(s, { zone: 33 });                       // same zone, no target now
    expect(s.target_id).toBe(null);
  });

  it('nulls pet_id when the pet is gone', () => {
    const s = { zone: 33, pet_id: 3005 };
    player(s, { zone: 33 });
    expect(s.pet_id).toBe(null);
  });

  // ⚠ Every key gets a genuinely non-numeric value, not null. A first cut used
  // `pet_id: null` here, which a `!== undefined` guard handles identically to
  // an isFinite one — so the case passed under a mutation that removed the
  // numeric check. Testing the sentinel proved nothing about the guard.
  it.each([
    ['a string',  'abc'],
    ['a bool',    true],
    ['an object', { id: 5 }],
    ['NaN',       Number.NaN],
    ['null',      null],
  ])('rejects %s in any id field rather than passing junk downstream', (_label, junk) => {
    const s = player({ zone: 33 }, { zone: 33, target_id: junk, pet_id: junk, spawn_id: junk });
    expect(s.target_id).toBe(null);
    expect(s.pet_id).toBe(null);
    expect(s.spawn_id).toBe(null);
  });
});

describe('zoning invalidates every id', () => {
  it('drops every id carried in from the old zone', () => {
    const s = { zone: 33, spawn_id: 1313, target_id: 2026, pet_id: 3005,
                target_name: 'a cliff golem', pet_name: 'Gorak' };
    player(s, { zone: 164 });                      // Misty Thicket -> The Deep
    expect(s.spawn_id).toBe(null);
    expect(s.target_id).toBe(null);
    expect(s.pet_id).toBe(null);
    // the pre-existing NAME clearing is a separate mechanism and must survive
    expect(s.target_name).toBe(null);
    expect(s.pet_name).toBe(null);
  });

  // ⚠ Why there is no explicit id-clearing branch, recorded because one was
  // written and turned out to be dead code. Ids ride the player message, so
  // the unconditional assignment already nulls anything the pipe omits — the
  // very message that changes the zone replaces them. NAMES need the clear
  // because they arrive on gauge messages, which can lag the zone event.
  it('needs no separate clear — the same message that rezones re-sets them', () => {
    const s = { zone: 33, target_id: 4425 };
    player(s, { zone: 164, target_id: 77 });       // new zone AND a new target
    expect(s.target_id).toBe(77);
    expect(s.zone).toBe(164);
  });

  it('does NOT clear them when the zone is unchanged', () => {
    const s = { zone: 33, spawn_id: 1313 };
    player(s, { zone: 33, spawn_id: 1313, target_id: 2026 });
    expect(s.spawn_id).toBe(1313);
    expect(s.target_id).toBe(2026);
  });

  it('a same-numbered id in a NEW zone is taken as the new zone’s mob', () => {
    // Slot 4425 in Misty Thicket and slot 4425 in The Deep are unrelated. The
    // clear-then-set order is what stops the old one surviving the transition.
    const s = { zone: 33, target_id: 4425 };
    player(s, { zone: 164, target_id: 4425 });
    expect(s.zone).toBe(164);
    expect(s.target_id).toBe(4425);
  });
});

describe('the id reaches the bot, and is honest about what it needs', () => {
  const agent = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js')));

  it('rides the live-state upload beside target_name', () => {
    expect(agent).toContain('target_id:      Number.isFinite(st.target_id) ? st.target_id : null');
  });

  it('is uploaded as null rather than omitted, so the column is explicit', () => {
    // A missing key and an explicit null differ at the DB: the bot writes the
    // column either way, so a client that loses the patch clears the old id
    // instead of leaving a stale one on the row.
    expect(agent).toMatch(/target_id:\s+Number\.isFinite\(st\.target_id\) \? st\.target_id : null/);
  });

  it('the capture site names all three keys in ONE place', () => {
    // Upstream may rename these (#218 suggested `NPC_ID`), so a rename has to
    // be one edit rather than a hunt across four surfaces. "One place" is
    // asserted as span, not count: each key legitimately appears twice (the
    // isFinite guard and the value), so counting occurrences would only
    // encode that accident.
    const clean = stripJs(src);
    const at = [...clean.matchAll(/inner\.(spawn_id|target_id|pet_id)/g)].map(m => m.index);
    expect(new Set(at.map(i => clean.slice(i, i + 20).split(/[^\w.]/)[0])))
      .toEqual(new Set(['inner.spawn_id', 'inner.target_id', 'inner.pet_id']));
    expect(Math.max(...at) - Math.min(...at)).toBeLessThan(400);
  });
});
