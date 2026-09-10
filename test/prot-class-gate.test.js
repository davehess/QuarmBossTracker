// test/prot-class-gate.test.js — a box announcing its owner's discipline must
// not put that discipline on the box.
//
// Hitya, live 2026-09-02, with a Command Center screenshot showing a 10:10
// Defensive recharging on Currynote: "Currynote is currygoat's bard, he does
// not have defensive."
//
// The protective tracker reads raid-chat announces and credits whoever SPOKE
// the line — which is right, and is what made it work for tanks who run no
// macro at all. But Currygoat's announce went out on his bard box, so the bard
// got the Defensive.
//
// ⚠ THE ASYMMETRY DECIDES HOW FAR THIS GATE GOES. Suppressing a REAL defensive
// is the dangerous direction (healers stop seeing the tank is mitigating);
// showing a wrong one is cosmetic. So the lock covers only Defensive — a
// warrior discipline with no item source — and DELIBERATELY not Divine Aura or
// Harmshield, which have clicky sources, where "wrong class" is not proof and
// suppressing would blank a genuine invuln on the rampage bar.
//
// Run: npx vitest run test/prot-class-gate.test.js

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// ⚠ End anchor is the section comment that OPENS the next block, never a line
// of the tracked function's own body.
function load() {
  const block = sliceBlock(
    src,
    'const _PROT_CLASS_LOCK = { Defensive:',
    '\n// ── Protective snapshot for the Command Center ',
  );
  return evalBlock(
    `
    const whoData = new Map();
    const recorded = [];
    ${sliceBlock(src, 'const CLASS_TITLES = (() => {', '\n// Finishing-blow / anomalous-hit guard')}
    const _CH_SPEAKER_RX = ${String(src.match(/^const _CH_SPEAKER_RX = (\/.+\/i);$/m)[1])};
    const _PROT_KINDS = [
      { kind: 'DA',            rx: /\\bDA\\b|divine aura/i,  caseSensitiveToken: /\\bDA\\b/ },
      { kind: 'Harmshield',    rx: /harm\\s*shield/i },
      { kind: 'Weapon Shield', rx: /weapon\\s*shield/i },
      { kind: 'Defensive',     rx: /defensiv/i },
    ];
    function parseEqTimestamp(l){ const m=String(l).match(/^\\[(.+?)\\]/); return m ? new Date(m[1]+' UTC') : null; }
    function _parseProtSeconds(){ return null; }
    function _recordProt(key, name, kind, atMs, up, secs){ recorded.push({ key, name, kind, up }); }
    ${block}
    `,
    ['trackDaBroadcastLine', '_protClassAllows', 'whoData', 'recorded'],
  );
}

const RSAY = (who, txt) => `[Wed Sep 02 21:30:00 2026] ${who} tells the raid, '${txt}'`;

describe('the bug that was reported', () => {
  it('ignores a Defensive announced by a known bard', () => {
    const h = load();
    h.whoData.set('currynote', { class: 'Bard' });
    h.trackDaBroadcastLine(RSAY('Currynote', 'Defensive is activated'), 'Hitya');
    expect(h.recorded).toHaveLength(0);
  });

  it('still records it for the warrior who actually has it', () => {
    const h = load();
    h.whoData.set('currygoat', { class: 'Warrior' });
    h.trackDaBroadcastLine(RSAY('Currygoat', 'Defensive is activated'), 'Hitya');
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0].kind).toBe('Defensive');
    expect(h.recorded[0].name).toBe('Currygoat');
  });

  it('reads a level TITLE as its base class', () => {
    // /who reports "Maestro", not "Bard", for a 65 bard — and the whole gate
    // silently stops working if the title is not folded first.
    const h = load();
    h.whoData.set('currynote', { class: 'Maestro' });
    h.trackDaBroadcastLine(RSAY('Currynote', 'Defensive is activated'), 'Hitya');
    expect(h.recorded).toHaveLength(0);

    const h2 = load();
    h2.whoData.set('currygoat', { class: 'Overlord' });     // 65 warrior
    h2.trackDaBroadcastLine(RSAY('Currygoat', 'Defensive is activated'), 'Hitya');
    expect(h2.recorded).toHaveLength(1);
  });
});

describe('where it must fail open', () => {
  it('records a Defensive when the class is unknown', () => {
    // Nobody has /who'd them yet. Suppressing here would blank a real tank's
    // mitigation window, which is the one direction that can get someone killed.
    const h = load();
    h.trackDaBroadcastLine(RSAY('Someguy', 'Defensive is activated'), 'Hitya');
    expect(h.recorded).toHaveLength(1);
  });

  it('records it for an anonymous raider whose class we never learned', () => {
    const h = load();
    h.whoData.set('someguy', { class: null });
    h.trackDaBroadcastLine(RSAY('Someguy', 'Defensive is activated'), 'Hitya');
    expect(h.recorded).toHaveLength(1);
  });

  it('never gates Divine Aura or Harmshield, whatever the class', () => {
    // Both have clicky sources, so "wrong class" is not proof — and these are
    // the kinds that light the immune bar. A false suppress there is the worst
    // outcome this file has to prevent.
    const h = load();
    h.whoData.set('currynote', { class: 'Bard' });
    h.trackDaBroadcastLine(RSAY('Currynote', 'DA up 18 secs'), 'Hitya');
    h.trackDaBroadcastLine(RSAY('Currynote', 'Harmshield up'), 'Hitya');
    expect(h.recorded.map(r => r.kind).sort()).toEqual(['DA', 'Harmshield']);
  });

  it('answers the predicate three ways', () => {
    const h = load();
    expect(h._protClassAllows('Defensive', 'nobody')).toBe(true);      // unknown → open
    h.whoData.set('w', { class: 'Warrior' });
    h.whoData.set('b', { class: 'Bard' });
    expect(h._protClassAllows('Defensive', 'w')).toBe(true);
    expect(h._protClassAllows('Defensive', 'b')).toBe(false);
    expect(h._protClassAllows('DA', 'b')).toBe(true);                   // ungated kind
  });
});
