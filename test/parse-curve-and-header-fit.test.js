// test/parse-curve-and-header-fit.test.js — two bugs Hitya hit on 2026-09-06,
// both of which looked like "the data is wrong" and were neither.
//
// 1. The damage-over-the-fight chart drew half a fight. PostgREST's 1000-row
//    cap applies to an RPC exactly as it does to a select, and truncates
//    SILENTLY. Measured on encounter 57f45a22: encounter_timeline() returns
//    1,846 rows / 1,198,871 damage / 340s — the mob's whole 1.2M health bar —
//    and the unpaged call took the first 1,000: 663,568 damage, stopping at
//    195s. That is exactly what the chart rendered.
//
// 2. The header folded to "Menu" the instant the pointer touched a nav
//    category on desktop. Nav renders the hovered group's links IN FLOW inside
//    the header row (deliberately — absolute would cover a phone's first
//    viewport), so they count toward scrollWidth. Hovering was therefore a real
//    overflow, and since folding REMOVES the overflow, the fold hysteresis
//    pinned the bar compact until the window grew 64px.
//
// Run: npx vitest run test/parse-curve-and-header-fit.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', ...p), 'utf8'));
const parse  = read('app', 'parses', '[id]', 'page.tsx');
const header = read('components', 'SiteHeader.tsx');
const nav    = read('components', 'Nav.tsx');

describe('the fight curve is not truncated by the row cap', () => {
  it('pages the timeline RPC through the one shared paginator', () => {
    expect(parse).toMatch(/timelineRows = await selectAll<any>\(\(from, to\) =>/);
    expect(parse).toMatch(/sb\.rpc\('encounter_timeline', \{ p_encounter_id: id, p_step_sec: 5 \}\)\.range\(from, to\)/);
    expect(parse).toMatch(/import \{ selectAll \} from '@\/lib\/selectAll';/);
  });

  it('no longer takes the unpaged single-shot result', () => {
    // The exact shape that silently capped at 1000.
    expect(parse).not.toMatch(/const \{ data: tl \} = await sb\.rpc\('encounter_timeline'/);
  });

  it('still fails soft — a broken curve must not take the parse page down', () => {
    expect(parse).toMatch(/catch \{ timelineRows = \[\]; \}/);
  });
});

describe('hovering a nav category does not fold the header', () => {
  it('the fit measurement ignores the transient revealed row', () => {
    expect(header).toMatch(/if \(el\.querySelector\('\[data-nav-revealed\]'\)\) return;/);
  });

  it('the guard runs BEFORE anything can latch the fold', () => {
    const m = stripJs(header);
    const guard = m.indexOf("data-nav-revealed");
    const latch = m.indexOf('tightRef.current = true');
    expect(guard).toBeGreaterThan(-1);
    expect(latch).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(latch);
  });

  it('Nav marks the revealed row so the header can find it', () => {
    expect(nav).toMatch(/data-nav-revealed=""/);
  });

  // The fold itself must still work — this is not a blanket "never fold".
  it('keeps the real overflow fold and its hysteresis', () => {
    expect(header).toMatch(/el\.scrollWidth > el\.clientWidth \+ 1/);
    expect(header).toMatch(/w > tightAt\.current \+ 64/);
  });
});
