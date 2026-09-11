// /mimic/mini — the Mimic mini-mode review page (Hitya 2026-09-11).
//
// The catalog in web/lib/miniReview.ts is pure, so its validators run for
// real here; the page/action/migration checks are text checks over
// comment-stripped source, per the repo rule.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripJs, stripSql } from './_source-slice.js';
import {
  OVERLAYS, OVERLAY_KEYS, CHOICES, isOverlayKey, isChoice, cleanFeedback, tally, FEEDBACK_MAX, CAST, KAAS_PARSE,
} from '../web/lib/miniReview.ts';

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('catalog', () => {
  it('every overlay has exactly three options keyed a/b/c with all four costs', () => {
    expect(OVERLAYS.length).toBeGreaterThanOrEqual(9);
    for (const o of OVERLAYS) {
      expect(o.options.map(x => x.key)).toEqual(['a', 'b', 'c']);
      for (const opt of o.options) {
        expect(opt.name).toBeTruthy();
        expect(opt.how.length).toBeGreaterThan(0);
        for (const k of ['build', 'maint', 'runtime', 'change']) expect(['low', 'med', 'high']).toContain(opt.cost[k]);
      }
      expect(o.zeal, `${o.key} says what the Zeal toggle changes`).toBeTruthy();
    }
    expect(new Set(OVERLAY_KEYS).size).toBe(OVERLAY_KEYS.length);
  });

  it('validators accept only catalog keys and a/b/c', () => {
    expect(isOverlayKey('tank')).toBe(true);
    expect(isOverlayKey('Tank')).toBe(false);
    expect(isOverlayKey('')).toBe(false);
    expect(isOverlayKey(null)).toBe(false);
    for (const c of CHOICES) expect(isChoice(c)).toBe(true);
    expect(isChoice('d')).toBe(false);
    expect(isChoice('A')).toBe(false);
    expect(isChoice(undefined)).toBe(false);
  });

  it('cleanFeedback trims, rejects empty, and caps length', () => {
    expect(cleanFeedback('  hi  ')).toEqual({ ok: true, body: 'hi' });
    expect(cleanFeedback('   ').ok).toBe(false);
    expect(cleanFeedback(42).ok).toBe(false);
    expect(cleanFeedback('x'.repeat(FEEDBACK_MAX)).ok).toBe(true);
    expect(cleanFeedback('x'.repeat(FEEDBACK_MAX + 1)).ok).toBe(false);
  });

  it('tally counts per overlay and ignores junk rows', () => {
    const t = tally([
      { overlay: 'tank', choice: 'a' }, { overlay: 'tank', choice: 'a' }, { overlay: 'tank', choice: 'c' },
      { overlay: 'nope', choice: 'a' }, { overlay: 'ch', choice: 'z' },
    ]);
    expect(t.tank).toEqual({ a: 2, b: 0, c: 1 });
    expect(t.ch).toEqual({ a: 0, b: 0, c: 0 });
    expect(t.nope).toBeUndefined();
  });

  it('mocks use real raiders and the real parse (not the alt list)', () => {
    expect(KAAS_PARSE.rows.length).toBe(10);
    expect(KAAS_PARSE.rows.map(r => r[0])).toContain(CAST.me_dps);
    expect(CAST.clerics).toContain(CAST.me_cleric);
  });
});

describe('page + actions + migration', () => {
  const page = stripJs(read('web/app/mimic/mini/page.tsx'));
  const actions = stripJs(read('web/app/mimic/mini/actions.ts'));
  const review = stripJs(read('web/app/mimic/mini/MiniReview.tsx'));
  const mig = stripSql(read('supabase/migrations/20260911030000_overlay_design_votes.sql'));

  it('page is member-only and sends you back after sign-in', () => {
    expect(page).toMatch(/redirect\('\/auth\/signin\?next=\/mimic\/mini'\)/);
    expect(page).toMatch(/getSessionUser\(\)/);
  });

  it('actions validate through the shared catalog before touching the tables', () => {
    expect(actions).toMatch(/isOverlayKey\(input\?\.overlay\)/);
    expect(actions).toMatch(/isChoice\(input\?\.choice\)/);
    expect(actions).toMatch(/cleanFeedback\(input\?\.body\)/);
    expect(actions).toMatch(/onConflict: 'overlay,user_id'/);
    expect(actions).toMatch(/from\('overlay_design_votes'\)/);
    expect(actions).toMatch(/from\('overlay_design_feedback'\)/);
  });

  it('the ballot has a spot for every Pack member (Hitya 2026-09-11)', () => {
    expect(page).toMatch(/from\('wolfpack_members'\)\.select\('user_id, nickname, global_name'\)\.eq\('is_member', true\)/);
    expect(page).toMatch(/members=\{ballot\}/);
    expect(review).toMatch(/Who has picked what/);
    expect(review).toMatch(/ballotRows\.map/);
    expect(review).toMatch(/vote\(o\.key, c\)/);
  });

  it('the damage-shield box is per hit, not the running total (Hitya 2026-09-11)', () => {
    const mocks = stripJs(read('web/app/mimic/mini/mocks.tsx'));
    expect(mocks).toMatch(/\{DS_PER_HIT\}\/hit/);
    expect(mocks).not.toMatch(/dsTotal/);
    const tankA = OVERLAYS.find(o => o.key === 'tank').options[0];
    expect(tankA.how.join(' ')).toMatch(/one hit returns/);
  });

  it('the clock stops under prefers-reduced-motion', () => {
    expect(review).toMatch(/prefers-reduced-motion: reduce/);
    expect(read('web/app/mimic/mini/mocks.module.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('migration creates both tables, RLS on, authenticated read only', () => {
    expect(mig).toMatch(/create table if not exists overlay_design_votes/);
    expect(mig).toMatch(/create table if not exists overlay_design_feedback/);
    expect(mig).toMatch(/primary key \(overlay, user_id\)/);
    expect(mig).toMatch(/alter table overlay_design_votes enable row level security/);
    expect(mig).toMatch(/alter table overlay_design_feedback enable row level security/);
    expect(mig).not.toMatch(/for (insert|update|delete)/);
  });
});
