// test/song-aoe-pulse.test.js — the melody AE badge counts ONE pulse, not the
// whole kite. A member's ⚔123/12 (2026-08-19): the EQ client flushes the log in
// multi-second batches under swarm load, so wall-clock burst detection merged
// every pulse of a kite into one count. Pulse boundaries now come from the
// LINE's own timestamp. Also covers the per-song kite damage totals added in
// the same change. Source-slice fidelity tier — exercises the shipped agent
// code, not a copy.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tsBlock  = sliceBlock(src, 'const TS_RX =', 'return isNaN(d.getTime()) ? null : d;\n}');
const aoeBlock = sliceBlock(src, 'const SONG_AOE_CAP', '// Detect a bard song by name pattern.');
// The bardMelody payload's per-song enrichment, run for real (it closes over _songSlug and the
// stale window from the block above), so the test sees the fields the overlay would be sent.
const enrichBlock = sliceBlock(src, 'const enrichedOrder = state.order', '            return out;\n          });');
// Module-level collaborators the sliced block closes over, stubbed.
const prelude = `
const _bardMelody = new Map();
let _spellCatalogMeta = { count: 1 };
const _spellByNameLower = new Map();
const _findSongBuff = () => null;
`;
const S = evalBlock(prelude + tsBlock + '\n' + aoeBlock + `
function _enrich(state, zealBuffs, now) { ${enrichBlock}\n return enrichedOrder; }
`, [
  'noteSongAoeLine', '_bardMelody', '_spellByNameLower', '_spellCatalogMeta', '_enrich',
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

// ── FB-57: only AREA songs wear the chip ─────────────────────────────────────
// A member: "Assonance is single target, should not have the 12 counter". The agent registered the
// hits/12 counter for ANY detrimental song with landing text, and melody.html invents a chip from a
// lone DoT tick. The bot's spell catalog (v9) now flags area spells from the spell's own targettype
// (`ae: true`), and the agent counts only those — but only once the catalog carries the flag at all,
// so a pre-v9 bot leaves beta exactly as it was. Real rows: Angstlich's Assonance is eqemu_spells 1748,
// targettype 5 (single target); Chords of Dissonance is 703, targettype 4 (PB AE).
const ASSONANCE = { id: 1748, name: "Angstlich's Assonance", good: 0, other: 'has been deafened.' };
const CHORDS    = { id: 703, name: 'Chords of Dissonance', good: 0, other: 'winces.', ae: true };
const ASS_SLUG = 'angstlichsassonance';
const ASS_LABEL = 'Angstlich`s Assonance';   // the Zeal label spells it with a backtick; the catalog with an apostrophe

// A melody of [Assonance, Chords] over the given catalog rows. `hasAe` is what the agent derives
// from the catalog on load (_catalogHasAe) — set directly here, and pinned separately below.
function melodyOver(rows, hasAe, order = [{ name: ASS_LABEL }, { name: 'Chords of Dissonance' }]) {
  S._bardMelody.clear();
  S._spellByNameLower.clear();
  for (const r of rows) S._spellByNameLower.set(r.name.toLowerCase(), r);
  S._spellCatalogMeta.count = rows.length;
  S._spellCatalogMeta.hasAe = hasAe;
  const state = { order };
  S._bardMelody.set(CHAR, state);
  return state;
}
// One pulse at log-second `sec`: Assonance's landing + damage lines on a bear, Chords' on twelve.
function pulse(sec) {
  const line = (body) => S.noteSongAoeLine(`${stamp(sec)} ${body}`, CHAR);
  line('A brown bear has been deafened.');
  line(`A brown bear has taken 40 damage from your ${ASS_LABEL}.`);
  for (let i = 0; i < 12; i++) line('A shik`nar forager winces.');
  for (let i = 0; i < 12; i++) line('A shik`nar forager has taken 90 damage from your Chords of Dissonance.');
}
// The overlay's view of the state: the real payload enrichment, `now` a second after the last row.
function payloadOf(state) {
  const rows = Object.values(state.aoeBySong || {});
  const last = Math.max(0, ...rows.map(b => Math.max(b.hitAt || 0, (b.dmg && b.dmg.at) || 0)));
  return S._enrich(state, [], last + 1000);
}
// The chip melody.html draws for one payload entry — the real block, sliced out of the page.
const melodyHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'melody.html'));
const chipJs = sliceBlock(melodyHtml, 'var AOE_CAP = 12;', "esc(dmgChip) + '</span>';\n          }");
// eslint-disable-next-line no-new-func
const chipFn = new Function('entry', 'showDmg', 'esc', 'fmtDmg', 'fmtElapsed', chipJs + '\nreturn aoeHtml;');
const chip = (entry) => chipFn(entry, true, String, String, String);

describe('FB-57 — the AE chip is for area songs only (catalog `ae`)', () => {
  it('a catalog that carries `ae`: a single-target song is not counted at all — landing rows or damage — and an area song still is', () => {
    const st = melodyOver([ASSONANCE, CHORDS], true);
    pulse(0);
    expect(st.aoeBySong[ASS_SLUG]).toBeUndefined();
    expect(st.aoeBySong.chordsofdissonance.hits).toBe(12);
    expect(st.aoeBySong.chordsofdissonance.dmg).toMatchObject({ n: 12, total: 1080 });
    expect(st._aoeSuffixes.map(s => s.slug)).toEqual(['chordsofdissonance']);
    expect([...st._aoeSongSlugs]).toEqual(['chordsofdissonance']);
  });

  it('a pre-v9 catalog (no entry carries `ae`): Assonance is counted exactly as before — beta is never worse than today', () => {
    const st = melodyOver([ASSONANCE, { ...CHORDS, ae: undefined }], false);
    pulse(0);
    expect(st.aoeBySong[ASS_SLUG].hits).toBe(1);
    expect(st.aoeBySong[ASS_SLUG].dmg).toMatchObject({ n: 1, total: 40 });
    expect(st.aoeBySong.chordsofdissonance.hits).toBe(12);
  });

  it('a refetch that adds the flag keeps the same spell COUNT and still rebuilds the matchers (the signature carries it)', () => {
    const st = melodyOver([ASSONANCE, { ...CHORDS, ae: undefined }], false);
    pulse(0);
    expect(st._aoeSuffixes.map(s => s.slug).sort()).toEqual([ASS_SLUG, 'chordsofdissonance']);
    expect(st.aoeBySong[ASS_SLUG].hits).toBe(1);
    // The bot ships v9: same two spells, now with the flag. Same state object, same melody order.
    S._spellByNameLower.set('chords of dissonance', CHORDS);
    S._spellCatalogMeta.hasAe = true;
    pulse(10);
    expect(st._aoeSuffixes.map(s => s.slug)).toEqual(['chordsofdissonance']);
    expect(st.aoeBySong[ASS_SLUG].hits).toBe(1);          // the new pulse added nothing
    expect(st.aoeBySong[ASS_SLUG].dmg.n).toBe(1);
  });

  it('a song the flagged catalog does not know at all is left as it was — only a KNOWN single-target song is dropped', () => {
    const st = melodyOver([CHORDS], true, [{ name: 'Mystery Dirge' }]);
    S.noteSongAoeLine(`${stamp(0)} A brown bear has taken 52 damage from your Mystery Dirge.`, CHAR);
    expect(st.aoeBySong.mysterydirge.dmg).toMatchObject({ n: 1, total: 52 });
  });

  it('the Melody payload carries no aoe fields for the single-target song, and the overlay draws no chip for it', () => {
    const st = melodyOver([ASSONANCE, CHORDS], true);
    pulse(0);
    const [ass, chords] = payloadOf(st);
    expect(ass.name).toBe(ASS_LABEL);
    expect(Object.keys(ass).filter(k => k.startsWith('aoe_'))).toEqual([]);
    expect(chip(ass)).toBe('');
    expect(chords.aoe_hits).toBe(12);
    expect(chip(chords)).toContain('⚔12/12');
  });

  it('the same pulse on a pre-v9 catalog still sends Assonance a chip (the old behaviour, kept until the bot ships)', () => {
    const st = melodyOver([ASSONANCE, { ...CHORDS, ae: undefined }], false);
    pulse(0);
    const [ass] = payloadOf(st);
    expect(ass.aoe_hits).toBe(1);
    expect(chip(ass)).toContain('⚔1/12');
  });

  it('an area song whose landing text never matches still shows its damage burst as a chip (the Dirge)', () => {
    expect(chip({ name: 'Denon`s Desperate Dirge', aoe_dmg: { n: 4, total: 400, min: 100, max: 100 } })).toContain('⚔4/12');
    expect(chip({ name: 'Denon`s Desperate Dirge' })).toBe('');
  });
});

describe('FB-57 — the agent reads the flag off the catalog it loaded', () => {
  const hasAe = evalBlock(sliceBlock(src, 'function _catalogHasAe(', '\n'), ['_catalogHasAe'])._catalogHasAe;

  it('true when any entry is flagged, false for a pre-v9 catalog, empty or malformed input', () => {
    expect(hasAe([{ id: 1, name: 'A' }, { id: 2, name: 'B', ae: true }])).toBe(true);
    expect(hasAe([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])).toBe(false);
    expect(hasAe([])).toBe(false);
    expect(hasAe(null)).toBe(false);
    expect(hasAe([null, undefined, { ae: false }])).toBe(false);
  });

  it('the disk cache load sets it, so a restart on a v9 cache starts filtered and a v8 cache starts as before', () => {
    const run = (entries) => {
      const files = { 'cat.json': JSON.stringify({ fetched_at: 'x', etag: '"e"', entries }) };
      const fsStub = { existsSync: () => true, readFileSync: (f) => files[f] };
      const block = sliceBlock(src, 'function _loadSpellCatalogFromDisk() {', '\n}\n');
      // eslint-disable-next-line no-new-func
      return new Function('fs', 'SPELL_CATALOG_FILE', '_catalogHasAe', '_rebuildBuffMatchers', '_rebuildMechanicMatchers', 'console',
        `let _spellByNameLower = new Map(); let _spellCatalogMeta = null;\n${block}\n_loadSpellCatalogFromDisk();\nreturn _spellCatalogMeta;`)(
        fsStub, 'cat.json', hasAe, () => {}, () => {}, { log() {}, warn() {} });
    };
    expect(run([{ id: 1, name: 'A' }, { id: 2, name: 'B', ae: true }])).toMatchObject({ count: 2, hasAe: true });
    expect(run([{ id: 1, name: 'A' }, { id: 2, name: 'B' }])).toMatchObject({ count: 2, hasAe: false });
  });

  it('the live fetch sets it too', () => {
    const code = stripJs(src);
    expect(code).toContain('count: data.entries.length, hasAe: _catalogHasAe(data.entries) };');
  });
});
