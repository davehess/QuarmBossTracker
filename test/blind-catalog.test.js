// test/blind-catalog.test.js — Blind Mode knows every blinding spell, and
// actually turns on.
//
// The guild lead, 2026-09-24: "automatically show the overlays that make sense
// if the character is blinded in game, where you lose all of the UI." Blind
// Mode existed (v1.1.8) but (1) its auto-show looked the state up by display
// name while storing it lowercase, so it never fired for a capitalised name,
// and (2) it recognised one spell's text — the catalog has thirty SPA-20
// landing texts. Runs the real noteBlindLine over a stub catalog.
//
// Run: npx vitest run test/blind-catalog.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const block = sliceBlock(agent, '// ── Blind Mode (v1.1.8)', '\n// Time-based auto-expire');
const parseTs = agent.match(/const TS_RX = [^\n]+/)[0] + '\n' + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');

// Real texts from eqemu_spells (SPA 20), plus a non-blind spell sharing one.
const CATALOG = [
  { name: 'Flash of Light', you: 'You are blinded by a flash of light.', fades: 'Your sight returns.', blind: 1, secs: 12 },
  { name: 'Mud Toss', you: 'You have mud in your eyes.', fades: 'You wipe the mud away.', blind: 1, secs: 18 },
  { name: 'Befuddle', you: 'You feel confused.', fades: 'You are no longer confused.', blind: 1, secs: 30 },
  { name: 'Confuse', you: 'You feel confused.', fades: 'You are no longer confused.' },   // not a blind
  { name: 'Manaflare', you: 'You are blinded by a manaflare.', fades: 'The manaflare subsides.', blind: 1, secs: 24 },
];

function load() {
  const pre = `
    const _spellByNameLower = new Map(${JSON.stringify(CATALOG.map(e => [e.name.toLowerCase(), e]))});
    const _secs = new Map(${JSON.stringify(CATALOG.map(e => [e.name, e.secs || null]))});
    function _catalogDurationSec(name) { return _secs.get(name) || null; }
    function _zealTargetForChar() { return null; }
    ${parseTs}
  `;
  // eslint-disable-next-line no-new-func
  return new Function(pre + block + '\nreturn { noteBlindLine, _blindState, _blindEvents };')();
}
const L = (msg) => '[Thu Sep 24 02:00:00 2026] ' + msg;

describe('the catalog\'s blinding spells', () => {
  it('a real SPA-20 landing turns Blind Mode on, for the spell\'s own duration', () => {
    const m = load();
    m.noteBlindLine(L('You are blinded by a flash of light.'), 'Aldenmar');
    expect(m._blindState.aldenmar.active).toBe(true);
    expect(m._blindState.aldenmar.expiresAt - m._blindState.aldenmar.since).toBe(12_000);
  });

  it('its fade turns it off — "Your sight returns." was never recognised before', () => {
    const m = load();
    m.noteBlindLine(L('You have mud in your eyes.'), 'Aldenmar');
    m.noteBlindLine(L('Your sight returns.'), 'Aldenmar');
    expect(m._blindState.aldenmar.active).toBe(false);
  });

  it('a text a non-blind spell also prints can neither open nor close it', () => {
    const m = load();
    m.noteBlindLine(L('You feel confused.'), 'Aldenmar');
    expect(m._blindState.aldenmar).toBeUndefined();
    m.noteBlindLine(L('You are blinded by a flash of light.'), 'Aldenmar');
    m.noteBlindLine(L('You are no longer confused.'), 'Aldenmar');
    expect(m._blindState.aldenmar.active).toBe(true);
  });

  // The manaflare text is BOTH a catalog blind and one of the hand patterns;
  // the hand pattern keeps its own source and callout, and the catalog path
  // adds nothing on top of it.
  it('the Pitted Iron Ring stays the hand pattern\'s — no second callout from the catalog', () => {
    const m = load();
    m.noteBlindLine(L('You are blinded by a manaflare.'), 'Aldenmar');
    expect(m._blindState.aldenmar.source).toBe('pitted_iron_ring');
    expect(m._blindEvents.filter(e => e.kind === 'blind_start')).toHaveLength(1);
  });

  it('an already-active blind is not announced again by a second blinding spell', () => {
    const m = load();
    m.noteBlindLine(L('You are blinded by a flash of light.'), 'Aldenmar');
    m.noteBlindLine(L('You have mud in your eyes.'), 'Aldenmar');
    expect(m._blindEvents.filter(e => e.kind === 'blind_start')).toHaveLength(1);
  });
});

describe('the auto-show can fire', () => {
  it('the active character\'s blind state is looked up lowercase, as it is stored', () => {
    const body = stripJs(agent);
    expect(body).toContain('_blindOut[String(_activeCharacter).toLowerCase()]');
    expect(body).not.toContain('_blindOut[_activeCharacter]');
  });
});
