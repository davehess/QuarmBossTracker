// test/mobinfo-factions-and-mana.test.js — the Factions tab and the estimated
// mana toggle on Target Info (the guild lead, 2026-09-22).
//
// The faction values are real and were checked against the mirror: killing
// Royal Scribe Kaavin costs Dain Frostreaver IV and Coldain 50 each and pays
// King Tormax 25. That is the whole point of the tab — it is a pre-pull
// decision, not trivia.
//
// ⚠ The mana bar is an ESTIMATE and a FLOOR: a resisted or interrupted cast
// spends mana and prints nothing, 14% of NPC-castable spells have no landing
// text at all, and we only see what our own raiders witnessed. The tests below
// pin that it is LABELLED, because an unlabelled number on a mid-raid overlay
// is the failure this repo's design rules exist to prevent.
//
// Run: npx vitest run test/mobinfo-factions-and-mana.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');

const { renderFactions } = evalBlock(
  `function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }\n`
  + sliceBlock(src, '  function renderFactions(mob){', '\n  // \u2500\u2500 Loot tab '),
  ['renderFactions'],
);

// ⚠ Ends on fmtSecs' opening line, the very next declaration — a slice that
// reached the next SECTION comment would drag ~250 unrelated lines through
// eval, and anything top-level in them would run.
const { fmtNum } = evalBlock(
  sliceBlock(src, '  function fmtK(v, unit){', '\n  // ── Durations '),
  ['fmtNum'],
);

// Straight from eqemu_npc_faction_entries via the bot's resolver.
const KAAVIN = [
  { name: 'Dain Frostreaver IV', value: -50 },
  { name: 'Coldain',             value: -50 },
  { name: 'King Tormax',         value:  25 },
];

describe('the Factions tab', () => {
  it('renders every faction the kill touches', () => {
    const h = renderFactions({ factions: KAAVIN });
    expect(h).toContain('Dain Frostreaver IV');
    expect(h).toContain('Coldain');
    expect(h).toContain('King Tormax');
  });

  it('signs the numbers so a loss cannot read as a gain', () => {
    const h = renderFactions({ factions: KAAVIN });
    expect(h).toMatch(/>-50</);
    expect(h).toMatch(/>\+25</);
  });

  it('colours a gain and a loss differently', () => {
    const h = renderFactions({ factions: KAAVIN });
    expect(h).toContain('fv up');
    expect(h).toContain('fv dn');
  });

  it('says so plainly when a mob has no faction rows', () => {
    expect(renderFactions({ factions: [] })).toMatch(/No faction change/i);
    expect(renderFactions({ factions: null })).toMatch(/No faction change/i);
  });

  // A null mob is "still loading", not "no factions" — claiming the latter
  // would be a confident wrong answer on the most common frame of all.
  it('claims nothing at all while the lookup is still in flight', () => {
    expect(renderFactions(null)).not.toMatch(/No faction change/i);
  });

  it('escapes a faction name rather than trusting the catalog', () => {
    const h = renderFactions({ factions: [{ name: '<img src=x>', value: 1 }] });
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });
});

describe('HP and mana numbers carry a tenth', () => {
  // The report: a 4,670 HP raider rendered as "5k / 5k HP · 100%" beside a
  // client window plainly reading 4670/4670. Rounding to whole thousands hid
  // 330 points — a heal's worth — and looked like a bug rather than a rounding.
  it('shows the tenth instead of rounding a raider up a whole heal', () => {
    expect(fmtNum(4670)).toBe('4.7k');
  });

  // ...but a round number must stay round. "5.0k" is decoration, not detail.
  it('drops the tenth when it is zero', () => {
    expect(fmtNum(5000)).toBe('5k');
    expect(fmtNum(12000)).toBe('12k');
  });

  it('keeps the tenth for a boss-sized pool', () => {
    expect(fmtNum(11780)).toBe('11.8k');   // The Spire Lord, real catalog HP
    expect(fmtNum(2058)).toBe('2.1k');     // and his mana
  });

  it('leaves values under a thousand exact', () => {
    expect(fmtNum(940)).toBe('940');
    expect(fmtNum(0)).toBe('0');
  });

  it('applies the same rule to millions', () => {
    expect(fmtNum(2000000)).toBe('2M');
    expect(fmtNum(2450000)).toBe('2.5M');
  });

  it('still answers for a missing number', () => {
    expect(fmtNum(null)).toBe('?');
    expect(fmtNum(undefined)).toBe('?');
  });
});

describe('the overlay wiring the checklist requires', () => {
  const code = stripJs(src);

  // ⚠ A locked overlay is click-through. Every clickable control needs the
  // hover handshake or the button silently "does nothing" — the single most
  // common class of overlay bug in this repo.
  it('gives the new tab and toggle the hover-interact handshake', () => {
    expect(code).toMatch(/\[tabStatsBtn,\s*tabLootBtn,\s*tabSpellsBtn,\s*tabFactionsBtn,\s*tabManaBtn\]/);
  });

  it('wires a click for both new controls', () => {
    expect(code).toMatch(/tabFactionsBtn\.addEventListener\('click'/);
    expect(code).toMatch(/tabManaBtn\.addEventListener\('click'/);
  });

  // The toggle is a per-viewer convenience, so browser storage is right — but
  // an overlay can run where site data throws, and it must still render.
  it('guards every localStorage touch', () => {
    const reads = code.match(/localStorage/g) || [];
    expect(reads.length).toBeGreaterThan(0);
    for (const m of code.matchAll(/localStorage/g)) {
      const around = code.slice(Math.max(0, m.index - 220), m.index + 120);
      expect(around).toMatch(/try\s*\{/);
    }
  });

  it('labels the mana number as an estimate wherever it shows one', () => {
    expect(code).toContain('Estimated:');
    expect(code).toMatch(/class="est"/);
  });

  // Toggling the bar off must not also hide what the mob cast — that line is
  // the half the guild lead asked for first.
  it('renders the last cast outside the mana toggle', () => {
    const lc = code.indexOf('var lastCast');
    const gate = code.indexOf('if (_manaView');
    expect(lc).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    const block = code.slice(lc, lc + 900);
    expect(block).not.toMatch(/_manaView/);
  });
});
