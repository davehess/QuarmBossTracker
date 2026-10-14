// test/pop-raid-plan.test.js — /pop/raid, the raid-night plan (the guild lead, 2026-10-13: "make us a raid page
// that has preflag checking, travel guide, expectations, and maps with paths preferably").
//
// The plan is data (web/lib/raidPlan.ts) and runs for real here. The page imports the framework, so its
// wiring is read as comment-stripped source (comments quote the code and would answer for it).
//
// Run: npx vitest run test/pop-raid-plan.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { PLAN, PREFLAGS, TRAVEL_BASICS, bossAnchor, loc, pickRaidEvent } from '../web/lib/raidPlan.ts';
import { POP_STEPS, STEP_IMPLIES, stepsHeld } from '../web/lib/popSteps.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// Every key stepsHeld can produce: a catalog step, or something a step implies or is implied by.
const producible = new Set([
  ...Object.values(POP_STEPS).flat().map(s => s.key),
  ...Object.keys(STEP_IMPLIES),
  ...Object.values(STEP_IMPLIES).flat(),
]);

describe('the plan: every target can be drawn', () => {
  it('lists the night in the guild order', () => {
    expect(PLAN.map(s => s.id)).toEqual(['disease', 'innovation', 'nightmare', 'lair', 'valor']);
  });
  it('gives each target a marker, a route of two or more points and a boss', () => {
    for (const s of PLAN) {
      expect(s.markers.length, s.id).toBeGreaterThanOrEqual(1);
      expect(s.route.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.bosses.length, s.id).toBeGreaterThanOrEqual(1);
      for (const p of [...s.markers, ...s.route]) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${s.id} ${p.label}`).toBe(true);
      }
    }
  });
  it('groups the four Innovation bosses and the two Nightmare bosses into one section each', () => {
    expect(PLAN.find(s => s.id === 'innovation').bosses).toHaveLength(4);
    expect(PLAN.find(s => s.id === 'nightmare').bosses).toHaveLength(2);
  });
  it('takes the Prototypes in the guild order: X, IX, XI, then the Behemoth', () => {
    const inn = PLAN.find(s => s.id === 'innovation');
    const order = ['Prototype X', 'Prototype IX', 'Prototype XI', 'Behemoth'];
    expect(inn.bosses.map(b => b.name.replace('Manaetic ', ''))).toEqual(order);
    expect(inn.route.map(p => p.label).filter(l => order.includes(l))).toEqual(order);
  });
  it('keeps the shared travel notes', () => {
    expect(TRAVEL_BASICS.points.join(' ')).toMatch(/LIVE/);
    expect(TRAVEL_BASICS.points.join(' ')).toMatch(/unlock memories/);
  });
  it('prints /loc as Y then X', () => {
    expect(loc(-1467, 1786)).toBe('/loc 1786, -1467');
  });
});

describe('the preflags', () => {
  it('are all steps stepsHeld can produce', () => {
    for (const p of PREFLAGS) expect(producible.has(p.key), p.key).toBe(true);
    for (const s of PLAN) for (const k of s.needs) expect(PREFLAGS.some(p => p.key === k), `${s.id} needs ${k}`).toBe(true);
  });
  it('expand a series to its earlier steps', () => {
    expect(stepsHeld(['mavuin_3']).has('mavuin_1')).toBe(true);
    expect(stepsHeld(['thelin_2']).has('thelin_1')).toBe(true);
    expect(stepsHeld(['fuirstel_2']).has('fuirstel_1')).toBe(true);
    expect(stepsHeld(['zeks_2']).has('zeks_1')).toBe(true);
  });
});

describe('who is on the night', () => {
  const at = (iso) => ({ id: iso, start_time: iso });
  it('takes the evening event on the ET date', () => {
    // 2026-10-15T00:30Z is 20:30 ET on the 14th.
    expect(pickRaidEvent([at('2026-10-16T00:30:00+00:00'), at('2026-10-15T00:30:00+00:00')]).id).toBe('2026-10-15T00:30:00+00:00');
  });
  it('takes the earliest after 18:00 ET when several fall on the date', () => {
    const got = pickRaidEvent([at('2026-10-14T16:00:00+00:00'), at('2026-10-15T01:00:00+00:00'), at('2026-10-15T00:30:00+00:00')]);
    expect(got.id).toBe('2026-10-15T00:30:00+00:00');
  });
  it('is null when nothing falls on the date', () => {
    expect(pickRaidEvent([at('2026-10-16T00:30:00+00:00')])).toBeNull();
  });
});

describe('the page', () => {
  const page = read('web/app/pop/raid/page.tsx');
  it('reads the sign-ups and expands flags with stepsHeld', () => {
    expect(page).toMatch(/from\('rh_signups'\)/);
    expect(page).toMatch(/from\('rh_events'\)/);
    expect(page).toMatch(/stepsHeld\(/);
    expect(page).toMatch(/selfFlagsFromTicks\(/);
    expect(page).toMatch(/pop_who_sightings/);
  });
  it('counts as going anyone whose status is not absent, declined, bench or tentative', () => {
    expect(page).toContain('/absen|declin|bench|tentat/i');
  });
  it('is members only and carries the beta tag', () => {
    expect(page).toMatch(/redirect\('\/auth\/signin\?next=\/pop\/raid'\)/);
    expect(page).toMatch(/<NewPageTag/);
    expect(page).toMatch(/dynamic = 'force-dynamic'/);
  });
  it('asks characters only for columns it has, and keeps a main whose main_name is its own name (2026-10-13)', () => {
    // The live page died with "column characters.level does not exist"; then, with no level, every signed-up
    // player still dropped out, because a main's main_name is its own name, not null.
    const sel = [...page.matchAll(/from\('characters'\)\s*\.select\('([^']+)'\)/g)].map(m => m[1]);
    expect(sel.length).toBeGreaterThan(0);
    for (const s of sel) expect(s.split(/,\s*/)).not.toContain('level');
    expect(page).not.toMatch(/\.is\('main_name', null\)/);
    expect(page).toMatch(/c\.main_name\.toLowerCase\(\) === c\.name\.toLowerCase\(\)/);
  });
  it('links the overview to each target and boss, the bosses to PQDI, and the loot to item cards', () => {
    expect(page).toMatch(/href=\{`#\$\{bossAnchor\(s\.id, b\.npc\)\}`\}/);
    expect(page).toMatch(/id=\{bossAnchor\(s\.id, b\.npc\)\}/);
    expect(page).toContain('https://www.pqdi.cc/npc/${b.npc}');
    expect(page).toContain('https://www.pqdi.cc/item/${d.item_id}');
    expect(page).toMatch(/from\('eqemu_npc_drops'\)/);
    expect(page).toMatch(/<ItemHover card=\{loot\.cards\[d\.item_id\]\}/);
    expect(bossAnchor('innovation', 206053)).toBe('innovation-206053');
  });
  it('folds the travel notes behind "Click here for more info"', () => {
    expect(page).toMatch(/<details[^>]*>\s*<summary[^>]*>Click here for more info<\/summary>\s*<List items=\{TRAVEL_BASICS\.points\}/);
  });
  it('never touches the Brewall layer', () => {
    for (const f of ['web/app/pop/raid/page.tsx', 'web/app/pop/raid/walls.ts', 'web/app/pop/raid/ZoneSvg.tsx']) {
      expect(read(f), f).not.toMatch(/brewall/i);
    }
  });
});

describe('popSteps on main', () => {
  it('exports stepsHeld, and the Justice flag carries its earlier steps', () => {
    expect(typeof stepsHeld).toBe('function');
    expect(stepsHeld(['mavuin_3']).has('mavuin_1')).toBe(true);
  });
});
