// test/lab-raid-roster-calm.test.js — design-lab draft raid-roster-calm and the pure mapper behind /raid?v=a.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { draft } from '../web/lib/lab/drafts/raid-roster-calm.ts';
import { troubledRaid, calmRaid } from '../web/lib/lab/fixtures/raid-roster-calm.ts';
import { calmViewFromRows, hpTone, missingBuffs } from '../web/lib/raidRosterCalmView.ts';

const row = (o = {}) => ({
  name: 'Aldenmar', className: 'Warrior', role: 'tank', raidGroup: 1, rank: null, inRaid: true, noAgent: false, hasAgent: true,
  hpPct: 100, manaPct: null, byCategory: { haste: ['x'], attack: ['x'], ds: ['x'], resists: ['x'] },
  hpSlots: { A: 'a', B: 'b', C: 'c' }, buffs: [], ...o,
});

describe('calmViewFromRows', () => {
  it('handles an empty raid', () => {
    const v = calmViewFromRows([], null);
    expect(v.groups).toEqual([]);
    expect(v.alerts).toEqual([]);
    expect(v.mimic).toEqual({ on: 0, total: 0 });
    expect(v.leader).toBeNull();
    expect(v.invite.tone).toBe('orange');
  });
  it('keeps a raider with no live data, with no gaps and no HP', () => {
    const v = calmViewFromRows([row({ name: 'Quiet', noAgent: true, hasAgent: false, hpPct: null, byCategory: {}, hpSlots: { A: null, B: null, C: null } })], null);
    const r = v.groups[0].raiders[0];
    expect(r).toMatchObject({ live: false, hp: null, gaps: [], dead: false, curse: null });
    expect(v.notOnMimic).toEqual(['Quiet']);
    expect(v.mimic).toEqual({ on: 0, total: 1 });
  });
  it('null HP is not dead', () => {
    const r = calmViewFromRows([row({ hpPct: null })], null).groups[0].raiders[0];
    expect(r.dead).toBe(false);
    expect(hpTone(r.hp)).toBe('none');
  });
  it('a healthy raid has no alerts and no chips', () => {
    const v = calmViewFromRows([row(), row({ name: 'B' })], null);
    expect(v.alerts).toEqual([]);
    expect(v.groups[0].raiders.every((r) => r.gaps.length === 0 && !r.curse)).toBe(true);
  });
  it('names a curse, a dead raider and a dry healer, curses first', () => {
    const v = calmViewFromRows([
      row({ name: 'Dry', className: 'Cleric', role: 'priest', manaPct: 4, byCategory: { manaRegen: ['x'], resists: ['x'] } }),
      row({ name: 'Gone', hpPct: 0 }),
      row({ name: 'Hexed', buffs: [{ name: 'Gravel Rain', ticks: 5 }] }),
      row({ name: 'DryWiz', className: 'Wizard', role: 'caster', manaPct: 3, byCategory: { manaRegen: ['x'], resists: ['x'] } }),
    ], { character: 'Aldenmar' });
    expect(v.alerts.map((a) => [a.kind, a.who])).toEqual([['curse', 'Hexed'], ['dead', 'Gone'], ['mana', 'Dry']]);
    expect(v.alerts[0].what).toBe('Gravel Rain');
  });
  it('orders gaps with the HP buff first and uses the role list', () => {
    expect(missingBuffs(row({ hpSlots: { A: null, B: 'b', C: 'c' }, byCategory: { attack: ['x'], resists: ['x'] } }))).toEqual(['HP buff', 'Haste', 'Dmg Shield']);
  });
  it('ignores parked rows and reads leader and invite', () => {
    const v = calmViewFromRows([row({ rank: 'Raid Leader' }), row({ name: 'Parked', inRaid: false })], { character: 'aldenmar' });
    expect(v.mimic.total).toBe(1);
    expect(v.leader).toBe('Aldenmar');
    expect(v.invite).toEqual({ tone: 'green', text: 'invite on' });
  });
});

describe('fixtures', () => {
  const all = (v) => v.groups.flatMap((g) => g.raiders);
  it('is 54 raiders in 9 groups of 6, with 12 not on Mimic and no repeated name', () => {
    expect(troubledRaid.groups).toHaveLength(9);
    expect(troubledRaid.groups.every((g) => g.raiders.length === 6)).toBe(true);
    expect(troubledRaid.notOnMimic).toHaveLength(12);
    expect(new Set(all(troubledRaid).map((r) => r.name)).size).toBe(54);
  });
  it('the troubled raid has the stated problems', () => {
    const r = all(troubledRaid);
    expect(r.filter((x) => x.curse)).toHaveLength(2);
    expect(r.filter((x) => x.dead)).toHaveLength(1);
    expect(r.filter((x) => x.hp != null && x.hp >= 35 && x.hp <= 60)).toHaveLength(3);
    expect(r.filter((x) => x.gaps.length > 0)).toHaveLength(6);
    expect(troubledRaid.alerts.filter((a) => a.kind === 'mana')).toHaveLength(1);
  });
  it('the calm raid has nothing to say', () => {
    expect(calmRaid.alerts).toEqual([]);
    expect(all(calmRaid).every((x) => x.gaps.length === 0 && !x.curse && !x.dead)).toBe(true);
  });
});

describe('draft and staging', () => {
  it('has three versions with short names and the recommended one first-class', () => {
    expect(draft.variants.map((v) => v.key)).toEqual(['a', 'b', 'c']);
    expect(draft.variants.every((v) => v.name.length <= 28 && v.diff.length <= 110)).toBe(true);
    expect(draft.rec).toBe('a');
  });
  it('RaidView swaps the view by ?v=a without touching its refresh', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/raid/RaidView.tsx'), 'utf8'));
    expect(src).toMatch(/useSearchParams\(\)\?\.get\('v'\) === 'a'/);
    expect(src).toMatch(/setInterval\(\(\) => \{[\s\S]{0,160}router\.refresh\(\)[\s\S]{0,40}\}, 60_000\)/);
  });
  it('the alert strip renders nothing when there are no alerts (source check)', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/components/lab/raid-roster-calm/shared.tsx'), 'utf8'));
    expect(src).toMatch(/alerts\.length === 0\) return null/);
  });
  const lab = (f) => stripJs(fs.readFileSync(path.join(ROOT, 'web/components/lab/raid-roster-calm', f), 'utf8'));
  it('the real page closes a raider detail through the close callback the view hands it', () => {
    const real = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/raid/RaidView.tsx'), 'utf8'));
    expect(real).toMatch(/renderDetail=\{\(c, close\)[\s\S]{0,200}onClose=\{close\}/);
    expect(lab('shared.tsx')).toMatch(/render\(r, close\)/);
    for (const f of ['AlertFirst.tsx', 'GroupTiles.tsx', 'JobTabs.tsx']) expect(lab(f)).toMatch(/detailFor\(renderDetail, \w+, (?:onClose|\(\) => setOpen\(null\))\)/);
  });
  it('alert text is text-lg, tap targets are 40px, HP is text-base unless hurt', () => {
    const s = lab('shared.tsx');
    expect(s).toMatch(/gap-y-0 text-lg font-bold text-red/);
    expect(s).toMatch(/inline-flex min-h-\[40px\] items-center px-1/);
    expect(s).toMatch(/hpSize[\s\S]{0,120}'text-base' : 'text-lg'/);
    expect(s).not.toMatch(/who is not/);
  });
  it('version B keeps HP on a cursed tile and version C tints cursed rows', () => {
    expect(lab('GroupTiles.tsx')).toMatch(/curse <\/span> : null\}\{hpLabel\(r\)\}/);
    expect(lab('JobTabs.tsx')).toMatch(/r\.curse \|\| r\.dead \? 'bg-red\/10'/);
  });
});
