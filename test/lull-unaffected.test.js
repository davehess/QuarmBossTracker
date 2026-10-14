// test/lull-unaffected.test.js — "Your target looks unaffected." after a lull cast.
//
// The guild lead, 2026-10-09, from an in-game screenshot: Pacify cast on a level-58
// mob that is NOT ability-31 immune printed "Your target looks unaffected." in red
// (twice) while Target Info kept a Pacify bar "56/60 · 5:33" — the phantom timer
// CLAUDE.md's Harmony section predicted. The line is a self line with no target
// and no spell name, so it is attributed to the newest own cast, and only when
// that cast is a lull-family spell and the line is inside its window.
//
// Behaviour, not text: the real noteSelfCast / noteLullUnaffected / lullVerdictFor
// from the agent and the real lullChip from mobinfo.html, collaborators stubbed.
//
// Run: npx vitest run test/lull-unaffected.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');

// ⚠ End anchors are the section comments that OPEN the next block, never a line of
// the code under test (a slice closed on its own body turns every mutation into
// "suite failed to load", which reads like a kill and proves nothing).
function loadAgent() {
  const lull = sliceBlock(src, 'const _pendingPacify = new Map();', '\n// ── Self-cast capture ');
  const selfCast = sliceBlock(src, 'function noteSelfCast(line, character) {', '\n// Cross-client casting relay:');
  const pacifySet = sliceBlock(src, 'const PACIFY_SPELLS = new Set([', '\n// ── EQ class-title → base class ');
  const harness = `
    const _recentSelfCast = new Map();
    const SELF_CAST_WINDOW_MS = 12000;
    const _CAST_BEGIN_RX = ${String(/\]\s+You begin (?:casting|singing)\s+(.+?)\.\s*$/i)};
    const CHARM_SPELLS = new Map();
    const _buffLandingsByTarget = new Map();
    const whoData = new Map();
    const buffCastBuffer = [];
    const _zealState = { Aldenmar: { target_name: 'a storm gruezok', target_id: 210017, zone: 71 } };
    function _zealTargetForChar(){ return _zealState.Aldenmar.target_name; }
    function _provableTargetId(){ return null; }
    function _assumedCasterLevel(){ return 60; }
    function _durTicksForLevel(f, cap){ return cap; }
    let _spellByNameLower = new Map([
      ['pacify',  { id: 45,  name: 'Pacify',  cast_ms: 2500, dur: 60, durf: 8, good: 1 }],
      ['harmony', { id: 250, name: 'Harmony', cast_ms: 4500, dur: 20, durf: 2, good: 1 }],
    ]);
    const _mobInfoByName = new Map();
    function _normMobNameAgent(n){
      return String(n || '').trim().toLowerCase().replace(/'s\\s+corpse$/, '').replace(/[\\s\\u0060'\\u2019]+/g, '_').replace(/^#/, '');
    }
    function _mobCaseKey(n){
      const s = String(n || '').trim().replace(/'s\\s+corpse$/i, '').replace(/[\\s\\u0060'\\u2019]+/g, '_').replace(/^#/, '');
      return s.charAt(0).toLowerCase() + s.slice(1);
    }
    function _mobInfoCacheKey(name, zoneId){ return _normMobNameAgent(name) + '|' + (zoneId != null ? zoneId : '*') + '|' + _mobCaseKey(name); }
    function parseEqTimestamp(line){ const m=String(line).match(/^\\[(.+?)\\]/); return m ? new Date(m[1] + ' UTC') : null; }
    function _noteDiCast(){}
    ${pacifySet}
    ${lull}
    ${selfCast}
    function __setTarget(v){ _zealState.Aldenmar.target_name = v; }
    function __cacheMob(name, specials){ _mobInfoByName.set(_normMobNameAgent(name) + '|71|x', { at: Date.now(), mob: { specials } }); }
  `;
  return evalBlock(harness, [
    'noteSelfCast', 'noteLullUnaffected', 'lullVerdictFor', '_lullUnaffected',
    '_buffLandingsByTarget', 'buffCastBuffer', '_pendingPacify', '__setTarget', '__cacheMob',
  ]);
}

const T0 = Date.parse('Fri Oct 09 13:42:49 2026 UTC');
const stamp = (ms) => '[' + new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 $4') + '] ';
const CAST = (n, ms) => stamp(ms) + 'You begin casting ' + n + '.';
const UNAFF = (ms) => stamp(ms) + 'Your target looks unaffected.';

// The phantom row Pacify's own "looks less aggressive." landing leaves on the target.
function seedPacifyRow(h, landedAt, extra) {
  const mp = new Map([['pacify', { name: 'Pacify', dur_ticks: 70, landed_at: landedAt, target_id: null, ...(extra || {}) }]]);
  h._buffLandingsByTarget.set('a storm gruezok', mp);
  return mp;
}

describe('the line after a lull-family cast', () => {
  it('drops the phantom Pacify timer and marks the mob unaffected', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    seedPacifyRow(h, T0 + 2600);
    expect(h.noteLullUnaffected(UNAFF(T0 + 3000), 'Aldenmar')).toBe(true);
    expect(h._buffLandingsByTarget.has('a storm gruezok'), 'no phantom bar left').toBe(false);
    const v = h.lullVerdictFor('a storm gruezok', 71);
    expect(v).toMatchObject({ verdict: 'unaffected', spell: 'Pacify', caster_level: 60, at_ms: T0 + 3000 });
  });

  it('handles the line printing twice (the screenshot) without error or a second mark', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    seedPacifyRow(h, T0 + 2600);
    h.noteLullUnaffected(UNAFF(T0 + 3000), 'Aldenmar');
    h.noteLullUnaffected(UNAFF(T0 + 3000), 'Aldenmar');
    expect(h._lullUnaffected.size).toBe(1);
    expect(h._buffLandingsByTarget.size).toBe(0);
  });

  it('takes back the not-yet-uploaded cross-client copy too, and only this caster\'s', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    seedPacifyRow(h, T0 + 2600);
    h.buffCastBuffer.push({ target: 'a storm gruezok', spell_name: 'Pacify', observer: 'Aldenmar' });
    h.buffCastBuffer.push({ target: 'a storm gruezok', spell_name: 'Pacify', observer: 'Brackwyn' });
    h.noteLullUnaffected(UNAFF(T0 + 3000), 'Aldenmar');
    expect(h.buffCastBuffer.map(b => b.observer)).toEqual(['Brackwyn']);
  });

  it('leaves an OLDER separate landing of the same spell alone', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    seedPacifyRow(h, T0 - 60_000);
    h.noteLullUnaffected(UNAFF(T0 + 3000), 'Aldenmar');
    expect(h._buffLandingsByTarget.get('a storm gruezok').has('pacify')).toBe(true);
    expect(h.lullVerdictFor('a storm gruezok', 71)).toMatchObject({ verdict: 'unaffected' });
  });

  it('attributes a slow lull inside cast time + 4 s (Harmony, 4.5 s cast)', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Harmony', T0), 'Aldenmar');          // the silent lulls are synthesized at cast begin
    expect(h._buffLandingsByTarget.get('a storm gruezok').has('harmony')).toBe(true);
    expect(h.noteLullUnaffected(UNAFF(T0 + 8000), 'Aldenmar')).toBe(true);
    expect(h._buffLandingsByTarget.has('a storm gruezok'), 'synthesized row withdrawn').toBe(false);
    expect(h.buffCastBuffer, 'and its mirror').toEqual([]);
  });
});

describe('the line that must change nothing', () => {
  it('after a NON-lull cast', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Pacify', T0 - 20_000), 'Aldenmar');
    h.noteSelfCast(CAST('Lightning Bolt', T0), 'Aldenmar');     // newest own cast is not a lull
    seedPacifyRow(h, T0 - 19_000);
    expect(h.noteLullUnaffected(UNAFF(T0 + 2000), 'Aldenmar')).toBe(false);
    expect(h._buffLandingsByTarget.get('a storm gruezok').has('pacify')).toBe(true);
    expect(h.lullVerdictFor('a storm gruezok', 71)).toBe(null);
  });

  it('10 s after a lull cast', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    seedPacifyRow(h, T0 + 2600);
    expect(h.noteLullUnaffected(UNAFF(T0 + 10_000), 'Aldenmar')).toBe(false);
    expect(h._buffLandingsByTarget.get('a storm gruezok').has('pacify')).toBe(true);
    expect(h.lullVerdictFor('a storm gruezok', 71)).toBe(null);
  });

  it('with no own cast at all, and for lines that are not this line', () => {
    const h = loadAgent();
    expect(h.noteLullUnaffected(UNAFF(T0), 'Aldenmar')).toBe(false);
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    expect(h.noteLullUnaffected(stamp(T0 + 1000) + 'Your target is unaffected by that.', 'Aldenmar')).toBe(false);
    expect(h.noteLullUnaffected(stamp(T0 + 1000) + 'Brackwyn says, \'Your target looks unaffected.\'', 'Aldenmar')).toBe(false);
    expect(h._lullUnaffected.size).toBe(0);
  });
});

describe('the verdict handed to Target Info', () => {
  it('ability 31 reads immune, and a later unaffected line does not downgrade it', () => {
    const h = loadAgent();
    h.__cacheMob('a storm gruezok', ['Immune Pacify']);
    expect(h.lullVerdictFor('a storm gruezok', 71)).toEqual({ verdict: 'immune' });
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    h.noteLullUnaffected(UNAFF(T0 + 3000), 'Aldenmar');
    expect(h.lullVerdictFor('a storm gruezok', 71)).toEqual({ verdict: 'immune' });
  });

  it('a mob with other abilities and no message yet is unknown (null), not an all-clear', () => {
    const h = loadAgent();
    h.__cacheMob('a storm gruezok', ['Rampage']);
    expect(h.lullVerdictFor('a storm gruezok', 71)).toBe(null);
  });

  it('is scoped to the zone bucket like the Mob Info cache', () => {
    const h = loadAgent();
    h.noteSelfCast(CAST('Pacify', T0), 'Aldenmar');
    h.noteLullUnaffected(UNAFF(T0 + 3000), 'Aldenmar');
    expect(h.lullVerdictFor('a storm gruezok', 71)).toMatchObject({ verdict: 'unaffected' });
    expect(h.lullVerdictFor('a storm gruezok', 99)).toBe(null);
  });
});

describe('the chip', () => {
  const { lullChip } = evalBlock(
    `function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }\n`
    + sliceBlock(html, '  function lullChip(lull){', '\n  // ── DOM handles + tab state '),
    ['lullChip'],
  );

  it('shows an amber "Pacify: unaffected" chip with the spell and the advice in the tooltip', () => {
    const out = lullChip({ verdict: 'unaffected', spell: 'Pacify', caster_level: 60, at_ms: T0 });
    expect(out).toContain('Pacify: unaffected');
    expect(out).toContain('chip lullno');
    expect(out).toContain('Your Pacify (cast at level 60) did nothing on this mob');
    expect(out).toContain('Your target looks unaffected.');
    expect(out).toContain('Try a stronger lull.');
  });

  it('is byte-stable across polls and keeps the clock out of the visible text', () => {
    const v = { verdict: 'unaffected', spell: 'Pacify', caster_level: 60, at_ms: T0 };
    expect(lullChip({ ...v })).toBe(lullChip({ ...v }));
    expect(lullChip(v).replace(/title="[^"]*"/, '')).not.toMatch(/\d\d:\d\d/);
  });

  it('draws nothing for immune (the Immune Pacify ability chip already says it), unknown, or no data', () => {
    expect(lullChip({ verdict: 'immune' })).toBe('');
    expect(lullChip(null)).toBe('');
    expect(lullChip(undefined)).toBe('');
  });
});

// The behaviour above proves each piece is right, not that anything calls it. Comments
// are stripped first: this file's own prose names these calls.
describe('and it is actually wired in', () => {
  const agent = stripJs(src);
  const page = stripJs(html);
  it('feeds every own log line to noteLullUnaffected', () => {
    expect(agent).toMatch(/noteLullUnaffected\(line, b\.character\);/);
  });
  it('puts the verdict on the Target Info data', () => {
    expect(agent).toMatch(/target_lull:\s+lullVerdictFor\(st\.target_name, myZoneId\)/);
  });
  it('draws the chip in the Stats chip row', () => {
    expect(page).toMatch(/sightChips\(mob\) \+ lullChip\(mi\.target_lull\)/);
  });
});
