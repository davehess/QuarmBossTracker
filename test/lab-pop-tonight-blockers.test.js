// The design lab's "who cannot enter tonight" draft: the pure mapper and the text people paste into the game.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mapBlockers, buildCopyText, flagName } from '../web/lib/popTonightBlockersView.ts';
import { draft } from '../web/lib/lab/drafts/pop-tonight-blockers.ts';
import { popBlockersFixture } from '../web/lib/lab/fixtures/pop-tonight-blockers.ts';
import { LAB_RAID } from '../web/lib/lab/people.ts';

const flags = [{ key: 'a', short: 'Adler' }, { key: 'b', short: 'Door' }, { key: 'n', short: null, label: null }];
const R = (...n) => n.map((name) => ({ name }));

describe('mapBlockers', () => {
  it('no targets: no rows', () => {
    expect(mapBlockers([], flags, R('X'), () => false)).toEqual({ zones: [], raiders: 1, blockedPeople: 0 });
  });
  it('nobody blocked', () => {
    const v = mapBlockers([{ id: 'z', zoneName: 'Z', needs: ['a'] }], flags, R('X', 'Y'), () => true);
    expect(v.zones[0].blocked).toEqual([]);
    expect(v.blockedPeople).toBe(0);
  });
  it('a raider blocked in two zones is two rows but one person, sorted by name', () => {
    const has = (n, k) => !(n === 'Zed' || (n === 'Amy' && k === 'b'));
    const v = mapBlockers([{ id: '1', zoneName: 'One', needs: ['a'] }, { id: '2', zoneName: 'Two', needs: ['a', 'b'] }], flags, R('Zed', 'Amy'), has);
    expect(v.zones[0].blocked).toEqual([{ name: 'Zed', missing: ['Adler'] }]);
    expect(v.zones[1].blocked).toEqual([{ name: 'Amy', missing: ['Door'] }, { name: 'Zed', missing: ['Adler', 'Door'] }]);
    expect(v.blockedPeople).toBe(2);
  });
  it('a missing-flag name that is null falls back to the key; an unknown key too', () => {
    expect(flagName(flags[2], 'n')).toBe('n');
    expect(flagName(undefined, 'ghost')).toBe('ghost');
    const v = mapBlockers([{ id: '1', zoneName: 'One', needs: ['n', 'ghost'] }], flags, R('X'), () => false);
    expect(v.zones[0].blocked[0].missing).toEqual(['n', 'ghost']);
  });
});

describe('buildCopyText', () => {
  it('names only, ", " between, no trailing separator, order kept, duplicates dropped', () => {
    expect(buildCopyText(['Zed', 'Amy', 'Zed'])).toBe('Zed, Amy');
    expect(buildCopyText([])).toBe('');
  });
  it('caps at one chat line with a +N more tail', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Raider${String(i).padStart(2, '0')}`);
    const s = buildCopyText(names);
    expect(s.length).toBeLessThanOrEqual(250);
    expect(s).toMatch(/, \+\d+ more$/);
    const kept = s.replace(/, \+\d+ more$/, '').split(', ').length;
    expect(s.endsWith(`+${60 - kept} more`)).toBe(true);
    expect(buildCopyText(names.slice(0, 5))).not.toMatch(/more/);
    expect(buildCopyText(names, 5)).toBe('+60 more');
  });
});

// We do not know which preflags are door checks, so no copy may say cannot enter or blocked.
const read = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
describe('wording and redirect', () => {
  const files = ['../web/components/lab/pop-tonight-blockers/BlockersStrip.tsx', '../web/components/lab/pop-tonight-blockers/VersionB.tsx',
    '../web/components/lab/pop-tonight-blockers/VersionC.tsx', '../web/lib/lab/drafts/pop-tonight-blockers.ts'];
  it('never says cannot enter or blocked in what a reader sees', () => {
    for (const f of files) expect(read(f)).not.toMatch(/cannot (enter|zone)|\} blocked|Can enter|can enter/i);
  });
  it('says missing a preflag', () => {
    expect(read(files[0])).toMatch(/are missing a preflag for tonight/);
    expect(read(files[0])).toMatch(/Everyone has every preflag for tonight/);
    expect(read(files[0])).toMatch(/\} missing</);
  });
  it('the signed-out redirect keeps ?v=a', () => {
    expect(read('../web/app/pop/raid/page.tsx')).toMatch(/signin\?next=' \+ encodeURIComponent\(alt === 'a' \? '\/pop\/raid\?v=a'/);
  });
});

describe('the draft', () => {
  it('has the fixture shape: 3 zones, 0 / 4 / 11 blocked, 42 raiders', () => {
    const { view, table } = popBlockersFixture('full');
    expect(view.zones.map((z) => z.blocked.length)).toEqual([0, 4, 11]);
    expect(view.raiders).toBe(LAB_RAID.length);
    expect(table.rows).toHaveLength(42);
  });
  it('the clear state blocks nobody', () => {
    expect(popBlockersFixture('clear').view.blockedPeople).toBe(0);
  });
  it('is registered with a recommended version and a staged path', () => {
    expect(draft.variants.map((v) => v.key)).toEqual(['a', 'b', 'c']);
    expect(draft.variants.every((v) => v.name.length <= 28 && v.diff.length <= 110)).toBe(true);
    expect(draft.staged).toBe('/pop/raid?v=a');
  });
});
