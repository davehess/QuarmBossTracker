// test/pacify-tracking.test.js — the pull-safety family, and the two ways it
// can lie to you.
//
// Hitya, 2026-09-02: "things like pacifying where we lower aggro radius for a
// mob and don't engage. but keep the timer is vital for certain operations."
//
// ⚠ THE COUNTDOWN IS THE ONLY SIGNAL THAT WILL EVER EXIST. `spell_fades` is
// NULL for all 14 SPA-30 timed spells, so EQ never prints a wear-off line —
// nothing downstream can notice a wrong number and correct it, the way a
// re-land refreshes a slow. Both failure directions are live:
//   1. SEVEN spells share the emote "looks less aggressive." spanning 42s
//      (Calm) to 360s (Pacify) at L60 — an 8.5x spread, in the direction that
//      gets you the add you were avoiding. resolveSelfCastLanding is what
//      disambiguates them, using the fact that WE cast it.
//   2. THREE emit no line at all (cast_on_other NULL), so a druid Harmony pull
//      is invisible to every log in the raid. Those are synthesized.
//
// Run: npx vitest run test/pacify-tracking.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// ⚠ End anchor is the section comment that OPENS the next block, never a line
// of either function's body — a slice closed on the body under test turns every
// mutation into "suite failed to load", which reads like a kill and proves
// nothing. (This repo has made that mistake; see target-info-spawn-id-scope.)
const { PACIFY_SPELLS, _isPacifySpell, PACIFY_NO_EMOTE } = evalBlock(
  sliceBlock(
    src,
    'const PACIFY_SPELLS = new Set([',
    '\n// ── EQ class-title → base class ',
  ),
  ['PACIFY_SPELLS', '_isPacifySpell', 'PACIFY_NO_EMOTE'],
);

// The synthesis pair, with the collaborators they close over stubbed to
// observable fakes. Everything the assertions read is the REAL function.
function loadSynth() {
  const block = sliceBlock(
    src,
    'const _pendingPacify = new Map();',
    '\n// ── Self-cast capture ',
  );
  const harness = `
    const PACIFY_NO_EMOTE = new Set(['harmony', 'harmony of nature', 'lull animal']);
    const _buffLandingsByTarget = new Map();
    const whoData = new Map();
    const buffCastBuffer = [];
    let _zealTarget = 'a froglok tad';
    function _zealTargetForChar(){ return _zealTarget; }
    function _spellByNameLower_get(k){ return CATALOG.get(k); }
    const CATALOG = new Map([
      // Real eqemu_spells rows.
      ['harmony',           { id: 250, name: 'Harmony',    other: null, dur: 20, durf: 2, good: 1 }],
      ['harmony of nature', { id: 1462, name: 'Harmony of Nature', other: null, dur: 7, durf: 2, good: 1 }],
      ['lull animal',       { id: 209, name: 'Lull Animal', other: null, dur: 20, durf: 9, good: 1 }],
      ['pacify',            { id: 45,  name: 'Pacify', other: 'looks less aggressive.', dur: 60, durf: 8, good: 1 }],
    ]);
    const _spellByNameLower = { get: _spellByNameLower_get };
    function _assumedCasterLevel(){ return 60; }
    function _durTicksForLevel(f, cap, lvl){
      let t;
      switch (Number(f)) {
        case 2:  t = (lvl <= 1) ? 6 : Math.floor(lvl / 2) + 5; break;
        case 8:  t = lvl + 10; break;
        case 9:  t = lvl * 2 + 10; break;
        default: return cap;
      }
      if (!(t > 0)) return cap;
      if (cap > 0 && t > cap) t = cap;
      return t;
    }
    let _provableId = 4425;
    function _provableTargetId(){ return _provableId; }
    function parseEqTimestamp(line){ const m=String(line).match(/^\\[(.+?)\\]/); return m ? new Date(m[1] + ' UTC') : null; }
    ${block}
    function __setTarget(v){ _zealTarget = v; }
    function __setUncatalogued(){ CATALOG.clear(); }
    function __setProvableId(v){ _provableId = v; }
  `;
  return evalBlock(harness, [
    '_synthesizePacifyLanding', 'notePacifyMiss', '_pendingPacify',
    '_clearPendingPacifyOnNewCast',
    '_buffLandingsByTarget', 'buffCastBuffer', 'whoData',
    '__setTarget', '__setProvableId', '__setUncatalogued',
  ]);
}

const T0 = Date.parse('Wed Sep 02 20:10:00 2026 UTC');

// The real emitter, so the flag the overlay branches on is proven to be SET —
// not just proven to work once something sets it. Removing the flag from
// targetBuffsFor left the entire suite green before this existed, and the
// failure is silent: pacify quietly falls back into the mob's green buff list,
// which is the exact thing this work was asked to stop.
const { targetBuffsFor, _buffLandingsByTarget: STORE } = evalBlock(
  `
  const _buffLandingsByTarget = new Map();
  const FELL_OFF_LINGER_MS = 300000;
  function _isHotBuff(){ return false; }
  function _spellGood(n){ return /tashania/i.test(n) ? 0 : 1; }
  ` + sliceBlock(src, 'function targetBuffsFor(targetLower, wantId) {', '\n// ── Caster cast-correlation for buff landings ')
    // ⚠ Newline between the slices: the first one ENDS on a // comment line, so
    // concatenating directly would bury the next declaration inside it.
    + '\n'
    + sliceBlock(src, 'const PACIFY_SPELLS = new Set([', '\n// ── EQ class-title → base class '),
  ['targetBuffsFor', '_buffLandingsByTarget'],
);

describe('the flag the overlay actually branches on', () => {
  function seed(rows) {
    STORE.clear();
    const mp = new Map();
    for (const r of rows) mp.set(r.name.toLowerCase(), { landed_at: Date.now(), ...r });
    STORE.set('a froglok tad', mp);
  }

  it('marks a pacify row, and only the pacify row', () => {
    seed([
      { name: 'Pacify',   dur_ticks: 60 },
      { name: 'Tashania', dur_ticks: 30 },
      { name: 'Celerity', dur_ticks: 90 },
    ]);
    const out = targetBuffsFor('a froglok tad', null);
    const by = Object.fromEntries(out.map(r => [r.name, r]));
    expect(by.Pacify.pacified).toBe(true);
    expect(by.Tashania.pacified).toBe(false);
    expect(by.Celerity.pacified).toBe(false);
  });

  it('marks a synthesized Harmony the same way', () => {
    seed([{ name: 'Harmony', dur_ticks: 20, owner: 'Canopy' }]);
    const [row] = targetBuffsFor('a froglok tad', null);
    expect(row.pacified).toBe(true);
    expect(row.owner).toBe('Canopy');
  });

  // ⚠ Hitya, 2026-09-02: "harmony is not the same as pacify... it's AOE so
  // nearby mobs will get harmony as well. harmony will still aggro mobs if you
  // stand very close, vs pacify that will not attack even if you're colliding
  // with them." targettype confirms it: Harmony and Wake of Tranquility are 8
  // (targeted AE), the rest of the family is 5/9/10 (single).
  it('separates the AE members from the single-target ones', () => {
    seed([
      { name: 'Harmony',             dur_ticks: 20 },
      { name: 'Wake of Tranquility', dur_ticks: 7 },
      { name: 'Pacify',              dur_ticks: 60 },
      { name: 'Lull Animal',         dur_ticks: 20 },
    ]);
    const by = Object.fromEntries(targetBuffsFor('a froglok tad', null).map(r => [r.name, r]));
    expect(by.Harmony.pacify_ae).toBe(true);
    expect(by['Wake of Tranquility'].pacify_ae).toBe(true);
    expect(by.Pacify.pacify_ae).toBe(false);
    expect(by['Lull Animal'].pacify_ae).toBe(false);
    // All four are still pacifies — AE is a property OF one, not a category.
    for (const n of Object.keys(by)) expect(by[n].pacified, n).toBe(true);
  });

  it('flags a synthesized row as unconfirmed and a witnessed one as not', () => {
    // Harmony is resist_type 0, so the resist line never fires for it, and its
    // level-failure message is not yet known to us — a synthesized row can be a
    // phantom and must not render as a witnessed land.
    seed([{ name: 'Harmony', dur_ticks: 20, unconfirmed: true },
          { name: 'Pacify',  dur_ticks: 60 }]);
    const by = Object.fromEntries(targetBuffsFor('a froglok tad', null).map(r => [r.name, r]));
    expect(by.Harmony.unconfirmed).toBe(true);
    expect(by.Pacify.unconfirmed).toBe(false);
  });

  it('keeps the catalog good-flag intact underneath it', () => {
    // The pacify flag is ADDITIVE. Overwriting `good` here would change how the
    // row renders anywhere that still reads the good/bad split.
    // Both directions — asserting only the pacify's own good=1 passes even if
    // `good` is hard-wired to 1, which would silently move every debuff on
    // every mob out of the red section.
    seed([{ name: 'Pacify', dur_ticks: 60 }, { name: 'Tashania', dur_ticks: 30 }]);
    const by = Object.fromEntries(targetBuffsFor('a froglok tad', null).map(r => [r.name, r]));
    expect(by.Pacify.good).toBe(1);
    expect(by.Tashania.good).toBe(0);
  });

  it('still hides a pacify proven to be on a different spawn', () => {
    // The spawn-id scope must keep working through the new flag — a sibling's
    // pacify shown on this mob is a pull decision made on the wrong mob.
    seed([{ name: 'Pacify', dur_ticks: 60, target_id: 4471 }]);
    expect(targetBuffsFor('a froglok tad', 4425)).toHaveLength(0);
    expect(targetBuffsFor('a froglok tad', 4471)).toHaveLength(1);
  });
});

describe('which spells count as pacify', () => {
  it('covers the whole SPA-30 timed family, all 14', () => {
    // Grounded in eqemu_spells (effect_id_* = 30, timed formula), queried
    // 2026-09-02. A shrinking set is the dangerous direction: a pacify we do
    // not recognise silently loses its own line and its warning colour.
    expect(PACIFY_SPELLS.size).toBe(14);
    for (const n of ['Pacify', 'Lull', 'Soothe', 'Calm', 'Harmony',
                     'Wake of Tranquility', 'Pacification', 'Lull Animal',
                     'Calm Animal', 'Numb the Dead', 'Rest the Dead',
                     'Harmony of Nature', 'Silent Song of Quellious']) {
      expect(_isPacifySpell(n), n + ' should be recognised').toBe(true);
    }
    // Atone IS SPA 30 but buffduration 0 / formula 0 — instant, so it can never
    // carry a timer. Listing it would seat an un-timed row in the one section
    // that exists to show a clock.
    expect(_isPacifySpell('Atone')).toBe(false);
  });

  it('normalises the backtick possessive EQ actually logs', () => {
    // EQ writes "Kelin`s", the catalog writes "Kelin`s" — a straight-apostrophe
    // lookup misses. Same trap CHARM_SPELLS carries both spellings for.
    expect(_isPacifySpell('Kelin`s Lugubrious Lament')).toBe(true);
    expect(_isPacifySpell("Kelin's Lugubrious Lament")).toBe(true);
  });

  it('does not swallow slows, mezzes or ordinary buffs', () => {
    // A false positive pulls a real debuff OUT of the red section and hides it
    // under "pacified", which is worse than the miss it is guarding.
    for (const n of ["Turgur's Insects", 'Mesmerize', 'Tashania', 'Aegolism',
                     'Charm', 'Malosini', 'Slow']) {
      expect(_isPacifySpell(n), n + ' must not be a pacify').toBe(false);
    }
    expect(_isPacifySpell('')).toBe(false);
    expect(_isPacifySpell(null)).toBe(false);
  });

  it('marks exactly the three that emit no log line, and they are real pacifies', () => {
    // cast_on_other IS NULL for these three and only these three. Adding an
    // emote-bearing spell here would double-record it: resolveSelfCastLanding
    // already resolves those from the landing message.
    expect([...PACIFY_NO_EMOTE].sort()).toEqual(['harmony', 'harmony of nature', 'lull animal']);
    for (const k of PACIFY_NO_EMOTE) expect(PACIFY_SPELLS.has(k)).toBe(true);
  });
});

describe('synthesizing the silent pacifies', () => {
  it('records Harmony on the Zeal target with the catalog duration', () => {
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    const mp = h._buffLandingsByTarget.get('a froglok tad');
    expect(mp, 'a landing should have been recorded').toBeTruthy();
    const row = mp.get('harmony');
    expect(row.name).toBe('Harmony');
    // formula 2 at L60 = floor(60/2)+5 = 35, capped at the spell's 20 → 120s.
    expect(row.dur_ticks).toBe(20);
    expect(row.landed_at).toBe(T0);
    expect(row.owner).toBe('Hitya');
    expect(row.unconfirmed, 'we never saw it land — nothing prints one').toBe(true);
  });

  it('scales off the CASTER level, not the era cap, when /who knows it', () => {
    // Harmony is formula 2 (floor(lvl/2)+5), capped at 20. At 60 the cap binds
    // (35 → 20); at 12 the LEVEL binds (11), so the two paths give different
    // answers and this can actually fail. Reading the era cap for a low-level
    // caster would over-report the timer — the direction that walks someone
    // into the add they were avoiding.
    const h = loadSynth();
    h.whoData.set('hitya', { level: 12 });
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    expect(h._buffLandingsByTarget.get('a froglok tad').get('harmony').dur_ticks)
      .toBe(Math.floor(12 / 2) + 5);          // 11 ticks, genuinely under the 20 cap

    const h60 = loadSynth();                  // and the cap still binds at 60
    h60._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    expect(h60._buffLandingsByTarget.get('a froglok tad').get('harmony').dur_ticks).toBe(20);
  });

  it('stamps the spawn id so it cannot leak onto a same-name sibling', () => {
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    expect(h._buffLandingsByTarget.get('a froglok tad').get('harmony').target_id).toBe(4425);
  });

  it('uploads it, because no other client can possibly know', () => {
    // The whole reason this exists: with no log line, the caster's machine is
    // the only witness. Drop the upload and a Harmony pull is invisible to the
    // rest of the raid even though we tracked it locally.
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    expect(h.buffCastBuffer.length).toBe(1);
    const up = h.buffCastBuffer[0];
    expect(up.spell_name).toBe('Harmony');
    expect(up.target).toBe('a froglok tad');
    expect(up.dur_ticks).toBe(20);
    expect(up.landing_text).toBe('');      // there is no log line to quote
    expect(up.observer).toBe('Hitya');
  });

  it('ignores the emote-bearing pacifies — those resolve for real', () => {
    // Pacify prints "looks less aggressive." and resolveSelfCastLanding names
    // it exactly. Synthesizing here too would write the row twice.
    const h = loadSynth();
    h._synthesizePacifyLanding('Pacify', 'Hitya', T0);
    expect(h._buffLandingsByTarget.size).toBe(0);
    expect(h.buffCastBuffer.length).toBe(0);
  });

  it('records nothing when the catalog cannot give it a duration', () => {
    // A row with dur_ticks 0 is worse than no row: targetBuffsFor computes
    // durSecs 0, so it renders as already expired and the pacify section would
    // flash "WORE OFF" for a pacify that just landed.
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony of Nature', 'Hitya', T0);   // in the set
    expect(h._buffLandingsByTarget.get('a froglok tad').get('harmony of nature')).toBeTruthy();

    const h2 = loadSynth();
    h2.__setUncatalogued();       // same spell, catalog row missing
    h2._synthesizePacifyLanding('Harmony of Nature', 'Hitya', T0);
    expect(h2._buffLandingsByTarget.size).toBe(0);
    expect(h2.buffCastBuffer.length).toBe(0);
  });

  it('records nothing when Zeal cannot name a target', () => {
    // Inventing a target would hang a real timer on the wrong mob.
    const h = loadSynth();
    h.__setTarget(null);
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    expect(h._buffLandingsByTarget.size).toBe(0);
    expect(h.buffCastBuffer.length).toBe(0);
  });
});

describe('taking the timer back when the cast failed', () => {
  const INT = '[Wed Sep 02 20:10:03 2026] Your spell is interrupted.';

  it('drops the synthesized row on an interrupt', () => {
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    expect(h._buffLandingsByTarget.get('a froglok tad')).toBeTruthy();
    h.notePacifyMiss(INT, 'Hitya');
    expect(h._buffLandingsByTarget.get('a froglok tad')).toBeUndefined();
  });

  it('drops it on a fizzle and on a resist, in both resist spellings', () => {
    for (const line of [
      '[Wed Sep 02 20:10:03 2026] Your spell fizzles!',
      '[Wed Sep 02 20:10:03 2026] Your target resisted the Harmony spell.',
      '[Wed Sep 02 20:10:03 2026] a froglok tad resisted your Harmony spell.',
    ]) {
      const h = loadSynth();
      h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
      h.notePacifyMiss(line, 'Hitya');
      expect(h._buffLandingsByTarget.size, line).toBe(0);
    }
  });

  it('leaves an unrelated later interrupt alone', () => {
    // A cast 30s after the pacify is a different spell. Reverting on it would
    // silently delete a live, correct pacify timer.
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    h.notePacifyMiss('[Wed Sep 02 20:10:40 2026] Your spell is interrupted.', 'Hitya');
    expect(h._buffLandingsByTarget.get('a froglok tad').get('harmony')).toBeTruthy();
  });

  it('recovers on a recast after the interrupt reverted it', () => {
    // The real ordering: cast, interrupt, recast. The second one must stand.
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    h.notePacifyMiss(INT, 'Hitya');
    expect(h._buffLandingsByTarget.size).toBe(0);
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0 + 6000);
    const row = h._buffLandingsByTarget.get('a froglok tad').get('harmony');
    expect(row).toBeTruthy();
    expect(row.landed_at).toBe(T0 + 6000);
  });

  it('does not let a LATER cast\'s interrupt kill a good pacify', () => {
    // The bug this was written against: Harmony lands, you start casting
    // something else, THAT fizzles — and the fizzle reverted the Harmony,
    // because the interrupt line names no spell and both were inside the 12s
    // window. An intervening cast is what disambiguates them.
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    h._clearPendingPacifyOnNewCast('hitya', 'clarity');       // cast something else
    h.notePacifyMiss('[Wed Sep 02 20:10:05 2026] Your spell fizzles!', 'Hitya');
    expect(h._buffLandingsByTarget.get('a froglok tad').get('harmony'),
      'the landed Harmony must survive another spell\'s fizzle').toBeTruthy();
  });

  it('a recast of the SAME pacify keeps its own revert window open', () => {
    // The clearer must not fire on the pacify itself, or an interrupt of the
    // recast would leave a phantom timer standing.
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    h._clearPendingPacifyOnNewCast('hitya', 'harmony');
    h.notePacifyMiss(INT, 'Hitya');
    expect(h._buffLandingsByTarget.size).toBe(0);
  });

  it('does nothing on a line that is not a miss at all', () => {
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    h.notePacifyMiss('[Wed Sep 02 20:10:03 2026] You begin casting Harmony.', 'Hitya');
    expect(h._buffLandingsByTarget.get('a froglok tad').get('harmony')).toBeTruthy();
  });

  it('does not revert another character\'s pacify', () => {
    const h = loadSynth();
    h._synthesizePacifyLanding('Harmony', 'Hitya', T0);
    h.notePacifyMiss(INT, 'Borim');
    expect(h._buffLandingsByTarget.get('a froglok tad').get('harmony')).toBeTruthy();
  });
});
