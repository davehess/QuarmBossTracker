// test/song-aoe-pulse.test.js — the melody AE badge counts ONE pulse, not the
// whole kite. Fittir's ⚔123/12 (2026-08-19): the EQ client flushes the log in
// multi-second batches under swarm load, so wall-clock burst detection merged
// every pulse of a kite into one count. Pulse boundaries now come from the
// LINE's own timestamp. Also covers the per-song kite damage totals added in
// the same change. Source-slice fidelity tier — exercises the shipped agent
// code, not a copy.
import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tsBlock  = sliceBlock(src, 'const TS_RX =', 'return isNaN(d.getTime()) ? null : d;\n}');
const aoeBlock = sliceBlock(src, 'const SONG_AOE_CAP', '// Detect a bard song by name pattern.');
// Module-level collaborators the sliced block closes over, stubbed.
const prelude = `
const _bardMelody = new Map();
let _spellCatalogMeta = { count: 1 };
const _spellByNameLower = new Map();
`;
const S = evalBlock(prelude + tsBlock + '\n' + aoeBlock, [
  'noteSongAoeLine', '_bardMelody', '_spellByNameLower',
  'SONG_AOE_PULSE_GAP_MS', 'SONG_AOE_STALE_MS',
]);

const CHAR = 'fittir';
const SLUG = 'chordsofdissonance';
function freshState() {
  S._bardMelody.clear();
  S._spellByNameLower.clear();
  S._spellByNameLower.set('chords of dissonance', {
    name: 'Chords of Dissonance', good: 0, other: 'is bound by chords of music.',
  });
  const state = { order: [{ name: 'Chords of Dissonance' }] };
  S._bardMelody.set(CHAR, state);
  return state;
}
// 1s-resolution log stamp at a fixed date, `sec` seconds after 22:10:00.
function stamp(sec) {
  const mm = String(10 + Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `[Tue Aug 18 22:${mm}:${ss} 2026]`;
}
function land(sec, mob) {
  S.noteSongAoeLine(`${stamp(sec)} ${mob} is bound by chords of music.`, CHAR);
}
function dmg(sec, mob, amount) {
  S.noteSongAoeLine(`${stamp(sec)} ${mob} has taken ${amount} damage from your Chords of Dissonance.`, CHAR);
}

describe('melody AE pulse counting (log-time bursts)', () => {
  it('pulse gap sits between adjacent-second rows (1s) and the next 3s pulse (>=2s)', () => {
    expect(S.SONG_AOE_PULSE_GAP_MS).toBeGreaterThanOrEqual(1000);
    expect(S.SONG_AOE_PULSE_GAP_MS).toBeLessThan(2000);
  });

  it('twelve landing rows in one log second count as one 12-hit pulse', () => {
    const st = freshState();
    for (let i = 0; i < 12; i++) land(0, 'A shik`nar forager');
    expect(st.aoeBySong[SLUG].hits).toBe(12);
  });

  it('pulses 3s apart in LOG time do not merge when processed in one wall-clock burst (the 123/12 bug)', () => {
    const st = freshState();
    // Ten 12-hit pulses, replayed as fast as the tailer can read them —
    // wall-clock gaps ~0ms. The old wall-clock burst logic summed to 120.
    for (let p = 0; p < 10; p++) {
      for (let i = 0; i < 12; i++) land(p * 3, 'A shik`nar forager');
    }
    expect(st.aoeBySong[SLUG].hits).toBe(12);
  });

  it('rows straddling adjacent log seconds stay one pulse', () => {
    const st = freshState();
    for (let i = 0; i < 8; i++) land(0, 'A brown bear');
    for (let i = 0; i < 4; i++) land(1, 'A brown bear');
    expect(st.aoeBySong[SLUG].hits).toBe(12);
  });

  it('chat lines quoting a landing phrase are ignored', () => {
    const st = freshState();
    S.noteSongAoeLine(`${stamp(0)} Uilnayar tells the guild, 'A brown bear is bound by chords of music.'`, CHAR);
    expect(st.aoeBySong).toBeUndefined();
  });
});

describe('melody AE damage — per-pulse + kite totals', () => {
  it('per-pulse damage resets each pulse; kite total accumulates across them', () => {
    const st = freshState();
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 3; i++) dmg(p * 3, 'A brown bear', 52);
    }
    const b = st.aoeBySong[SLUG];
    expect(b.dmg).toMatchObject({ n: 3, total: 156, min: 52, max: 52 });
    expect(b.kite.total).toBe(52 * 12);
    expect(b.kite.pulses).toBe(4);
  });

  it('kite total resets after the song goes quiet past the stale window', () => {
    const st = freshState();
    dmg(0, 'A brown bear', 52);
    dmg(3, 'A brown bear', 52);
    dmg(40, 'A brown bear', 60);   // 37s gap > 30s stale window → new kite
    const b = st.aoeBySong[SLUG];
    expect(b.kite.total).toBe(60);
    expect(b.kite.pulses).toBe(1);
    expect(b.dmg).toMatchObject({ n: 1, total: 60, min: 60, max: 60 });
  });

  it('damage lines from songs outside the melody order are ignored', () => {
    const st = freshState();
    S.noteSongAoeLine(`${stamp(0)} A brown bear has taken 52 damage from your Careless Lightning.`, CHAR);
    expect(st.aoeBySong).toEqual({});
  });
});
