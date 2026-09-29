// test/essences-queue.test.js — the guild's Essences of Power loot queue on /pop.
//
// The guild lead, 2026-09-29: "it will be an opendkp bid out for the entire item … the guild needs to
// see the order for who is next on the loot list for those items, and if they're present to get them,
// if they are not, we would bid out the item again and add to the queue … raid 1, someone bids and wins
// the item, they're queued up for the first set / if raid 3 that person's not there, we bid the item and
// whoever comes in is next in the queue / as long as we bid the item only when we don't have someone in
// queue we're good". Runs the real buildEssenceQueue through that story.
//
// Run: npx vitest run test/essences-queue.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { buildEssenceQueue, demoEssenceQueue, ESSENCES } from '../web/lib/essencesQueue.ts';

// Names invented.
const award = (character, item, dkp, at) => ({ character, item, dkp, at });
const next = (r, key) => r.next.find(n => n.key === key);
const here = (...names) => new Set(names.map(n => n.toLowerCase()));

describe('the queue, raid by raid', () => {
  it('raid 1: nobody queued, so the first essence is bid; the winner starts the queue with it', () => {
    expect(next(buildEssenceQueue([], [], here('Aldenmar', 'Brackwyn')), 'fire')).toEqual({ key: 'fire', name: null, waiting: [], bid: true });
    const r = buildEssenceQueue([award('Aldenmar', 'Essence of Fire', 300, '2026-11-01')], [], here('Aldenmar'));
    expect(r.queue.map(e => e.name)).toEqual(['Aldenmar']);
    expect(Object.keys(r.queue[0].pieces)).toEqual(['fire']);
    expect(r.queue[0].joinedDkp).toBe(300);
  });

  it('raid 2: the next essence goes to the first in line who lacks it and is there — no bid', () => {
    const r = buildEssenceQueue([award('Aldenmar', 'Essence of Fire', 300, '2026-11-01')], [], here('Aldenmar', 'Brackwyn'));
    expect(next(r, 'wind')).toMatchObject({ name: 'Aldenmar', bid: false });
    // Someone who already has that one is skipped: another Fire is a bid.
    expect(next(r, 'fire')).toMatchObject({ name: null, bid: true });
  });

  it('raid 3: the queued person is not there, so it is bid; the winner loots it and joins the queue after them', () => {
    const awards = [award('Aldenmar', 'Essence of Fire', 300, '2026-11-01'), award('Aldenmar', 'Essence of Wind', 0, '2026-11-04')];
    expect(next(buildEssenceQueue(awards, [], here('Brackwyn')), 'water')).toMatchObject({ name: null, bid: true, waiting: ['Aldenmar'] });
    const r = buildEssenceQueue([...awards, award('Brackwyn', 'Essence of Water', 250, '2026-11-08')], [], here('Aldenmar', 'Brackwyn'));
    expect(r.queue.map(e => e.name)).toEqual(['Aldenmar', 'Brackwyn']);
    // Aldenmar is first in line for Water and Earth; Brackwyn for Fire and Wind.
    expect(next(r, 'water').name).toBe('Aldenmar');
    expect(next(r, 'earth').name).toBe('Aldenmar');
    expect(next(r, 'fire').name).toBe('Brackwyn');
    expect(next(r, 'earth').waiting).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('four pieces and you are done, out of the queue', () => {
    const all = ESSENCES.map((e, i) => award('Aldenmar', e.name, i ? 0 : 300, `2026-11-0${i + 1}`));
    const r = buildEssenceQueue([...all, award('Brackwyn', 'Essence of Fire', 200, '2026-11-09')], [], here('Aldenmar', 'Brackwyn'));
    expect(r.done.map(e => e.name)).toEqual(['Aldenmar']);
    expect(r.queue.map(e => e.name)).toEqual(['Brackwyn']);
    expect(next(r, 'wind').name).toBe('Brackwyn');
  });
});

describe('where the pieces come from', () => {
  it('Mimic seeing the loot fills a piece, but never puts anyone in the queue', () => {
    const r = buildEssenceQueue([award('Aldenmar', 'Essence of Fire', 300, '2026-11-01')],
      [{ character: 'aldenmar', item: 'Essence of Wind', at: '2026-11-04T02:00:00Z' },
       { character: 'Corvale', item: 'Essence of Water', at: '2026-11-04T02:00:00Z' }], null);
    expect(r.queue.map(e => e.name)).toEqual(['Aldenmar']);
    expect(r.queue[0].pieces.wind).toMatchObject({ source: 'mimic' });
  });

  it('a bid for the whole set entered as "Essences of Power" queues you with no piece yet', () => {
    const r = buildEssenceQueue([award('Brackwyn', 'Essences of Power', 400, '2026-11-01')], [], here('Brackwyn'));
    expect(r.queue.map(e => e.name)).toEqual(['Brackwyn']);
    expect(r.queue[0].pieces).toEqual({});
    for (const e of ESSENCES) expect(next(r, e.key).name).toBe('Brackwyn');
  });

  it('other items, and the older look-alike essences, are ignored', () => {
    const r = buildEssenceQueue([award('Aldenmar', 'Essence of Nature', 50, '2026-11-01'), award('Aldenmar', 'Soul Essence of Aten Ha Ra', 50, '2026-11-01')], [], null);
    expect(r.queue).toEqual([]);
  });

  it('with no raid on, the next name is simply the first in line', () => {
    const r = buildEssenceQueue([award('Aldenmar', 'Essence of Fire', 300, '2026-11-01')], [], null);
    expect(next(r, 'wind')).toMatchObject({ name: 'Aldenmar', bid: false });
    expect(r.queue[0].present).toBeNull();
  });
});

describe('the page', () => {
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8'));
  it('shows only on ?v=b or ?v=c, so /pop without it is production as it was', () => {
    expect(page).toMatch(/const essLayout: 'b' \| 'c' \| null = v === 'b' \|\| v === 'c' \? v : null;/);
    expect(page).toMatch(/const essences = essLayout \? \(essDemo \? demoEssenceQueue\(\) : await loadEssenceQueue\(\)\) : null;/);
    expect(page).toMatch(/\{essLayout && essences && <EssencesQueue layout=\{essLayout\} demo=\{essDemo\} \{\.\.\.essences\} \/>\}/);
  });
  it('sample data (&demo=1) is labelled as such, and its names are the invented placeholders', () => {
    const card = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/EssencesQueue.tsx'), 'utf8'));
    expect(card).toMatch(/\{demo && <span[^>]*>Sample data — invented names<\/span>\}/);
    const d = demoEssenceQueue();
    expect([...d.queue, ...d.done].map(e => e.name).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan']);
    expect(d.done.map(e => e.name)).toEqual(['Aldenmar']);
  });
  it('is behind the /pop sign-in like the rest of the page', () => {
    const at = page.indexOf("if (!user) redirect('/auth/signin?next=/pop');");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(page.indexOf('await loadEssenceQueue()'));
  });
});
