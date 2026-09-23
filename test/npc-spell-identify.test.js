// test/npc-spell-identify.test.js — naming a mob's spell from its LANDING
// message, and the estimated mana ledger built on top of it.
//
// The guild lead, 2026-09-22, watching a Spire Lord pull: "This should display
// the spell he cast that covers his hand with a dull aura." EverQuest never
// prints what a mob cast — the log says only "<Caster> begins to cast a
// spell." — so the landing message is the only way in.
//
// Fixtures are REAL catalog rows (eqemu_spells + eqemu_npc_spells_entries for
// The Spire Lord, npc_spells_id 9, level 49), not invented ones. The seven-way
// "staggers." collision below is genuinely in his spell list and spans 9 to 225
// mana, which is the whole reason text matching alone is unsafe.
//
// ⚠ These RUN the shipped functions. A text assertion would be answered by
// this file's own comments, and check:dashboard does not cover index.js at all.
//
// Run: npx vitest run test/npc-spell-identify.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
// Stubs for what the block reaches out to: the log clock, the Zeal target, and
// the mob-info cache. Driving those is how the identity rules get tested.
const PRELUDE = `
  function parseEqTimestamp(line) {
    const m = /^\\[(\\d+)\\]/.exec(line);
    return m ? new Date(Number(m[1])) : null;
  }
  let __tgt = null, __mobs = new Map();
  function __setTarget(name, id){ __tgt = name ? { target_name: name, target_id: id ?? null } : null; }
  function __setMob(mob){ __mobs.set(mob.name, { at: Date.now(), mob }); }
  function _currentTargetState(){ return __tgt; }
  function _normMobNameAgent(n){ return String(n||'').trim().toLowerCase().replace(/[\\s\`']+/g,'_'); }
  const _mobInfoByName = __mobs;
`;
const api = evalBlock(
  PRELUDE + sliceBlock(src,
    'const _NPC_CAST_RX =',
    "    estimated: true,\n  };\n}"),
  ['identifyNpcCast', 'noteNpcCastStart', '_npcCasterFor', 'noteNpcLanding', 'lastNpcCast',
   'npcManaNote', 'npcManaReset', 'npcManaDisengage', 'npcManaState', '__setTarget', '__setMob'],
);
const { identifyNpcCast, noteNpcCastStart, _npcCasterFor, noteNpcLanding, lastNpcCast,
        npcManaNote, npcManaReset, npcManaDisengage, npcManaState, __setTarget, __setMob } = api;

// The Spire Lord's real list, trimmed to the rows that matter here.
const GRIM_AURA = { id: 346, name: 'Grim Aura', mana: 25, cast_ms: 3000, other: "'s hand is covered with a dull aura." };
const STAGGERS = [
  { id: 341, name: 'Lifetap',      mana: 9,   cast_ms: 2500, other: 'staggers.' },
  { id: 445, name: 'Lifedraw',     mana: 63,  cast_ms: 3000, other: 'staggers.' },
  { id: 446, name: 'Siphon Life',  mana: 72,  cast_ms: 3500, other: 'staggers.' },
  { id: 447, name: 'Drain Soul',   mana: 225, cast_ms: 8000, other: 'staggers.' },
];
const SPIRE_LORD = [GRIM_AURA, ...STAGGERS,
  { id: 49, name: 'Nullify Magic', mana: 50, cast_ms: 4500, other: 'feels dispelled.' }];

describe('identifying the spell from its landing message', () => {
  // The exact line from the screenshot that prompted this.
  it('names Grim Aura from "his hand is covered with a dull aura"', () => {
    const r = identifyNpcCast(SPIRE_LORD, "The Spire Lord's hand is covered with a dull aura.", null);
    expect(r.spell.name).toBe('Grim Aura');
    expect(r.spell.mana).toBe(25);
    expect(r.confidence).toBe('exact');
    expect(r.target).toBe('The Spire Lord');
  });

  // The reason narrowing exists: 9 mana vs 225 on the same sentence.
  it('will NOT pretend to know which lifetap "staggers." was', () => {
    const r = identifyNpcCast(SPIRE_LORD, 'Aldenmar staggers.', null);
    expect(r.candidates.length).toBe(4);
    expect(r.confidence).toBe('guess');
  });

  it('splits that collision by how long the cast took', () => {
    const r = identifyNpcCast(SPIRE_LORD, 'Aldenmar staggers.', 8000);
    expect(r.spell.name).toBe('Drain Soul');
    expect(r.confidence).toBe('timed');
  });

  // ⚠ EQ stamps whole seconds, so a lead that lands between two cast times
  // must not be sold as certainty.
  it('falls back to a guess when the timing separates nothing', () => {
    const r = identifyNpcCast(SPIRE_LORD, 'Aldenmar staggers.', 60000);
    expect(r.confidence).toBe('guess');
  });

  it('handles a multi-word target and the non-possessive form', () => {
    const r = identifyNpcCast(SPIRE_LORD, 'A Greater Spire Spirit staggers.', 2500);
    expect(r.target).toBe('A Greater Spire Spirit');
    expect(r.spell.name).toBe('Lifetap');
  });

  it('returns null for a line no spell of this mob prints', () => {
    expect(identifyNpcCast(SPIRE_LORD, 'Aldenmar is surrounded by icicles.', null)).toBeNull();
    expect(identifyNpcCast([], 'anything', null)).toBeNull();
    expect(identifyNpcCast(SPIRE_LORD, '', null)).toBeNull();
  });

  // A spell with no landing text must never be matched by accident — 14% of
  // NPC-castable spells are direct damage with no message at all.
  it('ignores catalog rows with no landing text', () => {
    expect(identifyNpcCast([{ id: 1, name: 'Nuke', mana: 100, other: null }], 'Aldenmar staggers.', null)).toBeNull();
  });
});

describe('pairing a landing with the mob that cast it', () => {
  // The player-only tracker cannot see these: named mobs are multi-word, so
  // they fail its single-token pattern even though they are capitalised.
  it('captures multi-word NPC casters', () => {
    expect(noteNpcCastStart('[1000] Royal Scribe Kaavin begins to cast a spell.')).toBe('Royal Scribe Kaavin');
    expect(noteNpcCastStart('[2000] The Spire Lord begins to cast a spell.')).toBe('The Spire Lord');
    expect(noteNpcCastStart('[3000] a greater spire spirit begins to cast a spell.')).toBe('a greater spire spirit');
  });

  it('ignores lines that are not a cast start', () => {
    expect(noteNpcCastStart('[4000] Aldenmar staggers.')).toBeNull();
  });

  it('returns the caster and the lead time for a landing inside the window', () => {
    noteNpcCastStart('[10000] The Spire Lord begins to cast a spell.');
    const got = _npcCasterFor(13000, 'The Spire Lord');
    expect(got.caster).toBe('The Spire Lord');
    expect(got.leadMs).toBe(3000);
  });

  it('will not reach back past the window for a caster', () => {
    noteNpcCastStart('[100000] Corvale begins to cast a spell.');
    expect(_npcCasterFor(100000 + 60000, 'Corvale')).toBeNull();
  });
});

// ── the two bugs the guild lead caught in the first version ─────────────────
// "we're never updating the last seen spell on these and they're not unique to
// the mob casting them because we don't have a surface to weld them to even
// with the spawn-ids" — `Gate 1170s ago` sat on the panel for nineteen minutes,
// on whichever same-named mob you happened to target next.
describe('a cast belongs to an individual, not to a name', () => {
  const SPIRIT = { name: 'A Greater Spire Spirit', mana: 1300, spells: [
    { id: 393, name: 'Steelskin', mana: 149, cast_ms: 3000, other: "'s skin gleams like steel." },
    { id: 341, name: 'Lifetap',   mana: 9,   cast_ms: 2500, you: 'You feel your life force drain away.' },
  ] };
  const land = (t, msg) => noteNpcLanding(`[${t}] ${msg}`);
  const cast = (t, who) => noteNpcCastStart(`[${t}] ${who} begins to cast a spell.`);

  beforeEach(() => { __setMob(SPIRIT); });

  it('records a cast by the mob you are looking at', () => {
    __setTarget('A Greater Spire Spirit', 101);
    cast(Date.now() - 3000, 'A Greater Spire Spirit');
    expect(land(Date.now(), "A Greater Spire Spirit's skin gleams like steel.")).not.toBeNull();
    expect(lastNpcCast('A Greater Spire Spirit', 101).spell).toBe('Steelskin');
  });

  it('does NOT show it on a different spawn of the same name', () => {
    __setTarget('A Greater Spire Spirit', 101);
    cast(Date.now() - 3000, 'A Greater Spire Spirit');
    land(Date.now(), "A Greater Spire Spirit's skin gleams like steel.");
    expect(lastNpcCast('A Greater Spire Spirit', 202)).toBeNull();
  });

  // The other half: a cast by a mob we are not targeting cannot be attributed
  // at all, because neither log line carries an id. Drop it rather than guess.
  it('ignores a cast from a mob that is not the current target', () => {
    __setTarget('A Lesser Spire Spirit', 77);
    cast(Date.now() - 3000, 'A Greater Spire Spirit');
    expect(land(Date.now(), "A Greater Spire Spirit's skin gleams like steel.")).toBeNull();
  });

  it('ages out a name-only attribution instead of parking it forever', () => {
    __setTarget('A Greater Spire Spirit', null);
    const old = Date.now() - 20 * 60 * 1000;
    cast(old - 3000, 'A Greater Spire Spirit');
    land(old, "A Greater Spire Spirit's skin gleams like steel.");
    expect(lastNpcCast('A Greater Spire Spirit', null)).toBeNull();
  });

  // "Last spell cast was on me" — cast_on_you is a whole sentence with no name
  // in front of it, so the cast_on_other suffix match never sees it.
  it('names a spell that landed on YOU', () => {
    __setTarget('A Greater Spire Spirit', 101);
    cast(Date.now() - 2500, 'A Greater Spire Spirit');
    const got = land(Date.now(), 'You feel your life force drain away.');
    expect(got).not.toBeNull();
    expect(got.spell).toBe('Lifetap');
  });
});

describe('the estimated mana ledger', () => {
  it('starts full and spends what it can name', () => {
    npcManaReset('The Spire Lord', 11);
    let st = npcManaNote('The Spire Lord', 11, 2058, 0, 1000);
    expect(st.cur).toBe(2058);
    st = npcManaNote('The Spire Lord', 11, 2058, 25, 2000);
    expect(st.cur).toBe(2033);
    expect(st.spent).toBe(25);
  });

  // ⚠ The bug the guild lead caught: a zone full of same-named trash shared one
  // ledger, so the bar you were looking at had been spent down by mobs you
  // never fought. Two spawn ids must be two ledgers.
  it('keeps two same-named mobs apart by spawn id', () => {
    npcManaReset('A Greater Spire Spirit', 101);
    npcManaReset('A Greater Spire Spirit', 102);
    npcManaNote('A Greater Spire Spirit', 101, 1300, 400, 1000);
    expect(npcManaState('A Greater Spire Spirit', 101).cur).toBe(900);
    expect(npcManaState('A Greater Spire Spirit', 102)).toBeNull();   // untouched
  });

  it('never goes below zero however much it observes', () => {
    npcManaReset('Corvale', 1);
    npcManaNote('Corvale', 1, 100, 5000, 1000);
    expect(npcManaState('Corvale', 1).cur).toBe(0);
    expect(npcManaState('Corvale', 1).pct).toBe(0);
  });

  // The guild lead was explicit: disengaging KEEPS the spend, resetting clears it.
  it('keeps the spend across a disengage and clears it on a reset', () => {
    npcManaReset('Brackwyn', 2);
    npcManaNote('Brackwyn', 2, 1000, 400, 1000);
    npcManaDisengage('Brackwyn', 2);
    expect(npcManaState('Brackwyn', 2).cur).toBe(600);
    expect(npcManaState('Brackwyn', 2).engaged).toBe(false);
    npcManaReset('Brackwyn', 2);
    expect(npcManaState('Brackwyn', 2).cur).toBe(1000);
  });

  // No pool in the catalog → no bar at all, not an empty one. ~79% of NPCs.
  it('reports nothing for a mob with no mana pool', () => {
    expect(npcManaNote('Nyssara', 3, 0, 10, 1000)).toBeNull();
    expect(npcManaState('Nyssara', 3)).toBeNull();
    expect(npcManaState('never-seen', 9)).toBeNull();
  });

  // The whole number is a floor, and the UI has to be told so.
  it('always declares itself an estimate', () => {
    npcManaReset('Rethlan');
    expect(npcManaNote('Rethlan', 500, 10, 1000).estimated).toBe(true);
  });
});
