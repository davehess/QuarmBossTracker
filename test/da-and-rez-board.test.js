// Two mid-raid overlay bugs from one report (Hitya, 2026-08-30).
import { describe, it, expect } from 'vitest';
import { AGENT_INDEX, readSource, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const code = stripJs(src);

describe('what counts as invulnerable', () => {
  // The constants and the function live ~600 lines apart in the monolith;
  // compose the two slices so the test runs the SHIPPED pair.
  const { _findDA, DA_SPELL_RX } = evalBlock(
    sliceBlock(src, 'const DA_SPELL_RX', 'const DA_MAX_PLAUSIBLE_SEC = 60;') + '\n' +
    sliceBlock(src, 'function _findDA(buffsList, greenSecs)', '\n}'),
    ['_findDA', 'DA_SPELL_RX'],
  );

  it('Divine Intervention is NOT an invulnerability', () => {
    // The reported bug: the Tank card showed "INV 5:36" on Hawkner. DI is a
    // one-shot death save — under it the tank takes full damage and can die —
    // and the catalog proves the confusion: every true invuln is 3 ticks (18s)
    // while DI (spell 1546) is 100 ticks = 10 minutes.
    expect(DA_SPELL_RX.test('Divine Intervention')).toBe(false);
    expect(_findDA([{ name: 'Divine Intervention', seconds: 336 }], 5)).toBeNull();
  });

  it('still recognises the real ones', () => {
    for (const n of ['Divine Aura', 'Divine Barrier', 'Harmshield']) {
      expect(DA_SPELL_RX.test(n), n).toBe(true);
      expect(_findDA([{ name: n, seconds: 18 }], 5)).not.toBeNull();
    }
  });

  it('refuses any DA-named buff reading minutes', () => {
    // The durable half: a name whitelist can be wrong again, a duration cannot.
    expect(_findDA([{ name: 'Divine Aura', seconds: 336 }], 5)).toBeNull();
    expect(_findDA([{ name: 'Divine Aura', seconds: 18 }], 5).seconds).toBe(18);
  });

  it('keeps the ≤greenSecs critical cue', () => {
    expect(_findDA([{ name: 'Divine Aura', seconds: 4 }], 5).critical).toBe(true);
    expect(_findDA([{ name: 'Divine Aura', seconds: 12 }], 5).critical).toBe(false);
  });

  it('skips faded and nameless entries without throwing', () => {
    expect(_findDA([{ name: 'Divine Aura', seconds: 9, fell_off: true }], 5)).toBeNull();
    expect(() => _findDA([null, {}, { name: null }], 5)).not.toThrow();
  });
});

describe('needs-rez board', () => {
  it('keeps the name as written — the board renders it', () => {
    // It listed "dafeet, meditate, shavimo…" because the map KEY (lowercased
    // for matching) was being emitted as the display name.
    const note = stripJs(sliceBlock(src, 'function _noteDeath(name, atMs)', '\n}'));
    expect(note).toMatch(/display: raw/);
    const snap = stripJs(sliceBlock(src, 'function _deadNamesSnapshot(nowMs)', '\n}'));
    expect(snap).toMatch(/name: \(v && v\.display\) \|\| n/);
  });

  it('never lists a pet — a pet cannot be rezzed', () => {
    // Jtik was on the board. A healer reading that row spends a rez on
    // something no rez can touch.
    // _isOurPetName is the purpose-built predicate: charm tracker + Zeal
    // slot 16 + the declared pet-leaders registry. Behaviour is covered in
    // test/rez-board.test.js against the sliced board itself.
    const note = stripJs(sliceBlock(src, 'function _noteDeath(name, atMs)', '\n}'));
    expect(note).toMatch(/if \(_isOurPetName\(k\)\) return;/);
  });

  it('reads the death time through one accessor, not the raw value', () => {
    // The value shape changed; every consumer must go through _deadAt or it
    // silently compares a number against an object.
    expect(code).toMatch(/function _deadAt\(nameLower\)/);
    const consumers = code.match(/_deadSince\.get\(/g) || [];
    expect(consumers.length, 'only _deadAt may read the map directly').toBe(1);
  });
});
