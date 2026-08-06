// Rampage invulnerability mark — three sources, and the one that needs nothing.
//
// Uilnayar 2026-08-05, mid-raid: "we didn't see Syko's DA and we wasted heals
// on him as he was Rampage", and separately "we need to include Harmshield into
// the Rampage DA mark".
//
// Why Syko was invisible: BOTH existing sources need the tank to have set
// something up. `_findDA` reads the target's uploaded BUFF list (needs Mimic
// uploading live-state — Syko was installing Zeal that night), and
// `_daBroadcastForName` reads a /rsay announce macro (his raid chat has none).
// Neither could ever have fired.
//
// Catalog facts (eqemu_spells, read not guessed):
//   Harmshield        id  199 · buffduration 3 (=18s) · recast 600000ms (10m)
//                     · fades "Your invulnerability fades."   ← same as DA's
//   Divine Aura       id  207 · buffduration 3 (=18s) · recast 900000ms
// Harmshield is a TRUE melee invuln, which is exactly what a rampage is.
//
// Run: npx vitest run test/rampage-invuln.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)),
  '..', 'packages', 'wolfpack-logsync', 'index.js');
const src = fs.readFileSync(AGENT, 'utf8');
function sliceBlock(s, start, end) {
  const i = s.indexOf(start);
  if (i < 0) throw new Error(`slice start not found: ${start}`);
  const j = s.indexOf(end, i);
  if (j < 0) throw new Error(`slice end not found: ${end}`);
  return s.slice(i, j + end.length);
}

function harness() {
  const blocks = [
    sliceBlock(src, 'const _PROT_KINDS = [', "const _PROT_INVULN_KINDS = ['DA', 'Harmshield'];"),
    sliceBlock(src, 'function _parseProtSeconds(text) {', '  return null;\n}'),
    sliceBlock(src, 'const _PROT_ACTIVE_SECS   =', '\nconst _daBroadcasts = new Map();'),
    sliceBlock(src, 'const _INVULN_OBSERVED_TTL_MS', '  return { name: \'Invuln\', seconds: null, critical: false, observed: true };\n}'),
    sliceBlock(src, 'function _recordProt(key, name, kind, atMs, up, secs) {', '\n}'),
    sliceBlock(src, 'function trackDaBroadcastLine(line, character) {', '\n}'),
    sliceBlock(src, 'function _daBroadcastForName(name, greenSecs) {', '  return best;\n}'),
  ];
  // The REAL speaker regex, sliced too — a paraphrase here would let the test
  // pass while the shipped matcher rejected the same line.
  const prelude = sliceBlock(src, 'const _CH_SPEAKER_RX = ', '\n') + `
    const DA_BROADCAST_TTL_MS = 30000;
    function parseEqTimestamp() { return new Date(); }
  `;
  // eslint-disable-next-line no-new-func
  return new Function(prelude + blocks.join('\n')
    + '\nreturn { _PROT_KINDS, _PROT_INVULN_KINDS, _PROT_ACTIVE_SECS, _PROT_COOLDOWN_SECS,'
    + ' _daBroadcasts, trackDaBroadcastLine, _daBroadcastForName,'
    + ' noteInvulnObserved, _invulnObservedForName, _invulnObserved };')();
}

const TS = () => `[Wed Aug 05 21:10:01 2026]`;

describe('Harmshield counts as a rampage invuln', () => {
  it('is a recognised protective KIND', () => {
    const h = harness();
    expect(h._PROT_KINDS.map(k => k.kind)).toContain('Harmshield');
  });

  it('lights the rampage mark, which only true invulns may do', () => {
    const h = harness();
    expect(h._PROT_INVULN_KINDS).toEqual(['DA', 'Harmshield']);
    expect(h._PROT_INVULN_KINDS, 'Defensive mitigates, it does not make you immune').not.toContain('Defensive');
    expect(h._PROT_INVULN_KINDS).not.toContain('Weapon Shield');
  });

  it('an announce is captured and answers for that tank', () => {
    const h = harness();
    h.trackDaBroadcastLine(`${TS()} Syko tells the raid, '>> Harmshield up << 18 secs'`, 'Me');
    const hit = h._daBroadcastForName('Syko', 5);
    expect(hit, 'a Harmshield announce must reach the rampage bar').toBeTruthy();
    expect(hit.seconds).toBeGreaterThan(10);
  });

  it('the cheap pre-filter does not swallow it — "Harmshield" contains no "DA"', () => {
    // The bug: the fast path bailed unless the line held 'DA' or matched
    // defensive/weapon shield/divine aura, so Harmshield never got as far as
    // the kind list.
    expect('Harmshield'.indexOf('DA')).toBe(-1);
    const h = harness();
    h.trackDaBroadcastLine(`${TS()} Syko tells the raid, 'HARMSHIELD 18s'`, 'Me');
    expect(h._daBroadcastForName('Syko', 5)).toBeTruthy();
  });

  it('carries its real 18s window and 10m recast from the catalog', () => {
    const h = harness();
    expect(h._PROT_ACTIVE_SECS.Harmshield).toBe(18);
    expect(h._PROT_COOLDOWN_SECS.Harmshield, 'eqemu_spells 199 recast_time 600000ms').toBe(600);
    expect(h._PROT_COOLDOWN_SECS.DA, 'DA is proccable off clickies — its spell recast says nothing').toBeUndefined();
  });

  it('when two invulns are somehow both up, the LONGER one is reported', () => {
    const h = harness();
    h.trackDaBroadcastLine(`${TS()} Syko tells the raid, '>> DA up << 4 secs'`, 'Me');
    h.trackDaBroadcastLine(`${TS()} Syko tells the raid, 'Harmshield 18s'`, 'Me');
    const hit = h._daBroadcastForName('Syko', 5);
    expect(hit.seconds).toBeGreaterThan(10);
    expect(hit.critical, 'not critical — there is plenty of immunity left').toBe(false);
  });

  it('Defensive still does NOT light the rampage mark', () => {
    const h = harness();
    h.trackDaBroadcastLine(`${TS()} Abrahms tells the raid, 'Defensive is activated'`, 'Me');
    expect(h._daBroadcastForName('Abrahms', 5)).toBeNull();
  });
});

describe('invulnerability observed in the combat log — the Syko case', () => {
  it('a tank running NOTHING still lights the mark', () => {
    // No uploaded buffs, no announce macro. Only another raider's log line.
    const h = harness();
    h.noteInvulnObserved('Syko', Date.now());
    const hit = h._invulnObservedForName('Syko');
    expect(hit).toBeTruthy();
    expect(hit.observed).toBe(true);
  });

  it('reports NO countdown — the line says "immune now", not when it started', () => {
    const h = harness();
    h.noteInvulnObserved('Syko', Date.now());
    expect(h._invulnObservedForName('Syko').seconds).toBeNull();
  });

  it('goes dark quickly once the lines stop — the risk is asymmetric', () => {
    // Claiming immunity that has lapsed can kill a tank; claiming none merely
    // costs a heal. So this must expire fast, not linger.
    const h = harness();
    h.noteInvulnObserved('Syko', Date.now() - 4001);
    expect(h._invulnObservedForName('Syko')).toBeNull();
    h.noteInvulnObserved('Syko', Date.now() - 1000);
    expect(h._invulnObservedForName('Syko')).toBeTruthy();
  });

  it('is per-defender — one tank\'s invuln never covers another', () => {
    const h = harness();
    h.noteInvulnObserved('Syko', Date.now());
    expect(h._invulnObservedForName('Abrahms')).toBeNull();
  });

  it('an unknown name is null, not a crash', () => {
    const h = harness();
    expect(h._invulnObservedForName(null)).toBeNull();
    expect(h._invulnObservedForName('Nobody')).toBeNull();
  });
});

describe('wiring', () => {
  it('the INVULNERABLE avoid event feeds the observer store', () => {
    expect(src).toMatch(/if \(k === 'invulnerable'\) noteInvulnObserved\(def,/);
  });

  it('the rampage bar tries all three sources, best-known first', () => {
    expect(src).toMatch(/da: _findDA\(rampBuffs, 5\) \|\| _daBroadcastForName\(r\.target, 5\) \|\| _invulnObservedForName\(r\.target\)/);
  });

  it('the log classifier still recognises the INVULNERABLE line at all', () => {
    expect(src).toMatch(/if \(\/\\binvulnerable\/\.test\(r\)\)\s+return 'invulnerable';/);
  });
});
