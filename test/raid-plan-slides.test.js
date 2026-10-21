// test/raid-plan-slides.test.js — "Load tonight's plan" on /screen (the guild lead picked option A, 2026-10-14:
// the raid-night plan becomes slides in the existing deck).
//
// The plan is data (web/lib/raidPlan.ts) and planSlides() runs for real here against the screen's own slide
// limits (parseSlideInput). The route's wiring is read as comment-stripped source: its header comment names the
// action and would answer for the code.
//
// Run: npx vitest run test/raid-plan-slides.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { PLAN, PREFLAGS } from '../web/lib/raidPlan.ts';
import { PLAN_SLIDE_PREFIX, PLAN_SLIDES_MAX, isPlanSlideTitle, pack, planSlides } from '../web/lib/raidPlanSlides.ts';
import { BODY_MAX, SLIDES_MAX, parseSlideBody, parseSlideInput } from '../web/lib/raidScreen.ts';

// raidScreen.ts reaches spectator.ts through the site's "@/" alias, which vitest does not know (as raid-screen.test.js).
vi.mock('@/lib/spectator', async () => await import('../web/lib/spectator.ts'));

const slides = planSlides();

describe('planSlides: the plan as slides', () => {
  it('passes the screen\'s own slide validation, every one', () => {
    for (const s of slides) {
      const p = parseSlideInput({ title: s.title, body: s.body });
      expect(p.ok, `${s.title}: ${p.ok ? '' : p.error}`).toBe(true);
      expect(s.body.length, s.title).toBeGreaterThan(0);
      expect(s.body.length, s.title).toBeLessThanOrEqual(BODY_MAX);
    }
  });
  it('titles every slide with the prefix, so a reload can find them again', () => {
    expect(PLAN_SLIDE_PREFIX).toBe('Plan · ');
    for (const s of slides) expect(isPlanSlideTitle(s.title), s.title).toBe(true);
    expect(isPlanSlideTitle('Raid rules')).toBe(false);
  });
  it('leaves officers room: at most 30 slides, 10 of the deck kept free', () => {
    expect(PLAN_SLIDES_MAX).toBe(30);
    expect(slides.length).toBeLessThanOrEqual(PLAN_SLIDES_MAX);
    expect(SLIDES_MAX - slides.length).toBeGreaterThanOrEqual(10);
  });
  it('has a slide for every boss, by name in its title', () => {
    for (const b of PLAN.flatMap(s => s.bosses)) {
      expect(slides.some(s => s.title.includes(b.name)), b.name).toBe(true);
    }
  });
  it('opens with Tonight and the preflags, then each target in order', () => {
    expect(slides[0].title).toBe(`${PLAN_SLIDE_PREFIX}Tonight`);
    expect(slides[1].title).toBe(`${PLAN_SLIDE_PREFIX}Preflags`);
    const at = (name) => slides.findIndex(s => s.title.includes(name));
    const order = PLAN.map(s => at(s.bosses[0].name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('names every preflag and every target on the opening slides', () => {
    const tonight = slides[0].body, flags = slides[1].body;
    for (const s of PLAN) expect(tonight, s.id).toContain(s.title);
    for (const p of PREFLAGS) expect(flags, p.key).toContain(p.label);
  });
  it('writes bullets the slide reader understands', () => {
    for (const s of slides) {
      for (const block of parseSlideBody(s.body)) {
        if (block.kind === 'p') expect(block.text.startsWith('- '), s.title).toBe(false);
      }
    }
  });
  it('keeps every mechanic of every boss on some slide', () => {
    const joined = slides.map(s => s.body).join('\n');
    for (const b of PLAN.flatMap(s => s.bosses)) {
      expect(joined, b.name).toContain(b.stats);
      for (const m of b.mechanics) expect(joined, m).toContain(m);
    }
  });
});

describe('pack: a body over 2,000 characters splits, never truncates', () => {
  // The real plan fits a slide a boss, so the split is driven with text that does not.
  const lines = Array.from({ length: 30 }, (_, i) => `- line ${i} ${'word '.repeat(30)}`.trim());
  const out = pack('Big', [['Header:', ...lines]]);

  it('makes numbered slides that each fit', () => {
    expect(out.length).toBeGreaterThan(1);
    out.forEach((s, i) => {
      expect(s.title).toBe(`${PLAN_SLIDE_PREFIX}Big (${i + 1}/${out.length})`);
      expect(s.body.length).toBeLessThanOrEqual(BODY_MAX);
      expect(parseSlideInput({ title: s.title, body: s.body }).ok).toBe(true);
    });
  });
  it('loses no line', () => {
    const joined = out.map(s => s.body).join('\n');
    for (const l of lines) expect(joined).toContain(l);
  });
  it('cuts a single line that is longer than a slide at a space', () => {
    const one = pack('Long', [['word '.repeat(600).trim()]]);
    expect(one.length).toBeGreaterThan(1);
    for (const s of one) expect(s.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(one.map(s => s.body).join(' ').split(' ')).toHaveLength(600);
  });
  it('gives a lone slide no (1/1)', () => {
    expect(pack('Small', [['a']])[0].title).toBe(`${PLAN_SLIDE_PREFIX}Small`);
  });
});

describe('POST /api/screen/slides: loadPlan', () => {
  const route = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/api/screen/slides/route.ts'), 'utf8'));
  const post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function DELETE'));

  it('has the loadPlan branch, behind the officer check, before a slide is added', () => {
    const officer = post.indexOf('isOfficer(user.id)');
    const branch = post.indexOf("b.action === 'loadPlan'");
    expect(officer).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(officer);
    expect(post.indexOf('replacePlanSlides(admin, deck)')).toBeGreaterThan(branch);
    expect(post.indexOf('parseSlideInput(body)')).toBeGreaterThan(branch);
  });
});
