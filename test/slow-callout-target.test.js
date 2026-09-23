// The built-in slow callouts name the mob they are about — and its spawn id
// when a watched client's Zeal target proves it. A member, 2026-09-23, reading
// Recent Fires: "we should say the target these are based around, name of mob
// and spawnid" — the rows said "🐌 Slowed — Turgur's Insects" with no mob.
//
// Runs the real functions sliced from the agent, with a stubbed Zeal state.
// Names in the fixtures are invented or taken from the game's own mob names.
//
// Run: npx vitest run test/slow-callout-target.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
function build(zeal) {
  // eslint-disable-next-line no-new-func
  return new Function('ZEAL', `
    const _zealState = ZEAL;
    const pushed = [];
    function _pushOverlay(o) { pushed.push(o); }
    ${sliceBlock(src, 'function _normMobNameAgent(n) {', '\n}')}
    ${sliceBlock(src, 'function _slowShortName(name) {', '\n}')}
    ${sliceBlock(src, 'function _slowCalloutMob(display, targetLower) {', '\n}')}
    ${sliceBlock(src, 'function _announceSlowLand(best, mob) {', '\n}')}
    ${sliceBlock(src, 'function _announceSlowDrop(name, mob) {', '\n}')}
    return { _slowCalloutMob, _announceSlowLand, _announceSlowDrop, pushed };
  `)(zeal);
}
const now = Date.now();
const on = (target_name, target_id, age = 1000) => ({ target_name, target_id, updatedAt: now - age });

describe('_slowCalloutMob — the id only when Zeal proves it', () => {
  it('one watched client targeting the mob → name and id', () => {
    const h = build({ Aldenmar: on('A Plagued Soriz', 4745) });
    expect(h._slowCalloutMob('A Plagued Soriz', 'a plagued soriz')).toBe('A Plagued Soriz #4745');
  });
  it('two clients agreeing on the id → the id', () => {
    const h = build({ Aldenmar: on('A Plagued Soriz', 4745), Brackwyn: on('A Plagued Soriz', 4745) });
    expect(h._slowCalloutMob('A Plagued Soriz', 'a plagued soriz')).toBe('A Plagued Soriz #4745');
  });
  it('two clients on DIFFERENT ids of one name → no id; never guess', () => {
    const h = build({ Aldenmar: on('A Plagued Soriz', 4745), Brackwyn: on('A Plagued Soriz', 4746) });
    expect(h._slowCalloutMob('A Plagued Soriz', 'a plagued soriz')).toBe('A Plagued Soriz');
  });
  it('0 is "no target", not spawn zero', () => {
    const h = build({ Aldenmar: on('A Plagued Soriz', 0) });
    expect(h._slowCalloutMob('A Plagued Soriz', 'a plagued soriz')).toBe('A Plagued Soriz');
  });
  it('a client targeting something else, or stale, proves nothing', () => {
    const h = build({ Aldenmar: on('A Soriz Slave', 99), Brackwyn: on('A Plagued Soriz', 4745, 120_000) });
    expect(h._slowCalloutMob('A Plagued Soriz', 'a plagued soriz')).toBe('A Plagued Soriz');
  });
  it('an instanced Zeal name still matches the log\'s spelling', () => {
    const h = build({ Aldenmar: on('#Diabo_Xi_Va_Temariel', 12) });
    expect(h._slowCalloutMob('Diabo Xi Va Temariel', 'diabo xi va temariel')).toBe('Diabo Xi Va Temariel #12');
  });
  it('no display name → falls back to the key', () => {
    const h = build({});
    expect(h._slowCalloutMob(null, 'a plagued soriz')).toBe('a plagued soriz');
  });
});

describe('the callouts carry the mob; speech stays short', () => {
  it('Slow landed', () => {
    const h = build({});
    h._announceSlowLand({ name: "Turgur's Insects", magnitude: 75, caster: 'Nyssara' }, 'A Plagued Soriz #4745');
    expect(h.pushed[0].text).toBe("🐌 Slowed A Plagued Soriz #4745 — Turgur's Insects 75% · Nyssara");
    expect(h.pushed[0].tts).not.toMatch(/Soriz|4745/);
  });
  it('Slow dropped', () => {
    const h = build({});
    h._announceSlowDrop("Turgur's Insects", 'A Plagued Soriz #4745');
    expect(h.pushed[0].text).toMatch(/^🐌 Slow dropped on A Plagued Soriz #4745 — reslow \(/);
    expect(h.pushed[0].tts).toBe('Slow dropped. Reslow.');
  });
});

describe('the fading and drop paths use the landing\'s display name', () => {
  const clean = stripJs(src);
  it('the landing stores it, the tick keeps it, both callouts read it', () => {
    expect(clean).toContain('_slowCalloutState.set(targetLower, { name: best.name, magnitude: best.magnitude, display });');
    expect(clean).toContain('name: best.name, magnitude: best.magnitude, display: prev.display || null,');
    expect(clean).toContain('const mob = _slowCalloutMob(prev.display, targetLower);');
    expect(clean).toContain('_announceSlowDrop(prev.name, _slowCalloutMob(prev.display, targetLower))');
  });
});
