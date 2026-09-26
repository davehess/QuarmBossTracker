// The DIRGE TACTICAL NUKE board on the Melody overlay (the guild lead, 2026-09-26): "a little switch and
// a red button that says DIRGE NUKE on it … As soon as Amplification flips on as the last item, the
// control board slides out … shows the Puretone Key (that turns if you do it)", then round two: "Make it
// Harmonize instead of Resonance, and do that first, then Selo's, then your resists, Niv's Harmonic is
// a Breath of Harmony Clicky … have the Keyturn under a little plastic cover that gets uncovered when all
// of the other steps are checked … revealling all of the available dirges per the player (each with a
// seperate button based on how much total mana the player could have vs have now."
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

const bb = (over, dirge) => Object.assign({
  amplification: { observed: true }, harmonize: { observed: true }, resonance: null,
  accelerating_chorus: { observed: true, remaining_secs: 140 }, nivs: null,
  dirge: Object.assign({ guardian: true, psalm: true, nivs_harmonic: true, puretone: { active: false, ready: true },
    mana_cur: 4000, mana_max: 4000, dirge_mana: 800, dirge_cast_ms: 3000 }, dirge),
}, over);

describe('overlay: the steps, the cover, the key', () => {
  it('the steps are the real songs, in the order they are sung, Amplification last', () => {
    expect(view.dirgeView(bb(), 0, 0).steps.map(s => s.label)).toEqual([
      'Harmonize', 'Selo`s Chorus', 'Guardian Rhythms', 'Psalm of Mystic Shielding', 'Niv`s (Breath of Harmony)', 'Amplification']);
  });

  it('every step checked → the board is out and the cover lifts; Amplification missing → neither', () => {
    expect(view.dirgeView(bb(), 0, 0)).toMatchObject({ open: true, uncovered: true, turned: false });
    expect(view.dirgeView(bb({ amplification: null }), 0, 0)).toMatchObject({ open: false, uncovered: false });
  });

  it('Harmonize, not Resonance: Resonance alone reads amber and does not check the step', () => {
    const v = view.dirgeView(bb({ harmonize: null, resonance: { observed: true } }), 0, 0);
    expect(v.steps[0]).toMatchObject({ on: false, warn: true });
    expect(v.open).toBe(false);
  });

  it('Niv`s: the Breath of Harmony click (Niv`s Melody of Preservation) or Niv`s Harmonic, either one', () => {
    expect(view.dirgeView(bb({ nivs: { observed: true } }, { nivs_harmonic: false }), 0, 0).steps[4].on).toBe(true);
    expect(view.dirgeView(bb({ nivs: null }, { nivs_harmonic: true }), 0, 0).steps[4].on).toBe(true);
    expect(view.dirgeView(bb({ nivs: null }, { nivs_harmonic: false }), 0, 0).steps[4].on).toBe(false);
  });

  it('Selo`s needs 2:00 left (it lasts 2:30 at most); short of that the step is amber', () => {
    expect(view.DIRGE_SELO_MIN_SECS).toBe(120);
    const low = view.dirgeView(bb({ accelerating_chorus: { observed: true, remaining_secs: 119 } }), 0, 0);
    expect(low.steps[1]).toMatchObject({ on: false, warn: true });
    expect(low.open).toBe(false);
  });

  it('the key turns on Puretone, and the board stays out as the songs fade mid-nuke', () => {
    const up = bb({ amplification: null, harmonize: null, accelerating_chorus: null },
      { guardian: false, puretone: { active: true, remaining_secs: 236 } });
    expect(view.dirgeView(up, 0, 0)).toMatchObject({ open: true, uncovered: true, turned: true, keyLabel: 'PURETONE 3:56' });
  });

  it('the Disc key: up when Puretone is ready, down with the time left, lit while it runs', () => {
    expect(view.dirgeView(bb(), 0, 0).disc).toEqual({ cls: 'up', text: 'DISC ▲ UP' });
    expect(view.dirgeView(bb({}, { puretone: { active: false, ready: false, ready_in_secs: 125 } }), 0, 0).disc)
      .toEqual({ cls: 'down', text: 'DISC ▼ 2:05' });
    expect(view.dirgeView(bb({}, { puretone: { active: true, remaining_secs: 61 } }), 0, 0).disc)
      .toEqual({ cls: 'on', text: 'DISC ● 1:01' });
  });
});

describe('overlay: one button per Dirge', () => {
  it('full mana at 4,000 max is five buttons, all lit; spent mana darkens from the top', () => {
    expect(view.dirgeView(bb(), 0, 0)).toMatchObject({ total: 5, count: 5 });
    expect(view.dirgeView(bb({}, { mana_cur: 1700 }), 0, 0)).toMatchObject({ total: 5, count: 2 });
    expect(view.dirgeView(bb({}, { mana_cur: 799 }), 0, 0)).toMatchObject({ total: 5, count: 0 });
  });

  it('no max known: as many buttons as current mana holds; never more than twelve', () => {
    expect(view.dirgeView(bb({}, { mana_max: null, mana_cur: 2500 }), 0, 0)).toMatchObject({ total: 3, count: 3 });
    expect(view.dirgeView(bb({}, { mana_max: 20000, mana_cur: 20000 }), 0, 0).total).toBe(12);
    expect(view.dirgeView(bb({}, { mana_max: null, mana_cur: null }), 0, 0)).toMatchObject({ total: null, count: null });
  });

  it('the Dirge being sung is the top lit button, and its ring fills over the 3 s sing', () => {
    const v = view.dirgeView(bb({}, { mana_cur: 2400 }), 11500, 10000);
    expect(v).toMatchObject({ count: 3, firingButton: 3, sweep: 0.5 });
    expect(view.dirgeView(bb({}, { mana_cur: 2400 }), 13000, 10000).firingButton).toBe(null);
    expect(view.dirgeView(bb({}, { mana_cur: 2400 }), 0, 0).firingButton).toBe(null);
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
  it('the count sits by the switch; the Disc key, the bank and the label are on the board', () => {
    const js = stripJs(sliceBlock(melody, '// dirge-board:js:start', '// dirge-board:js:end'));
    expect(js).toContain("top.textContent = v.count == null ? '' : '×' + v.count;");
    expect(melody).toContain('<b id="dirge-top"></b>DIRGE <i></i></button>');
    for (const id of ['id="dirge-disc"', 'id="dirge-btns"', 'id="dirge-key"', 'class="cover"']) expect(melody).toContain(id);
    expect(melody).toContain('<span class="dtape">Dirge Team 6 · Tactical Nuke</span>');
  });
  it('the label between casts no longer reads an undefined name (it stopped every repaint)', () => {
    const def = s.indexOf('var curKind  = (curEntry && curEntry.kind) || st.kind');
    expect(def).toBeGreaterThan(-1);
    expect(def).toBeLessThan(s.indexOf("(curKind === 'spell'"));
  });
});
