// test/pop-latest-flags.test.js — the "Latest flags" strip at the top of /pop (the guild lead, 2026-10-14, after the
// hail board in Mimic showed a Planar Projection mid-raid: "we should show a 'latest flags completed/verified'
// section at the top of the pop page").
//
// web/lib/popLatestFlags.ts is pure apart from the one read, so the grouping, the badges and the filters run for
// real; the read's shape (a 7 day window, the verified sources, paged on a unique key) is driven through a fake
// client, and the page wiring is read as comment-stripped source.
//
// Run: npx vitest run test/pop-latest-flags.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  LATEST_DAYS, VERIFIED_SOURCES, MOMENT_SECS, verifiedBadge, isShowable, stepLabel, zoneLabel, agoText,
  groupByMoment, groupByStep, listableRows, loadLatestFlagRows,
} from '../web/lib/popLatestFlags.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const T0 = Date.parse('2026-10-14T20:00:00Z');
const at = (secsAgo) => new Date(T0 - secsAgo * 1000).toISOString();
const row = (character, flag_key, secsAgo, source = 'event', zone = '205') => ({ character, flag_key, zone, source, earned_at: at(secsAgo) });

describe('which rows are shown, and with what badge', () => {
  it('event is the server and recital is an NPC recital; checklist and hail_witnessed get no badge', () => {
    expect(verifiedBadge('event')?.label).toBe('server');
    expect(verifiedBadge('recital')?.label).toBe('NPC recital');
    expect(verifiedBadge('checklist')).toBeNull();
    expect(verifiedBadge('hail_witnessed')).toBeNull();
  });
  it('the verified sources are exactly event and recital', () => {
    expect([...VERIFIED_SOURCES].sort()).toEqual(['event', 'recital']);
  });
  it('a witnessed hail, a checklist flag and an unnamed grant are not shown', () => {
    expect(isShowable({ flag_key: 'hail', source: 'hail_witnessed' })).toBe(false);
    expect(isShowable({ flag_key: 'hail', source: 'event' })).toBe(false);
    expect(isShowable({ flag_key: 'cl_grummus', source: 'checklist' })).toBe(false);
    expect(isShowable({ flag_key: 'unmapped', source: 'event' })).toBe(false);
    expect(isShowable({ flag_key: 'fuirstel_2', source: 'event' })).toBe(true);
    expect(isShowable({ flag_key: 'fuirstel_2', source: 'recital' })).toBe(true);
  });
  it('the grouping helpers drop them too, so a caller cannot forget the filter', () => {
    const rows = [row('Aldenmar', 'hail', 10, 'hail_witnessed'), row('Aldenmar', 'cl_grummus', 10, 'checklist')];
    expect(groupByMoment(rows)).toEqual([]);
    expect(groupByStep(rows)).toEqual([]);
  });
});

describe('labels', () => {
  it('names a stage from the step catalog and a catalog flag from the flag catalog', () => {
    expect(stepLabel('fuirstel_2')).toBe('Kill Grummus, hail the Planar Projection');
    expect(stepLabel('grummus_dead')).toBe('Kill Grummus');
    expect(stepLabel('no_such_key')).toBe('no_such_key');
  });
  it('turns the numeric zone id into the plane', () => {
    expect(zoneLabel('205')).toEqual({ name: 'Plane of Disease', short: 'Disease' });
    expect(zoneLabel('203')?.short).toBe('Tranquility');
    expect(zoneLabel('999')).toBeNull();
    expect(zoneLabel(null)).toBeNull();
  });
  it('says how long ago on the server', () => {
    expect(agoText(T0, T0 - 20_000)).toBe('just now');
    expect(agoText(T0, T0 - 5 * 60_000)).toBe('5m ago');
    expect(agoText(T0, T0 - 2 * 3_600_000)).toBe('2h ago');
    expect(agoText(T0, T0 - 3 * 86_400_000)).toBe('3d ago');
  });
});

describe('layout a: one row per character per moment, newest first', () => {
  it('rows for one character at the same earned_at are one row, and the step they imply is not listed twice', () => {
    // One grant stores the stage and the stages it implies at the same timestamp (the pop_flags handler).
    const rows = [
      row('Aldenmar', 'grummus_dead', 60), row('Aldenmar', 'fuirstel_2', 60),
      row('Aldenmar', 'fuirstel_1', 60), row('Aldenmar', 'grummus_1', 60),
    ];
    const g = groupByMoment(rows);
    expect(g).toHaveLength(1);
    expect(g[0].steps.map(s => s.key).sort()).toEqual(['fuirstel_2', 'grummus_dead']);
  });
  it('two moments for one character, and two characters at one moment, stay separate; newest first', () => {
    const rows = [
      row('Aldenmar', 'fuirstel_2', 3 * 3600), row('Brackwyn', 'fuirstel_2', 3 * 3600),
      row('Aldenmar', 'thelin_2', 600),
    ];
    const g = groupByMoment(rows);
    expect(g.map(x => `${x.character}:${x.steps[0].key}`)).toEqual(['Aldenmar:thelin_2', 'Aldenmar:fuirstel_2', 'Brackwyn:fuirstel_2']);
  });
  it('rows a few seconds apart still join, rows past the window do not', () => {
    expect(groupByMoment([row('Aldenmar', 'zeks_3', 100), row('Aldenmar', 'zeks_4', 100 + 5)])).toHaveLength(1);
    expect(groupByMoment([row('Aldenmar', 'zeks_3', 100), row('Aldenmar', 'zeks_4', 100 + MOMENT_SECS + 30)])).toHaveLength(2);
  });
  it('the same step as an event and a recital keeps the server as its source', () => {
    const [g] = groupByMoment([row('Aldenmar', 'thelin_2', 30, 'recital'), row('Aldenmar', 'thelin_2', 30, 'event')]);
    expect(g.steps).toHaveLength(1);
    expect(g.source).toBe('event');
  });
  it('a row made only of recital rows is badged as an NPC recital', () => {
    const [g] = groupByMoment([row('Aldenmar', 'thelin_2', 30, 'recital')]);
    expect(verifiedBadge(g.source)?.label).toBe('NPC recital');
  });
});

describe('layout b: grouped by flag step', () => {
  it('lists each step once with its raiders, newest step first, each raider once', () => {
    const rows = [
      row('Aldenmar', 'fuirstel_2', 7200), row('Brackwyn', 'fuirstel_2', 3600), row('Corvale', 'fuirstel_2', 3000),
      row('Aldenmar', 'thelin_2', 100, 'event', '204'),
      row('Brackwyn', 'fuirstel_2', 20, 'recital'),
    ];
    const g = groupByStep(rows);
    expect(g.map(x => x.key)).toEqual(['fuirstel_2', 'thelin_2']);   // fuirstel_2's newest is the recital 20s ago
    const f = g[0];
    expect(f.characters.map(c => c.name)).toEqual(['Brackwyn', 'Corvale', 'Aldenmar']);
    expect(f.label).toBe('Kill Grummus, hail the Planar Projection');
  });
});

describe('low-level characters are left out like the rest of /pop', () => {
  const rows = [row('Aldenmar', 'zeks_3', 5), row('Brackwyn', 'zeks_3', 5), row('Corvale', 'zeks_3', 5), row('Dunmere', 'zeks_3', 5), row('Eslin', 'zeks_3', 5)];
  it('drops a trader, a hidden character and a known level under 46; keeps a raider and an unknown level', () => {
    const traders = new Set(['brackwyn']);
    const hidden = new Set(['corvale']);
    const levels = new Map([['aldenmar', 65], ['dunmere', 30]]);   // eslin: no level known
    expect(listableRows(rows, traders, hidden, levels).map(r => r.character)).toEqual(['Aldenmar', 'Eslin']);
  });
});

describe('the read: a 7 day window of verified rows, paged on a unique key', () => {
  // A fake client that records every call of the chain and answers each page empty.
  function fakeDb() {
    const calls = [];
    const chain = new Proxy({}, {
      get: (_t, name) => {
        if (name === 'then') return (res) => res({ data: [], error: null });
        return (...args) => { calls.push([name, ...args]); return chain; };
      },
    });
    return { calls, db: { from: (t) => { calls.push(['from', t]); return chain; } } };
  }
  it('reads pop_flags for the guild, verified sources only, since 7 days ago, newest first, ending on id', async () => {
    const { calls, db } = fakeDb();
    await loadLatestFlagRows(db, T0);
    const of = (n) => calls.filter(c => c[0] === n);
    expect(of('from')[0][1]).toBe('pop_flags');
    expect(of('eq').some(c => c[1] === 'guild_id')).toBe(true);
    expect(of('in')[0]).toEqual(['in', 'source', ['event', 'recital']]);
    expect(of('gte')[0]).toEqual(['gte', 'earned_at', new Date(T0 - LATEST_DAYS * 86_400_000).toISOString()]);
    expect(LATEST_DAYS).toBe(7);
    expect(of('order').map(c => c[1])).toEqual(['earned_at', 'id']);
    expect(of('range').length).toBe(1);
  });
  it('the source text pages with selectAll, takes the tag from GUILD_TAG, and never writes the literal', () => {
    const src = read('web/lib/popLatestFlags.ts');
    expect(src).toMatch(/selectAll<LatestRow>/);
    expect(src).toMatch(/\.eq\('guild_id', GUILD_TAG\)/);
    expect(src).toMatch(/\.gte\('earned_at', since\)/);
    expect(src).not.toMatch(/'wolfpack'/);
  });
});

describe('the page', () => {
  const page = read('web/app/pop/page.tsx');
  it('shows the strip only for ?flags=a or ?flags=b, so no param is the page production has', () => {
    expect(page).toMatch(/flagsParam === 'a' \|\| flagsParam === 'b' \? flagsParam : null/);
    expect(page).toMatch(/latestLayout && latestRows && <LatestFlags/);
  });
  it('puts it above the Essences queue and the views, under the header', () => {
    const strip = page.indexOf('<LatestFlags');
    expect(strip).toBeGreaterThan(page.indexOf('Show all ('));      // after the header section's controls
    expect(strip).toBeLessThan(page.indexOf('<EssencesQueue'));
    expect(strip).toBeLessThan(page.indexOf('selected ? ('));
  });
  it('filters traders and hidden characters with the lists the page already loaded', () => {
    expect(page).toMatch(/latestFlagsFor\(sbAdmin, traderNames, flaggedHidden\)/);
  });
});
