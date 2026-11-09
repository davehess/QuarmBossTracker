// test/raidmimic-start-free.test.js — the "Free to start" block on the raidmimic.com onboarding pages (DECISIONS §531).
// Pins: only ?v=b / ?v=c turn it on (no ?v= = production), the planned price is the one the landing page shows, the
// promise line is there, and both pages render it only behind the switch. Source text is comment-stripped.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import * as F from '../web/lib/raidmimicStartFree.ts';
import { GUILD_PRICE, priceLabel } from '../web/lib/raidmimicStory.ts';

const src = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

describe('Free to start', () => {
  it('only ?v=b and ?v=c turn it on', () => {
    expect(F.startFreeVariant('b')).toBe('b');
    expect(F.startFreeVariant('c')).toBe('c');
    for (const v of [undefined, '', 'a', 'B', 'bc']) expect(F.startFreeVariant(v)).toBeNull();
  });

  it('says the planned guild price the landing page says, and that nothing is charged until a plan is chosen', () => {
    expect(F.START_FREE.planned).toContain(priceLabel(GUILD_PRICE));
    expect(F.START_FREE.promise).toBe('Nothing is charged until you choose a plan.');
    expect(F.FREE_ROWS.length).toBeGreaterThan(0);
    expect(F.PAID_ROWS.every(r => r.gives.length > 0)).toBe(true);
  });

  it.each(['web/app/raidmimic/setup/page.tsx', 'web/app/guilds/new/page.tsx'])('%s renders it only behind the switch', (p) => {
    const s = src(p);
    expect(s).toMatch(/startFreeVariant\(searchParams\?\.v\)/);
    expect(s).toMatch(/\{startFree && /);
  });
});
