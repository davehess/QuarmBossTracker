// test/me-bard-counts.test.js — FB-56: a bard's HUD mana slot counts instead of reading a percentage.
//
// A member, 2026-10-07: "Bard songs don't take up mana typically - only display how many Faded Memories
// they have left, or Dirges, or charms." The guild lead picked option A the same day: the mana arc and bar
// keep filling with mana %, but the LABEL reads counts — DIRGE 4 · FM 5 · CHARM 12 — and a bard with
// nothing to count (no Dirge, under 60, no charm song) reads MANA nn% as before.
//
// Runs the agent's REAL _serializeMeState (for the numbers) and the overlay's REAL render functions (for
// the labels). Names are invented. Run: npx vitest run test/me-bard-counts.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripCss } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const meHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'me.html'));

const meBlock = sliceBlock(agent, '// ── Me overlay (the guild lead, 2026-09-24)', '\nfunction _serializeTankState() {')
  .replace(/\nfunction _serializeTankState\(\) \{$/, '');
const parseTs = agent.match(/const TS_RX = [^\n]+/)[0] + '\n'
  + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');
const failRx = agent.match(/const _CAST_FAIL_RX = [^\n]+/)[0];
const noManaRx = agent.match(/const _NO_MANA_CLASSES = [^\n]+/)[0];
const pipeCandidate = sliceBlock(agent, 'function _pipeCandidateOf(st, key) {', '\n}');
const mobKey = sliceBlock(agent, 'function _normMobName(v) {', '\n}') + '\n' + sliceBlock(agent, 'function _provableTargetId(observer, targetName) {', '\n}');

// The real costs from eqemu_spells: the Dirge 800, the charm song 60.
const CATALOG = [
  { name: 'Denon`s Desperate Dirge', mana: 800, cast_ms: 3000 },
  { name: "Solon's Bewitching Bravura", mana: 60, cast_ms: 3000 },
  { name: 'Complete Healing', mana: 400, cast_ms: 10000 },
  { name: 'Mesmerize', mana: 20, cast_ms: 2500, mez: 1 },
];

function load({ zeal = {} } = {}) {
  const pre = `
    const _spellByNameLower = new Map(${JSON.stringify(CATALOG.map(e => [e.name.toLowerCase(), e]))});
    const _zealState = ${JSON.stringify(zeal)};
    const whoData = new Map();
    const _raidClassByName = new Map();
    const CHARM_SPELLS = new Map([["solon's bewitching bravura", {}], ['solon\`s bewitching bravura', {}], ['allure', {}]]);
    const stats = { currentEncounterThreat: null };
    const _blindState = {};
    function normalizeClass(s) { return s ? String(s).trim() : s; }
    ${failRx}
    ${parseTs}
    ${noManaRx}
    ${pipeCandidate}
    ${mobKey}
    const _discReadyAt = new Map();
    const _mobInfoByName = new Map();
    const MOB_INFO_TTL_MS = 60000;
    function _mobInfoCacheKey(n, z) { return String(n).toLowerCase() + '|' + (z == null ? '' : z); }
    function fetchMobInfo() {}
    function _victimForMob() { return null; }
    function _bestSlowForTarget() { return null; }
    function _resolveHpValuesForName() { return null; }
    const DS_UNLISTED_SLACK = 30;
    function _knownDsPerHitFor() { return 0; }
    function _dsKindOf() { return null; }
    const RAMPAGE_FRESH_MS = 8000;
    function _currentRampageForDisplay() { return null; }
    function _resolveHpForName() { return null; }
    const _lastRaidPipe = null;
  `;
  // eslint-disable-next-line no-new-func
  return new Function(pre + meBlock + '\nreturn { _serializeMeState, _meBardCounts };')();
}

const labels = (o) => Object.entries(o).map(([id, value]) => ({ id: Number(id), value: String(value) }));
function zealFor(name, { cls, level = 60, mana = [3999, 4500], gems = [] } = {}) {
  const gemLabels = {};
  gems.forEach((g, i) => { gemLabels[60 + i] = g; });
  return {
    [name]: {
      updatedAt: Date.now(),
      self_hp_cur: 1469, self_hp_max: 3214, self_hp_pct: 45.7,
      self_mana_cur: mana[0], self_mana_max: mana[1],
      charInfo: labels({ 2: level, 3: cls, 26: 48, 27: 1, 71: 3, 24: 55, 25: 255, ...gemLabels }),
      gauges: [
        { slot: 2, hp_pct: 55.9, text: '' },
        { slot: 3, hp_pct: 91, text: '' },
      ],
    },
  };
}
const serialize = (name, opts) => load({ zeal: zealFor(name, opts) })._serializeMeState();

const DIRGE = 'Denon`s Desperate Dirge';
const BRAVURA = "Solon's Bewitching Bravura";

// ── the agent's numbers ──────────────────────────────────────────────────────────────────────────
describe('the agent counts what a bard spends mana on', () => {
  it('mana 3999 with the Dirge and the charm song memorized: 4 Dirges, 4 Fading Memories, 66 charms', () => {
    const s = serialize('Zarrin', { cls: 'Bard', level: 60, mana: [3999, 4500], gems: [DIRGE, BRAVURA] });
    expect(s.bard).toEqual({ dirges: 4, fm: 4, charm: 66 });   // 3999/800 · 3999/900 · 3999/60, each rounded down
  });

  it('Fading Memories is a level 60 AA: a level 59 bard gets no fm, and keeps the Dirge', () => {
    const s = serialize('Zarrin', { cls: 'Bard', level: 59, mana: [3999, 4500], gems: [DIRGE] });
    expect(s.bard.fm).toBeNull();
    expect(s.bard.dirges).toBe(4);
    expect(serialize('Zarrin', { cls: 'Bard', level: 60, mana: [3999, 4500], gems: [DIRGE] }).bard.fm).toBe(4);
  });

  it('the counts follow the mana in hand, rounding down at each cost', () => {
    const at = (cur) => serialize('Zarrin', { cls: 'Bard', level: 65, mana: [cur, 4500], gems: [DIRGE] }).bard;
    expect(at(799)).toMatchObject({ dirges: 0, fm: 0 });
    expect(at(800)).toMatchObject({ dirges: 1, fm: 0 });
    expect(at(900)).toMatchObject({ dirges: 1, fm: 1 });
    expect(at(1600)).toMatchObject({ dirges: 2, fm: 1 });
    expect(at(1800)).toMatchObject({ dirges: 2, fm: 2 });
  });

  it('a non-bard gets no block', () => {
    expect(serialize('Aldenmar', { cls: 'Cleric', level: 60, gems: ['Complete Healing', DIRGE] }).bard).toBeNull();
    expect(serialize('Nyssara', { cls: 'Enchanter', level: 60 }).bard).toBeNull();
    expect(serialize('Brackwyn', { cls: 'Warrior', level: 60, mana: [null, null] }).bard).toBeNull();
  });

  it('a bard whose mana the pipe has not sent gets no block', () => {
    expect(serialize('Zarrin', { cls: 'Bard', level: 60, mana: [null, null], gems: [DIRGE] }).bard).toBeNull();
  });

  it('the Dirge counts only when it is memorized — the strip is read, not assumed', () => {
    const without = serialize('Zarrin', { cls: 'Bard', level: 60, gems: [BRAVURA, 'Mesmerize'] }).bard;
    expect(without.dirges).toBeNull();
    expect(without.fm).toBe(4);
    // Either spelling of the possessive names it: the log writes a backtick, a catalog may not.
    expect(serialize('Zarrin', { cls: 'Bard', level: 60, gems: ["Denon's Desperate Dirge"] }).bard.dirges).toBe(4);
    expect(serialize('Zarrin', { cls: 'Bard', level: 60, gems: [DIRGE] }).bard.dirges).toBe(4);
  });

  it('with no gem labels at all it cannot tell, and a level 60 bard is assumed to carry the Dirge', () => {
    expect(serialize('Zarrin', { cls: 'Bard', level: 60, gems: [] }).bard).toMatchObject({ dirges: 4, fm: 4 });
    expect(serialize('Zarrin', { cls: 'Bard', level: 59, gems: [] }).bard).toMatchObject({ dirges: null, fm: null });
  });

  it('charm is the "Charm left" number, and only when a charm song is memorized', () => {
    const on = serialize('Zarrin', { cls: 'Bard', level: 60, mana: [1000, 4500], gems: [DIRGE, BRAVURA] });
    expect(on.bard.charm).toBe(16);                                   // 1000 / 60
    expect(on.focus.find(f => f.key === 'charm')).toMatchObject({ label: 'Charm left', value: 16, sub: BRAVURA });   // the focus item is untouched
    const off = serialize('Zarrin', { cls: 'Bard', level: 60, mana: [1000, 4500], gems: [DIRGE] });
    expect(off.bard.charm).toBeNull();
    expect(off.focus.find(f => f.key === 'charm')).toBeUndefined();
  });

  it('the pure counter takes the same rules without the serializer', () => {
    const { _meBardCounts } = load();
    expect(_meBardCounts('Bard', 60, 3999, [{ name: DIRGE }], 66)).toEqual({ dirges: 4, fm: 4, charm: 66 });
    expect(_meBardCounts('Bard', null, 3999, [{ name: DIRGE }], null)).toEqual({ dirges: 4, fm: null, charm: null });
    expect(_meBardCounts('Rogue', 60, 3999, [{ name: DIRGE }], 66)).toBeNull();
  });
});

// ── the ring and the Box ────────────────────────────────────────────────────────────────────────
const script = meHtml.slice(meHtml.indexOf('<script>') + 8, meHtml.indexOf('</script>'));
const renderBlock = script.slice(script.indexOf('  // ── helpers'), script.indexOf('  var bodyEl'));
// eslint-disable-next-line no-new-func
const R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + renderBlock + '\nreturn { renderA, renderHud, hudParts, HUD_DEFAULTS, hudData };')();
const reset = () => Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {} });

const ringLabel = (h, id) => ((h.match(new RegExp('<textPath href="#' + id + '"[^>]*>([\\s\\S]*?)</textPath>')) || [])[1] || '').replace(/<[^>]+>/g, '');
const ringSize = (h, id) => +((h.match(new RegExp('<path id="' + id + '"[^>]*/><text font-size="([\\d.]+)"')) || [])[1]);
// The right arc's label sits at radius 182 over 68 degrees: that much text, at 0.6 em a character.
const ARC_ROOM = 68 * Math.PI / 180 * 182 * 0.96;

const bardSnap = (opts = {}, extra = {}) => Object.assign(serialize('Zarrin', Object.assign({ cls: 'Bard', level: 60, mana: [3999, 4500], gems: [DIRGE, BRAVURA] }, opts)), extra);
const withBard = (bard) => { const s = bardSnap(); if (bard === undefined) delete s.bard; else s.bard = bard; return s; };
const outDps = (n) => ({ combat: { live: true, secs: 30, out: { dps: n, by: {} }, in: { dps: 0, by: {} }, feed: [] } });

describe('the ring\'s mana label reads counts for a bard', () => {
  it('DIRGE 4 · FM 4 · CHARM 66, with the arc still filling with the mana %', () => {
    reset();
    R.hudParts.dps = 0; R.hudParts.focus = 0;
    const s = bardSnap();
    expect(ringLabel(R.renderHud(s), 'hrt')).toBe('DIRGE 4 · FM 4 · CHARM 66');
    expect(R.hudData(s).right.pct).toBeCloseTo(55.9, 5);               // the fill is the mana %, not a count
    // The arc IS drawn from the mana %: change it and the SVG changes though the label does not.
    const other = bardSnap({}, { mana: { cur: 3999, max: 4500, pct: 20 } });
    expect(ringLabel(R.renderHud(other), 'hrt')).toBe('DIRGE 4 · FM 4 · CHARM 66');
    expect(R.renderHud(other)).not.toBe(R.renderHud(s));
  });

  it('shows only the counts that apply, in the order Dirge, Fading Memories, charm', () => {
    reset();
    R.hudParts.dps = 0; R.hudParts.focus = 0;
    expect(ringLabel(R.renderHud(withBard({ dirges: 4, fm: 5, charm: null })), 'hrt')).toBe('DIRGE 4 · FM 5');
    expect(ringLabel(R.renderHud(withBard({ dirges: null, fm: 5, charm: null })), 'hrt')).toBe('FM 5');
    expect(ringLabel(R.renderHud(withBard({ dirges: 2, fm: null, charm: 12 })), 'hrt')).toBe('DIRGE 2 · CHARM 12');
    expect(ringLabel(R.renderHud(withBard({ dirges: 0, fm: 0, charm: null })), 'hrt')).toBe('DIRGE 0 · FM 0');   // a zero is a count
  });

  it('falls back to MANA nn% with nothing to count, or from an agent that sends no block', () => {
    reset();
    R.hudParts.dps = 0; R.hudParts.focus = 0;
    for (const b of [undefined, null, {}, { dirges: null, fm: null, charm: null }, { dirges: 'x', fm: NaN, charm: -1 }]) {
      expect(ringLabel(R.renderHud(withBard(b)), 'hrt'), JSON.stringify(b)).toBe('MANA 56%');
    }
  });

  it('only a bard gets it: another class with a block, or a class that has no mana, is unchanged', () => {
    reset();
    R.hudParts.dps = 0; R.hudParts.focus = 0;
    const cleric = Object.assign(bardSnap(), { class: 'Cleric' });
    expect(ringLabel(R.renderHud(cleric), 'hrt')).toBe('MANA 56%');
    const monk = Object.assign(bardSnap(), { class: 'Monk', no_mana: true, end: { pct: 41 } });
    expect(ringLabel(R.renderHud(monk), 'hrt')).toBe('END 41%');
    // A bard whose pool reads empty (0 of 0) takes the HUD's no-mana rule: the arc shows endurance, with no counts.
    const flat = Object.assign(bardSnap(), { mana: { cur: 0, max: 0, pct: 0 }, end: { pct: 41 } });
    expect(ringLabel(R.renderHud(flat), 'hrt')).toBe('END 41%');
  });

  it('three counts plus the damage out stay inside the arc: the label is fitted, not cut off', () => {
    reset();
    const s = bardSnap({}, outDps(12345));
    s.focus = [];                                                         // (the charm focus item is its own test below)
    const h = R.renderHud(s);
    const text = ringLabel(h, 'hrt');
    expect(text).toBe('DIRGE 4 · FM 4 · CHARM 66  · out 12.3k');
    const size = ringSize(h, 'hrt');
    expect(size).toBeLessThan(11);                                        // shrunk from the part's own 11
    expect(size).toBeGreaterThanOrEqual(11 * 0.7 - 1e-9);                 // but never past the 70% floor
    expect(text.length * 0.6 * size).toBeLessThanOrEqual(ARC_ROOM + 1e-6);
    // A short label keeps its full size.
    R.hudParts.dps = 0; R.hudParts.focus = 0;
    expect(ringSize(R.renderHud(withBard({ dirges: 4, fm: null, charm: null })), 'hrt')).toBe(11);
  });

  it('the part\'s size slider still scales the fitted label', () => {
    reset();
    R.hudParts.dps = 0; R.hudParts.focus = 0;
    const s = withBard({ dirges: 4, fm: 5, charm: null });
    R.hudParts.sizes = { right: 0.8 };
    expect(ringSize(R.renderHud(s), 'hrt')).toBeCloseTo(11 * 0.8, 5);
    reset();
  });

  it('the CHARM count is not said twice: the "Charm left" focus item stays off the ring when the label has it', () => {
    reset();
    const s = bardSnap();
    expect(s.focus.some(f => f.key === 'charm')).toBe(true);              // the agent still sends it
    expect(ringLabel(R.renderHud(s), 'hrt')).not.toContain('Charm left');
    // Without a charm count in the label the focus item is the only place left to say it.
    const noLabelCharm = Object.assign(bardSnap(), { bard: { dirges: 4, fm: 4, charm: null } });
    expect(ringLabel(R.renderHud(noLabelCharm), 'hrt')).toContain('Charm left 66');
    // And another focus item (a mez) is not swallowed.
    const mez = Object.assign(bardSnap(), { focus: [{ key: 'charm', label: 'Charm left', value: 66 }, { key: 'mez', label: 'Mez left', value: 9 }] });
    expect(ringLabel(R.renderHud(mez), 'hrt')).toContain('Mez left 9');
  });
});

describe('the Box\'s mana line reads counts for a bard', () => {
  it('the same text in the percentage column; the bar still holds cur / max and fills with mana %', () => {
    const h = R.renderA(bardSnap());
    expect(h).toContain('<div class="brow counts">');
    expect(h).toContain('<div class="pct" style="color:var(--blue)">DIRGE 4 · FM 4 · CHARM 66</div>');
    expect(h).toContain('3,999 / 4,500');
    expect(h).toContain('<i style="width:55.9%;background:var(--blue)"></i>');
    expect(h).not.toContain('var(--blue)">56%');                          // no mana % where the counts are
  });

  it('shows only the counts that apply', () => {
    expect(R.renderA(withBard({ dirges: 4, fm: 5, charm: null }))).toContain('>DIRGE 4 · FM 5</div>');
    expect(R.renderA(withBard({ dirges: null, fm: 7, charm: null }))).toContain('>FM 7</div>');
  });

  it('falls back to the percentage with nothing to count, or from an agent that sends no block', () => {
    for (const b of [undefined, null, { dirges: null, fm: null, charm: null }]) {
      const h = R.renderA(withBard(b));
      expect(h, JSON.stringify(b)).toContain('<div class="pct" style="color:var(--blue)">56%</div>');
      expect(h).not.toContain('brow counts');
    }
  });

  it('only a bard\'s row changes: a cleric with a block, and the other bars, keep their percentages', () => {
    const cleric = Object.assign(bardSnap(), { class: 'Cleric' });
    const h = R.renderA(cleric);
    expect(h).toContain('<div class="pct" style="color:var(--blue)">56%</div>');
    expect(h).not.toContain('brow counts');
    const bard = R.renderA(bardSnap());
    expect(bard).toContain('>46%</div>');                                  // the health row is still a %
    expect(bard).toContain('>91%</div>');                                  // and so is endurance
  });

  it('the percentage column grows to fit the words and does not wrap them', () => {
    const css = stripCss(meHtml);
    expect(css).toMatch(/\.brow\.counts\{grid-template-columns:minmax\(0,1fr\) auto\}/);
    expect(css).toMatch(/\.brow\.counts \.pct\{white-space:nowrap\}/);
  });
});
