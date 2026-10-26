// test/screen-plan-overlay.test.js — /screen draws tonight's raid plan under the live map and shows who still
// lacks each preflag on the Overview (the guild lead picked option C for the screen, 2026-10-14).
//
// What can go wrong without anyone noticing:
//   * the plan lands in the wrong frame (through serverXY's column swap, or not negated) and every marker
//     floats somewhere the raid is not;
//   * /spectator, which shares the board, starts drawing the plan or changes shape;
//   * moving loadRaiders/loadHeld out of /pop/raid brings back the two bugs it already had (a `level` column
//     characters does not have; a `main_name is null` filter that drops every main);
//   * the Overview box says "everyone has it" because a name missed the held map.
// The two lookups and the summary run for real; the wiring is read as comment-stripped source (these files'
// comments quote the very code under test, so they would answer for it).
//
// Run: npx vitest run test/screen-plan-overlay.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { PLAN, PREFLAGS } from '../web/lib/raidPlan.ts';
import { planOverlays, overlayForZone, preflagSummary } from '../web/lib/screenPlan.ts';
import { serverXY, toScreen } from '../web/lib/spectator.ts';

const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

describe('the overlay lookups', () => {
  const plan = planOverlays(PLAN);

  it('carries every plan section, one overlay per zone, with nothing but where things are', () => {
    expect(plan.map(p => p.zone)).toEqual(PLAN.map(s => s.zone));
    expect(new Set(plan.map(p => p.zone)).size).toBe(plan.length);
    for (const p of plan) {
      expect(Object.keys(p).sort().every(k => ['zone', 'markers', 'route', 'altRoutes', 'patrol'].includes(k)), p.zone).toBe(true);
      expect(p.route.length, p.zone).toBeGreaterThanOrEqual(2);
    }
  });

  it('picks the plan for the zone on screen, and nothing for a zone it does not cover', () => {
    const inn = overlayForZone(plan, 'poinnovation');
    expect(inn?.zone).toBe('poinnovation');
    expect(inn?.markers.some(m => m.kind === 'boss')).toBe(true);
    expect(overlayForZone(plan, 'gfaydark')).toBeNull();
    expect(overlayForZone(plan, null)).toBeNull();
  });

  it('is a no-op without a plan (this is what keeps /spectator unchanged)', () => {
    expect(overlayForZone(undefined, 'poinnovation')).toBeNull();
    expect(overlayForZone([], 'poinnovation')).toBeNull();
  });

  it('shares the raiders\' frame: a raid_roster loc and a plan point at the same spot land on the same pixel', () => {
    // The roster stores the game's /loc order (Y, X) in (loc_x, loc_y); serverXY swaps it into the spawn-table
    // frame the plan is already written in. So the plan goes straight through toScreen, and a raider standing
    // on a plan marker draws on top of it.
    const m = overlayForZone(plan, 'poinnovation').markers[0];
    const raider = serverXY(m.y, m.x);               // loc_x = server y, loc_y = server x
    expect(raider).toEqual({ x: m.x, y: m.y });
    expect(toScreen(raider.x, raider.y)).toEqual(toScreen(m.x, m.y));
    // …and a swap applied to the plan by mistake would move it.
    expect(toScreen(serverXY(m.x, m.y).x, serverXY(m.x, m.y).y)).not.toEqual(toScreen(m.x, m.y));
  });
});

describe('the preflag summary', () => {
  const raiders = [{ name: 'Aldenmar' }, { name: 'Brackwyn' }, { name: 'Corvale' }];
  const [a, b] = PREFLAGS;
  const held = new Map([
    ['aldenmar', new Set([a.key, b.key])],
    ['brackwyn', new Set([a.key])],
    // Corvale has no entry at all: holds nothing.
  ]);
  const s = preflagSummary(raiders, held, PREFLAGS, 'Sign-ups: test, 3 going.');

  it('lists, per preflag, exactly the raiders who lack it (held is keyed by lower-case name)', () => {
    expect(s.total).toBe(3);
    expect(s.lines).toHaveLength(PREFLAGS.length);
    expect(s.lines[0]).toMatchObject({ key: a.key, short: a.short, missing: ['Corvale'] });
    expect(s.lines[1]).toMatchObject({ key: b.key, missing: ['Brackwyn', 'Corvale'] });
    for (const l of s.lines.slice(2)) expect(l.missing, l.key).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });

  it('is empty for a preflag everyone holds, and survives an empty held map', () => {
    const all = preflagSummary(raiders, new Map(raiders.map(r => [r.name.toLowerCase(), new Set(PREFLAGS.map(p => p.key))])), PREFLAGS, '');
    for (const l of all.lines) expect(l.missing).toEqual([]);
    expect(preflagSummary(raiders, new Map(), PREFLAGS, '').lines.every(l => l.missing.length === 3)).toBe(true);
  });

  it('is plain data a server page can hand to a client component', () => {
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('the board: /spectator is untouched, /screen passes the plan', () => {
  const board = read('web/app/spectator/SpectatorBoard.tsx');
  const spectator = read('web/app/spectator/page.tsx');
  const screen = read('web/app/screen/page.tsx');
  const screenBoard = read('web/app/screen/ScreenBoard.tsx');

  it('takes the plan as an optional prop', () => {
    expect(board).toMatch(/plan\?: PlanOverlay\[\]/);
    expect(board).toMatch(/overlayForZone\(plan, zone\)/);
  });
  it('the /spectator page renders the board with no props at all', () => {
    expect(spectator).toMatch(/<SpectatorBoard \/>/);
    expect(spectator).not.toMatch(/plan/i);
  });
  it('/screen builds the overlay from PLAN and hands it down to the embedded map', () => {
    expect(screen).toMatch(/planOverlays\(PLAN\)/);
    expect(screen).toMatch(/<ScreenBoard [^>]*plan=\{plan\}/);
    expect(screenBoard).toMatch(/<SpectatorBoard embedded shared=\{shared\} plan=\{plan\} \/>/);
    expect(screenBoard).toMatch(/<MapPanel shared=\{mapShared\} plan=\{plan\} \/>/);
  });
  it('draws the plan after the walls and before the raider dots, through toScreen and never serverXY', () => {
    const walls = board.indexOf('s.layers.generated');
    const plan = board.indexOf('drawPlan(ctx, s.plan');
    const dots = board.indexOf('const staleOf = ');
    expect(walls).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(walls);
    expect(dots).toBeGreaterThan(plan);
    const fn = board.slice(board.indexOf('function drawPlan('), board.indexOf('const chip = '));
    expect(fn).toMatch(/toScreen\(p\.x, p\.y\)/);
    expect(board).not.toMatch(/serverXY/);
  });
  it('keeps the plan module free of the plan prose (the board imports it into the browser bundle)', () => {
    const mod = read('web/lib/screenPlan.ts');
    expect(mod).not.toMatch(/^import (?!type)/m);
  });
});

describe('the preflag code moved out of /pop/raid', () => {
  const page = read('web/app/pop/raid/page.tsx');
  const mod = read('web/lib/raidPreflags.ts');

  it('/pop/raid imports loadRaiders and loadHeld instead of defining them', () => {
    expect(page).toMatch(/import \{[^}]*\bloadRaiders\b[^}]*\bloadHeld\b[^}]*\} from '@\/lib\/raidPreflags'/);
    expect(page).not.toMatch(/function loadRaiders|function loadHeld/);
  });
  it('/screen reads the same two functions', () => {
    expect(read('web/app/screen/page.tsx')).toMatch(/import \{[^}]*\bloadHeld\b[^}]*\bloadRaiders\b[^}]*\} from '@\/lib\/raidPreflags'/);
  });
  it('exports both, and stays server-side (no client directive)', () => {
    expect(mod).toMatch(/export async function loadRaiders\(/);
    expect(mod).toMatch(/export async function loadHeld\(/);
    expect(mod).not.toMatch(/^\s*['"]use client['"]/m);
  });
  it('asks characters only for columns it has, and keeps a main whose main_name is its own name', () => {
    // Both were real bugs on the live page (2026-10-13): "column characters.level does not exist", then every
    // signed-up player dropped because a main's main_name is its own name, not null.
    const sel = [...mod.matchAll(/from\('characters'\)\s*\.select\('([^']+)'\)/g)].map(m => m[1]);
    expect(sel.length).toBeGreaterThan(0);
    for (const x of sel) expect(x.split(/,\s*/)).not.toContain('level');
    expect(mod).not.toMatch(/\.is\('main_name', null\)/);
    // The main test moved with the pick into web/lib/raidPlan.ts (pickSignupCharacter, run in pop-raid-plan.test.js).
    expect(mod).toMatch(/pickSignupCharacter\(/);
  });
  it('spells the guild tag as the constant, never the literal', () => {
    expect(mod).toMatch(/import \{ GUILD_TAG \} from '@\/lib\/guild'/);
  });
});

describe('the Overview', () => {
  const panels = read('web/app/screen/ScreenPanels.tsx');
  const screenBoard = read('web/app/screen/ScreenBoard.tsx');

  it('renders the preflag summary: the label, who is missing, or "everyone has it"', () => {
    expect(panels).toMatch(/\{preflags && <PreflagBox summary=\{preflags\} \/>\}/);
    expect(panels).toContain('everyone has it');
    expect(panels).toMatch(/l\.missing\.join\(', '\)/);
    expect(panels).toMatch(/l\.label/);
  });
  it('is handed the summary by the board', () => {
    expect(screenBoard).toMatch(/<OverviewView [^>]*preflags=\{preflags\}/);
  });
  it('says the box is a snapshot from when the page opened', () => {
    expect(panels).toMatch(/Checked when this page was opened; reload to refresh/);
  });
  it('leaves the box out when the read fails', () => {
    const screen = read('web/app/screen/page.tsx');
    expect(screen).toMatch(/catch \{\s*return null;/);
  });
});
