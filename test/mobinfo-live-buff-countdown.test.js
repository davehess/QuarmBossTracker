// test/mobinfo-live-buff-countdown.test.js — Target Info's live buff bars count down.
//
// The guild lead, 2026-10-08, on a guildmate's Target Info card (every buff bar full green): "This should
// record how long it was to start and not just show all green. it should count down like everything
// else". Live Zeal buffs carry the time left but not the original duration, so the overlay remembers
// the longest time it has seen on each buff and draws the bar against it. Runs the overlay's real
// buff-row block with stubbed helpers.
//
// Run: npx vitest run test/mobinfo-live-buff-countdown.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const BLOCK = sliceBlock(html, '  function _tbuffRow(b, isPacify){', '  // Cross-client "Casting" section');

function load() {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtSecs = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  return new Function('esc', 'fmtSecs', BLOCK + '\nreturn { renderTargetBuffs };')(esc, fmtSecs);
}
// Width of the named buff's bar in the rendered HTML.
const widthOf = (out, name) => {
  const at = out.indexOf('>' + name + '<');
  expect(at, name).toBeGreaterThan(-1);
  return Number(out.slice(at).match(/width:(\d+)%/)[1]);
};
const mi = (target, buffs) => ({ target_name: target, target_is_pc: true, target_buffs: buffs });

describe('live buff bars on Target Info', () => {
  it('start full, then shrink against the time first seen', () => {
    const { renderTargetBuffs } = load();
    expect(widthOf(renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 1200 }])), 'Celerity')).toBe(100);
    expect(widthOf(renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 600 }])), 'Celerity')).toBe(50);
  });

  it('a debuff counts down the same way', () => {
    const { renderTargetBuffs } = load();
    renderTargetBuffs(mi('Aldenmar', [{ name: 'Malo', good: 0, remaining_secs: 400 }]));
    expect(widthOf(renderTargetBuffs(mi('Aldenmar', [{ name: 'Malo', good: 0, remaining_secs: 100 }])), 'Malo')).toBe(25);
  });

  it('a refresh raises the remembered length, so the bar is full again', () => {
    const { renderTargetBuffs } = load();
    renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 1200 }]));
    renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 300 }]));
    expect(widthOf(renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 1500 }])), 'Celerity')).toBe(100);
  });

  it('a buff that leaves the list is forgotten, so a later shorter cast gets its own full bar', () => {
    const { renderTargetBuffs } = load();
    renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 1200 }]));
    renderTargetBuffs(mi('Aldenmar', [{ name: 'Spikecoat', good: 1, remaining_secs: 900 }]));
    expect(widthOf(renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 300 }])), 'Celerity')).toBe(100);
  });

  it('each target keeps its own lengths', () => {
    const { renderTargetBuffs } = load();
    renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 1200 }]));
    renderTargetBuffs(mi('Brackwyn', [{ name: 'Celerity', good: 1, remaining_secs: 300 }]));
    expect(widthOf(renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 600 }])), 'Celerity')).toBe(50);
    expect(widthOf(renderTargetBuffs(mi('Brackwyn', [{ name: 'Celerity', good: 1, remaining_secs: 150 }])), 'Celerity')).toBe(50);
  });

  it('hovering the time left says how long it lasts, how much has gone and who cast it', () => {
    const { renderTargetBuffs } = load();
    renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 1200 }]));
    const out = renderTargetBuffs(mi('Aldenmar', [{ name: 'Celerity', good: 1, remaining_secs: 900, caster: 'Brackwyn' }]));
    expect(out).toContain('class="bt" title="Lasts 20:00 (as first seen by Mimic) · 5:00 gone · cast by Brackwyn"');
    const known = renderTargetBuffs(mi('Aldenmar', [{ name: 'Tashania', good: 0, remaining_secs: 30, total_secs: 120 }]));
    expect(known).toContain('class="bt" title="Lasts 2:00 · 1:30 gone · caster unknown (only Mimic users’ casts are named)"');
  });

  it('a buff that carries its real duration still uses it', () => {
    const { renderTargetBuffs } = load();
    expect(widthOf(renderTargetBuffs(mi('Aldenmar', [{ name: 'Tashania', good: 0, remaining_secs: 30, total_secs: 120 }])), 'Tashania')).toBe(25);
  });
});
