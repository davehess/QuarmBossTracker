// test/mechanic-capture.test.js — #206, the THIRD capture path: instant boss
// mechanics.
//
// The discard audit (docs/DESIGN-mechanic-capture.md, re-run against the live
// catalog 2026-08-11 — still 263 / 113 / 138) found 138 boss effects that emit a
// perfectly good log line nothing in the pipeline reads: the two landing indexes
// are keyed on DURATION and an instant effect has none, and `shouldKeep` is
// default-DROP so the line never reaches the parser either.
//
// Every catalog row below is REAL (eqemu_spells, read 2026-08-11) — the doc's own
// standing lesson is that invented spell text is how the DI trigger came to match
// nothing. The load-bearing ones:
//
//   Complete Healing   13   "is completely healed."         dur 0  f0  good 1  heal 7500
//   Nullify Magic      49   "feels dispelled."              dur 0  f0  good 1
//   Gate               36   "fades away."                   dur 0  f0  good 1
//   Touch of Vinitras  2859 "'s soul fades into darkness."  dur 0  f0  good 0
//   Fling              2167 "is knocked into the air…"      dur 0  f0  good 0
//   Ice Comet          732  "'s skin is rent by massive…"   dur 0  f0  good 0
//   Kneel Test         2808 "is struck by a sudden force."  dur 1  f5  good 0
//   Turgur's Insects   1588 "yawns."                        dur 65 f7  good 0
//
// Run: npx vitest run test/mechanic-capture.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// A miniature spell catalog in the exact shape the bot's /api/agent/spell-catalog
// serves (v8 — `npc` marks the NPC-castable rows).
const CATALOG = [
  // ── instant, NPC-castable: what this path exists to see ──────────────────
  { id: 13,   name: 'Complete Healing',  other: 'is completely healed.',                    dur: 0, durf: 0, good: 1, heal: 7500, npc: 1 },
  { id: 49,   name: 'Nullify Magic',     other: 'feels dispelled.',                         dur: 0, durf: 0, good: 1, npc: 1 },
  { id: 36,   name: 'Gate',              other: 'fades away.',                              dur: 0, durf: 0, good: 1, npc: 1 },
  { id: 2859, name: 'Touch of Vinitras', other: "'s soul fades into darkness.",             dur: 0, durf: 0, good: 0, npc: 1 },
  { id: 2167, name: 'Fling',             other: 'is knocked into the air by a massive force.', dur: 0, durf: 0, good: 0, npc: 1 },
  { id: 732,  name: 'Ice Comet',         other: "'s skin is rent by massive shards of deadly ice.", dur: 0, durf: 0, good: 0, npc: 1 },
  // Two members of the 32-spell "is struck by a sudden force." family. Both
  // instant; the one TIMED member of that family is Kneel Test, below.
  { id: 1516, name: 'Force Strike',      other: 'is struck by a sudden force.', dur: 0, durf: 0, good: 0, npc: 1 },
  { id: 1518, name: 'Force Shock',       other: 'is struck by a sudden force.', dur: 0, durf: 0, good: 0, npc: 1 },
  // ── timed: must stay in the duration indexes and out of this one ─────────
  { id: 2808, name: 'Kneel Test',        other: 'is struck by a sudden force.', dur: 1,  durf: 5, good: 0, npc: 1 },
  { id: 1588, name: "Turgur's Insects",  other: 'yawns.',                       dur: 65, durf: 7, good: 0, npc: 1 },
  // ── instant but PLAYER-only (no `npc`): the firehose this path refuses ────
  { id: 1531, name: 'Superior Healing',  other: 'feels much better.', dur: 0, durf: 0, good: 1, heal: 500 },
  { id: 1441, name: 'Ancient: Chaos Fire', other: "'s body is consumed by ancient fire.", dur: 0, durf: 0, good: 0 },
];

function build(catalog = CATALOG) {
  const harness = `
    const _spellByNameLower = new Map();
    for (const e of ${JSON.stringify(catalog)}) _spellByNameLower.set(e.name.toLowerCase(), e);
    let _buffLandingBySuffix = new Map();
    let _debuffLandingBySuffix = new Map();
    function _isTrackedBuffName() { return false; }
    ${sliceBlock(src, 'const TS_RX =', ';')}
    ${sliceBlock(src, 'function parseEqTimestamp(line)', '\n}')}
    ${sliceBlock(src, 'const SLOW_SPELLS = new Set([', '\n}')}
    ${sliceBlock(src, 'function _looksLikeTargetName(s)', '\n}')}
    ${sliceBlock(src, 'function _isTimedDurationFormula(f)', '\n}')}
    ${sliceBlock(src, 'function _rebuildBuffMatchers()', '\n}\n')}
    ${sliceBlock(src, 'function parseDebuffLanding(line, observer)', '\n}')}
    ${sliceBlock(src, 'function _rebuildMechanicMatchers()', '\n}')}
    ${sliceBlock(src, 'function parseMechanicLanding(line)', '\n}')}
    ${sliceBlock(src, 'const MECHANIC_RING_CAP', 'const _recentMechanics = [];')}
    ${sliceBlock(src, 'function noteMechanicLanding(line, observer, builder)', '\n}')}
    ${sliceBlock(src, 'function _recentMechanicsForWeb()', '\n}')}
    _rebuildBuffMatchers();
    _rebuildMechanicMatchers();
    return { _rebuildMechanicMatchers, parseMechanicLanding, noteMechanicLanding,
             _recentMechanicsForWeb, _recentMechanics,
             _mechanicLandingBySuffix, _debuffLandingBySuffix, _buffLandingBySuffix,
             parseDebuffLanding };
  `;
  return new Function(harness)();
}

// A stand-in for the live EncounterBuilder: only the two members
// noteMechanicLanding touches (plus the fight-liveness fields it reads).
function fight(bossName, targets = []) {
  const names = new Set([bossName, ...targets].filter(Boolean).map(n => n.toLowerCase()));
  return {
    bossName,
    startedAt: Date.now(),
    targets: new Map(targets.map(t => [t, 1])),
    _fightTargetMatches(name) { return !!name && names.has(String(name).toLowerCase()); },
  };
}

const T = (msg, stamp = 'Sun Aug 09 21:50:25 2026') => '[' + stamp + '] ' + msg;

describe('the instant-effect index', () => {
  it('indexes instant NPC spells the duration indexes structurally cannot hold', () => {
    const h = build();
    expect(h._mechanicLandingBySuffix.has('is completely healed.')).toBe(true);
    expect(h._mechanicLandingBySuffix.has('feels dispelled.')).toBe(true);
    expect(h._mechanicLandingBySuffix.has("'s soul fades into darkness.")).toBe(true);
  });

  it('refuses spells no NPC can cast — our own heals and nukes are not mechanics', () => {
    const h = build();
    expect(h._mechanicLandingBySuffix.has('feels much better.')).toBe(false);
    expect(h._mechanicLandingBySuffix.has("'s body is consumed by ancient fire.")).toBe(false);
  });

  it('stays EMPTY against a pre-v8 catalog rather than indexing everything', () => {
    // A bot that predates the NPC-castable flag serves entries with no `npc`.
    // Idle is recoverable; a raid of mislabelled rows is not.
    const h = build(CATALOG.map(({ npc, ...rest }) => { void npc; return rest; }));
    expect(h._mechanicLandingBySuffix.size).toBe(0);
  });

  it('leaves the TIMED indexes exactly as they were (the durf gate is untouched)', () => {
    const h = build();
    // Timed spells still land in the duration index...
    expect(h._debuffLandingBySuffix.has('yawns.')).toBe(true);
    expect(h._debuffLandingBySuffix.get('yawns.').map(x => x.name)).toEqual(["Turgur's Insects"]);
    // ...and instant ones never leak into it, which is what kept "Kneel
    // Test"-class phantoms off the buff trackers in the first place.
    expect(h._debuffLandingBySuffix.has('feels dispelled.')).toBe(false);
    expect(h._debuffLandingBySuffix.has("'s soul fades into darkness.")).toBe(false);
    expect(h._buffLandingBySuffix.has('is completely healed.')).toBe(false);
    // The timed parser is unchanged end to end.
    const evt = h.parseDebuffLanding(T('A sun revenant yawns.'), 'Uilnayar');
    expect(evt.spell_name).toBe("Turgur's Insects");
    expect(evt.dur_ticks).toBe(65);
    // And the one timed member of the knockback family is still the only thing
    // in the timed index for that text — this path did not move it.
    expect(h._debuffLandingBySuffix.get('is struck by a sudden force.').map(x => x.name))
      .toEqual(['Kneel Test']);
  });
});

describe('parseMechanicLanding never crowns a shared landing text', () => {
  it('names the spell when the text belongs to exactly one', () => {
    const h = build();
    const evt = h.parseMechanicLanding(T('Uilnayar feels dispelled.'));
    expect(evt.victim).toBe('Uilnayar');
    expect(evt.ambiguous).toBe(false);
    expect(evt.spell_name).toBe('Nullify Magic');
    expect(evt.spell_id).toBe(49);
  });

  it('carries the family instead of picking one — and never picks Kneel Test', () => {
    // §5 of docs/FINDINGS-2026-08-10-trigger-overlay.md: of the 32 spells sharing
    // this text exactly one has a timed formula, so the duration index sees a
    // "family of one" and crowns EQEmu's internal dev artifact. This index holds
    // the instant 31 and refuses to name any of them.
    const h = build();
    const evt = h.parseMechanicLanding(T('Uilnayar is struck by a sudden force.'));
    expect(evt.ambiguous).toBe(true);
    expect(evt.spell_name).toBeNull();
    expect(evt.spell_id).toBe(0);
    expect(evt.family_size).toBe(2);
    expect(evt.family).toEqual(expect.arrayContaining(['Force Strike', 'Force Shock']));
    expect(evt.family).not.toContain('Kneel Test');
  });

  it('reads a multi-word mob victim (the #169 pet-Death-Touch miss)', () => {
    const h = build();
    const evt = h.parseMechanicLanding(T('a glyph covered serpent feels dispelled.'));
    expect(evt.victim).toBe('a glyph covered serpent');
    expect(evt.spell_name).toBe('Nullify Magic');
  });

  it('reads a possessive victim', () => {
    const h = build();
    const evt = h.parseMechanicLanding(T("Uilnayar's soul fades into darkness."));
    expect(evt.victim).toBe('Uilnayar');
    expect(evt.spell_name).toBe('Touch of Vinitras');
  });

  it('matches the RAW line — the timestamp prefix is part of it, never optional', () => {
    // The standing trap (#190): patterns here run against
    // "[Sun Aug 02 21:10:01 2026] <message>", so a bare message is not a line.
    const h = build();
    expect(h.parseMechanicLanding('Uilnayar feels dispelled.')).toBeNull();
    expect(h.parseMechanicLanding(T('Uilnayar feels dispelled.'))).toBeTruthy();
  });
});

describe('what gets RECORDED', () => {
  it('records the boss healing itself — the line the encounter splitter guesses at', () => {
    const h = build();
    const b = fight('Lord of Ire');
    h.noteMechanicLanding(T('Lord of Ire is completely healed.'), 'Uilnayar', b);
    const rows = h._recentMechanicsForWeb();
    expect(rows).toHaveLength(1);
    expect(rows[0].spell_name).toBe('Complete Healing');
    expect(rows[0].on_fight_target).toBe(true);
    expect(rows[0].mob).toBe('Lord of Ire');
  });

  it('does NOT record our own raid nuking the mob', () => {
    const h = build();
    const b = fight('Lord of Ire');
    h.noteMechanicLanding(T("Lord of Ire's skin is rent by massive shards of deadly ice."), 'Uilnayar', b);
    expect(h._recentMechanics).toHaveLength(0);
  });

  it('does NOT record a CH landing on a raider (the chain is not a mechanic)', () => {
    const h = build();
    const b = fight('Lord of Ire');
    h.noteMechanicLanding(T('Uilnayar is completely healed.'), 'Uilnayar', b);
    expect(h._recentMechanics).toHaveLength(0);
  });

  it('records a DISPEL on a raider — EQ calls dispels beneficial, and a good_effect gate would have dropped it', () => {
    const h = build();
    const b = fight('Lord of Ire');
    h.noteMechanicLanding(T('Uilnayar feels dispelled.'), 'Uilnayar', b);
    expect(h._recentMechanics).toHaveLength(1);
    expect(h._recentMechanics[0].spell_name).toBe('Nullify Magic');
    expect(h._recentMechanics[0].on_fight_target).toBe(false);
  });

  it('records a death touch on a raider', () => {
    const h = build();
    const b = fight('Vinitras');
    h.noteMechanicLanding(T("Currygoat's soul fades into darkness."), 'Uilnayar', b);
    expect(h._recentMechanics[0].spell_name).toBe('Touch of Vinitras');
    expect(h._recentMechanics[0].victims).toEqual(['Currygoat']);
  });

  it('records nothing out of combat', () => {
    const h = build();
    const idle = { bossName: null, startedAt: null, targets: new Map(), _fightTargetMatches: () => false };
    h.noteMechanicLanding(T('Uilnayar feels dispelled.'), 'Uilnayar', idle);
    expect(h._recentMechanics).toHaveLength(0);
  });
});

describe('one AE burst is ONE row with a victim count', () => {
  it('collapses 30 victims of one cast instead of writing 30 rows', () => {
    const h = build();
    const b = fight('Lord of Ire');
    // Alphabetic names on purpose: _looksLikeTargetName rejects digits, because
    // no EQ character or mob name has one.
    const AZ = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 30; i++) {
      const who = 'Raider' + AZ[i % 26] + AZ[Math.floor(i / 26)];
      h.noteMechanicLanding(T(who + ' is knocked into the air by a massive force.'), 'Uilnayar', b);
    }
    const rows = h._recentMechanicsForWeb();
    expect(rows).toHaveLength(1);
    expect(rows[0].victim_count).toBe(30);
    expect(rows[0].victims.length).toBeLessThanOrEqual(12);   // names capped, count is not
    expect(rows[0].spell_name).toBe('Fling');
  });

  it('does not double-count the same victim seen in a main AND an alt log', () => {
    // One install watching two logs receives the identical server line twice.
    const h = build();
    const b = fight('Lord of Ire');
    const line = T('Uilnayar is knocked into the air by a massive force.');
    h.noteMechanicLanding(line, 'Uilnayar', b);
    h.noteMechanicLanding(line, 'Hopeya', b);
    expect(h._recentMechanics).toHaveLength(1);
    expect(h._recentMechanics[0].victim_count).toBe(1);
  });

  it('a second cast past the coalesce window is its own row', () => {
    const h = build();
    const b = fight('Lord of Ire');
    h.noteMechanicLanding(T('Uilnayar is knocked into the air by a massive force.', 'Sun Aug 09 21:50:25 2026'), 'Uilnayar', b);
    h.noteMechanicLanding(T('Uilnayar is knocked into the air by a massive force.', 'Sun Aug 09 21:50:55 2026'), 'Uilnayar', b);
    expect(h._recentMechanics).toHaveLength(2);
    // Newest first for the dashboard.
    const rows = h._recentMechanicsForWeb();
    expect(rows[0].last_at_ms).toBeGreaterThan(rows[1].last_at_ms);
  });

  it('interleaved mechanics still coalesce to their own rows', () => {
    const h = build();
    const b = fight('Lord of Ire');
    h.noteMechanicLanding(T('Uilnayar is knocked into the air by a massive force.'), 'Uilnayar', b);
    h.noteMechanicLanding(T('Hopeya feels dispelled.'), 'Uilnayar', b);
    h.noteMechanicLanding(T('Canopy is knocked into the air by a massive force.'), 'Uilnayar', b);
    const rows = h._recentMechanicsForWeb();
    expect(rows).toHaveLength(2);
    const fling = rows.find(r => r.spell_name === 'Fling');
    expect(fling.victim_count).toBe(2);
  });

  it('serializes without the internal victim Set', () => {
    const h = build();
    const b = fight('Lord of Ire');
    h.noteMechanicLanding(T('Uilnayar feels dispelled.'), 'Uilnayar', b);
    const row = h._recentMechanicsForWeb()[0];
    expect(row._victims).toBeUndefined();
    expect(() => JSON.stringify(row)).not.toThrow();
  });
});
