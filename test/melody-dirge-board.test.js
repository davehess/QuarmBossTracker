// The DIRGE NUKE board on the Melody overlay (the guild lead, 2026-09-26): "a little switch and a red
// button that says DIRGE NUKE on it when amplification and resonance/harmonize and Puretone is
// available … As soon as Amplification flips on as the last item, the control board slides out …
// shows the Puretone Key (that turns if you do it) and then the NUKE button that has a cooldown on it
// for recast and HOW MANY Dirges you can do (mana divided by 800)".
//
// Run: npx vitest run test/melody-dirge-board.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, AGENT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);
const melody = readSource(path.join(ROOT, 'apps', 'mimic', 'melody.html'));

// The agent half, run against a stand-in disc timer.
function loadAgent(discs, discSnap) {
  const block = sliceBlock(agent, 'const DIRGE_MANA = 800;', '\n}\n');
  // eslint-disable-next-line no-new-func
  return new Function('_meDiscs', '_meDisc', block + '\nreturn { _dirgeInfo, PURETONE_SECS };')(
    new Map(Object.entries(discs || {})), () => discSnap || null);
}

// The overlay half: dirgeView is pure; fmtSecs is its only helper.
const view = (() => {
  const js = sliceBlock(melody, '// dirge-board:js:start', '// dirge-board:js:end');
  const pure = js.slice(js.indexOf('var DIRGE_SELO_MIN_SECS'), js.indexOf('var _dirgeCastAt'))
    .replace(/try \{ _dirgeOn = localStorage[^\n]*\n/, '');
  // eslint-disable-next-line no-new-func
  return new Function(pure + '\nreturn { dirgeView, DIRGE_SELO_MIN_SECS };')();
})();

const ALL = [
  { name: 'Guardian Rhythms', ticks: null },
  { name: 'Psalm of Mystic Shielding', ticks: null },
  { name: 'Niv`s Harmonic', ticks: null },
];

describe('agent: what the board waits for', () => {
  it('the three pre-buffs by EXACT name — any other psalm or Niv`s song does not count', () => {
    const { _dirgeInfo } = loadAgent();
    expect(_dirgeInfo('brackwyn', {}, ALL, 0)).toMatchObject({ guardian: true, psalm: true, nivs_harmonic: true });
    const lookalikes = [{ name: 'Psalm of Warmth' }, { name: 'Niv`s Melody of Preservation' }, { name: 'Guardian' }];
    expect(_dirgeInfo('brackwyn', {}, lookalikes, 0)).toMatchObject({ guardian: false, psalm: false, nivs_harmonic: false });
    expect(_dirgeInfo('brackwyn', {}, [{ name: "Niv's Harmonic " }], 0).nivs_harmonic).toBe(true);   // punctuation, trailing space
  });

  it('Puretone: up from the buff window, else from the disc line inside its 4 minutes', () => {
    const { _dirgeInfo } = loadAgent();
    expect(_dirgeInfo('b', {}, [{ name: 'Puretone Discipline', ticks: 30 }], 0).puretone)
      .toMatchObject({ active: true, remaining_secs: 180, ready: false });
    const seen = loadAgent({ b: { name: 'Puretone', at: 1000 } }, { ms_left: 4000000 });
    expect(seen._dirgeInfo('b', {}, [], 61000).puretone).toMatchObject({ active: true, remaining_secs: 180, ready: false });
    expect(seen._dirgeInfo('b', {}, [], 1000 + 240000).puretone).toMatchObject({ active: false, ready: false, ready_in_secs: 4000 });
    const other = loadAgent({ b: { name: 'Deftdance', at: 1000 } }, { ms_left: 60000 });
    expect(other._dirgeInfo('b', {}, [], 2000).puretone).toMatchObject({ active: false, ready: false, ready_in_secs: 60 });
  });

  it('a disc timer never seen, or run out, is ready; mana passes through for the count', () => {
    expect(loadAgent()._dirgeInfo('b', { self_mana_cur: 4300, self_mana_max: 5000 }, [], 0))
      .toMatchObject({ puretone: { active: false, ready: true }, mana_cur: 4300, mana_max: 5000, dirge_mana: 800, dirge_cast_ms: 3000 });
    expect(loadAgent({}, { ms_left: 0 })._dirgeInfo('b', null, [], 0)).toMatchObject({ puretone: { ready: true }, mana_cur: null });
  });

  it('it rides the bard strip, searched over the buff slots AND the raw dump', () => {
    const s = stripJs(agent);
    expect(s).toContain('dirge:         _dirgeInfo(k, zealSt, zealBuffs.concat(rawDebugBuffs), now),');
  });
});

const bb = (over) => Object.assign({
  amplification: { observed: true }, resonance: { observed: true }, harmonize: null,
  accelerating_chorus: { observed: true, remaining_secs: 140 },
  dirge: { guardian: true, psalm: true, nivs_harmonic: true, puretone: { active: false, ready: true },
    mana_cur: 4300, dirge_mana: 800, dirge_cast_ms: 3000 },
}, over);

describe('overlay: the lamps, the slide-out, the key and the count', () => {
  it('every lamp lit → the board is out; Amplification missing → it is not', () => {
    const v = view.dirgeView(bb(), 0, 0);
    expect(v.lamps.map(l => l.label)).toEqual(['GR', 'PSM', 'SELO', 'NIV', 'RES', 'AMP', 'PT']);
    expect(v.open).toBe(true);
    expect(view.dirgeView(bb({ amplification: null }), 0, 0).open).toBe(false);
    expect(view.dirgeView(bb({ resonance: null, harmonize: { observed: true } }), 0, 0).lamps[4]).toMatchObject({ label: 'HAR', on: true });
  });

  it('Selo`s needs 2:00 left (it lasts 2:30 at most), and short of that the lamp is amber, not lit', () => {
    expect(view.DIRGE_SELO_MIN_SECS).toBe(120);
    const low = view.dirgeView(bb({ accelerating_chorus: { observed: true, remaining_secs: 119 } }), 0, 0);
    expect(low.lamps[2]).toMatchObject({ on: false, warn: true });
    expect(low.open).toBe(false);
  });

  it('Puretone on cooldown keeps it in; once Puretone is up the board stays out as the songs fade', () => {
    const cd = bb();
    cd.dirge = Object.assign({}, cd.dirge, { puretone: { active: false, ready: false, ready_in_secs: 125 } });
    const v = view.dirgeView(cd, 0, 0);
    expect(v).toMatchObject({ open: false, turned: false, keyLabel: 'PURETONE 2:05' });
    const up = bb({ amplification: null, resonance: null, accelerating_chorus: null });
    up.dirge = Object.assign({}, up.dirge, { guardian: false, puretone: { active: true, remaining_secs: 236 } });
    expect(view.dirgeView(up, 0, 0)).toMatchObject({ open: true, turned: true, keyLabel: 'PURETONE 3:56' });
  });

  it('the count is mana ÷ 800, rounded down; the ring fills over the 3 s sing', () => {
    expect(view.dirgeView(bb(), 0, 0).count).toBe(5);
    const oom = bb(); oom.dirge = Object.assign({}, oom.dirge, { mana_cur: 799 });
    expect(view.dirgeView(oom, 0, 0).count).toBe(0);
    const none = bb(); none.dirge = Object.assign({}, none.dirge, { mana_cur: null });
    expect(view.dirgeView(none, 0, 0).count).toBe(null);
    expect(view.dirgeView(bb(), 11500, 10000)).toMatchObject({ firing: true, sweep: 0.5 });
    expect(view.dirgeView(bb(), 13000, 10000).firing).toBe(false);
  });
});

describe('overlay: wiring', () => {
  const s = stripJs(melody);
  it('the switch has the hover handshake and is remembered per machine; the tick paints the board', () => {
    const js = sliceBlock(melody, '// dirge-board:js:start', '// dirge-board:js:end');
    expect(js).toMatch(/_dsw\.addEventListener\('mouseenter', function\(\)\{ try \{ window\.mimic\.overlayHoverInteractive\(true\)/);
    expect(js).toMatch(/localStorage\.setItem\('wp:melody:dirge'/);
    expect(s).toContain('paintDirge(_boardSt, now);');
  });
  it('the label between casts no longer reads an undefined name (it stopped every repaint)', () => {
    const def = s.indexOf('var curKind  = (curEntry && curEntry.kind) || st.kind');
    expect(def).toBeGreaterThan(-1);
    expect(def).toBeLessThan(s.indexOf("(curKind === 'spell'"));
  });
});
