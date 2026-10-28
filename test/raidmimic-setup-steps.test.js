// test/raidmimic-setup-steps.test.js — raidmimic.com/setup shows ONE step at a time by default (the guild lead,
// 2026-10-28: "setup needs the step-by-step by default"). Sibling of test/raidmimic-setup.test.js.
//
// What this pins:
//   - the state helper: hash <-> step index, clamping, the saved "Show all steps" choice and its fallbacks,
//   - the content is unchanged: still six steps, in order, every one reaching the page through the client stepper,
//   - the no-JS promise: the server page still renders every step, the stepper hides the others only with `hidden`
//     and un-hides them in <noscript>.
//
// Source-text assertions run over comment-stripped source (CLAUDE.md "comments satisfy text assertions").
// Run: npx vitest run test/raidmimic-setup-steps.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import * as H from '../web/lib/raidmimicSetupSteps.ts';
import { STEPS } from '../web/lib/raidmimicSetup.ts';

const code = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const IDS = STEPS.map(s => s.id);

describe('the content is unchanged', () => {
  it('six steps, same order, same ids', () => {
    expect(STEPS).toHaveLength(6);
    expect(IDS).toEqual(['download', 'first-run', 'on-your-own', 'join-a-raid', 'for-a-guild', 'privacy']);
  });
});

describe('hash <-> step', () => {
  it('a step id, with or without the #, is its index', () => {
    IDS.forEach((id, i) => {
      expect(H.stepFromHash(`#${id}`, IDS)).toBe(i);
      expect(H.stepFromHash(id, IDS)).toBe(i);
      expect(H.hashForStep(i, IDS)).toBe(`#${id}`);
    });
  });
  it('empty, unknown or malformed is the first step', () => {
    for (const h of ['', '#', '#nope', '#troubleshooting', '#%E0%A4%A', undefined, null]) expect(H.stepFromHash(h, IDS), String(h)).toBe(0);
  });
  it('isStepHash is true only for a step id, so a #troubleshooting link is not scrolled to the guide', () => {
    expect(H.isStepHash('#privacy', IDS)).toBe(true);
    for (const h of ['', '#', '#troubleshooting', '#%E0%A4%A', null]) expect(H.isStepHash(h, IDS), String(h)).toBe(false);
  });
  it('hashForStep clamps, and says nothing when there are no steps', () => {
    expect(H.hashForStep(-3, IDS)).toBe('#download');
    expect(H.hashForStep(99, IDS)).toBe('#privacy');
    expect(H.hashForStep(0, [])).toBe('');
  });
  it('clampStep keeps 0..total-1, and junk is the first step', () => {
    expect(H.clampStep(-1, 6)).toBe(0);
    expect(H.clampStep(2, 6)).toBe(2);
    expect(H.clampStep(6, 6)).toBe(5);
    expect(H.clampStep(2.9, 6)).toBe(2);
    for (const bad of [NaN, Infinity, -Infinity]) expect(H.clampStep(bad, 6)).toBe(0);
    expect(H.clampStep(3, 0)).toBe(0);
  });
  it('stepLabel reads "Step 2 of 6"', () => {
    expect(H.stepLabel(1, 6)).toBe('Step 2 of 6');
    expect(H.stepLabel(40, 6)).toBe('Step 6 of 6');
  });
});

describe('Show all steps, remembered', () => {
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) }; };
  it('defaults to step by step, round-trips, and can be turned back off', () => {
    const s = mem();
    expect(H.readShowAll(s)).toBe(false);
    H.writeShowAll(s, true);
    expect(H.readShowAll(s)).toBe(true);
    H.writeShowAll(s, false);
    expect(H.readShowAll(s)).toBe(false);
  });
  it('a missing or throwing storage is step by step and never throws', () => {
    const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    for (const s of [null, undefined, boom]) {
      expect(H.readShowAll(s)).toBe(false);
      expect(() => H.writeShowAll(s, true)).not.toThrow();
    }
  });
  it('any stored value but "1" is step by step', () => {
    const s = mem(); s.setItem(H.SHOW_ALL_KEY, 'true');
    expect(H.readShowAll(s)).toBe(false);
  });
});

describe('keyboard', () => {
  it('right and left arrows step; typing and modifiers do not', () => {
    expect(H.stepKeyDelta({ key: 'ArrowRight' })).toBe(1);
    expect(H.stepKeyDelta({ key: 'ArrowLeft' })).toBe(-1);
    expect(H.stepKeyDelta({ key: 'ArrowDown' })).toBe(0);
    expect(H.stepKeyDelta({ key: 'ArrowRight', altKey: true })).toBe(0);
    expect(H.stepKeyDelta({ key: 'ArrowRight', target: { tagName: 'INPUT' } })).toBe(0);
    expect(H.stepKeyDelta({ key: 'ArrowLeft', target: { tagName: 'textarea' } })).toBe(0);
    expect(H.stepKeyDelta({ key: 'ArrowLeft', target: { tagName: 'DIV', isContentEditable: true } })).toBe(0);
  });
});

describe('the page wiring and the no-JS fallback', () => {
  const page = code('web/app/raidmimic/setup/page.tsx');
  const stepper = code('web/app/raidmimic/setup/SetupSteps.tsx');
  it('the page stays a server component and hands every step to the stepper', () => {
    expect(page).not.toMatch(/['"]use client['"]/);
    expect(page).toMatch(/<SetupSteps\b/);
    expect(page).toMatch(/STEPS\.map/);
    expect(stepper.split('\n')[0]).toMatch(/^'use client';/);
  });
  it('every step is in the HTML: the others are only `hidden`, and <noscript> un-hides them', () => {
    expect(stepper).toMatch(/steps\.map\(\(s, i\) => \(\s*<li key=\{s\.id\} id=\{s\.id\} data-wp-step hidden=\{!all && i !== idx\}/);
    expect(stepper).toMatch(/<noscript><style>\{'\[data-wp-step\]\{display:list-item!important\}/);
    expect(stepper).not.toMatch(/\.filter\(|steps\[idx\]\.node|steps\.slice/);   // never render only the current one
  });
  it('the choice is read and written through the guarded helper, never raw localStorage calls', () => {
    expect(stepper).toMatch(/readShowAll\(window\.localStorage\)/);
    expect(stepper).toMatch(/writeShowAll\(window\.localStorage, on\)/);
    expect(stepper).not.toMatch(/localStorage\.(get|set)Item/);
  });
  it('Next is a link on every step, never a disabled control', () => {
    expect(stepper).not.toMatch(/disabled/);
    expect(stepper).toMatch(/Next →/);
  });
});
