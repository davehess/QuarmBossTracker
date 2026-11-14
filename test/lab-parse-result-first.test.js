// test/lab-parse-result-first.test.js — the parse-result-first draft: fixture shape, the pure mapper that feeds the
// staged ?v=a render on /parses/[id], and the one-line headlines. Run: npx vitest run test/lab-parse-result-first.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { fixtureKill, fixtureOld, fixtureOpen, fixtureWipe } from '../web/lib/lab/fixtures/parse-result-first.ts';
import { LAB_RAID } from '../web/lib/lab/people.ts';
import { toResultView, headlines, classShare, fmtClock, viewerRole } from '../web/lib/parseResultFirstView.ts';
import { draft } from '../web/lib/lab/drafts/parse-result-first.ts';

describe('fixture', () => {
  const k = fixtureKill();
  it('is a 4:12 kill of 42 raiders from the lab roster, ranked by damage', () => {
    expect(k.durationSec).toBe(252);
    expect(fmtClock(k.durationSec)).toBe('4:12');
    expect(k.players).toHaveLength(42);
    const names = new Set(LAB_RAID.map((p) => p.name));
    expect(k.players.every((p) => names.has(p.name))).toBe(true);
    for (let i = 1; i < k.players.length; i++) expect(k.players[i - 1].damage).toBeGreaterThanOrEqual(k.players[i].damage);
    expect(k.players.reduce((s, p) => s + p.pct, 0)).toBeCloseTo(100, 5);
  });
  it('has a long tail, three deaths, four drops, six events', () => {
    expect(k.players[0].dps / k.players[41].dps).toBeGreaterThan(5);
    expect(k.deaths).toHaveLength(3);
    expect(k.loot).toHaveLength(4);
    expect(k.events).toHaveLength(6);
  });
  it('the viewer owns rank 14 and a healer near the bottom', () => {
    const rank = (n) => k.players.find((p) => p.name === n).rank;
    expect(k.mine).toHaveLength(2);
    expect(rank(k.mine[0])).toBe(14);
    expect(rank(k.mine[1])).toBeGreaterThanOrEqual(37);
    expect(k.players.find((p) => p.name === k.mine[1]).cls).toBe('Cleric');
  });
  it('the wipe has the boss at 22 percent and no loot', () => {
    const w = fixtureWipe();
    expect(w.state).toBe('wipe');
    expect(w.bossHpLeftPct).toBe(22);
    expect(w.loot).toEqual([]);
  });
});

const base = { boss: 'Boss', zone: 'Zone', whenLabel: 'now', isWipe: false, classification: null, endedAt: '2026-11-11T01:01:40Z', startedAt: '2026-11-11T01:00:00Z',
  durationSec: 100, totalDamage: 1000, totalDps: 10, players: [], classOf: () => null, deaths: [], contribs: [], events: [], loot: [] };

describe('toResultView', () => {
  it('ranks, computes shares and offsets death times from the start', () => {
    const v = toResultView({ ...base, players: [
      { character_name: 'B', total_damage: 300, dps: 3 }, { character_name: 'A', total_damage: 700, dps: 7 }],
    classOf: (n) => (n === 'A' ? 'Rogue' : null), deaths: [{ name: 'B', ts: '2026-11-11T01:00:42Z' }], mine: ['b'] });
    expect(v.players.map((p) => [p.rank, p.name, Math.round(p.pct)])).toEqual([[1, 'A', 70], [2, 'B', 30]]);
    expect(v.deaths[0].atSec).toBe(42);
    expect(headlines.deaths(v)).toBe('1 death, first at 0:42');
  });
  it('no players: empty view, no crash, zero share', () => {
    const v = toResultView({ ...base, totalDamage: null, totalDps: null });
    expect(v.players).toEqual([]);
    expect(v.totalDamage).toBe(0);
    expect(v.role).toBe('damage');
    expect(headlines.deaths(v)).toBe('No deaths');
    expect(classShare(v.players)).toEqual([]);
  });
  it('null duration stays null and the raid DPS falls back to the stored number', () => {
    const v = toResultView({ ...base, durationSec: null, totalDps: 55 });
    expect(v.durationSec).toBeNull();
    expect(v.raidDps).toBe(55);
    expect(fmtClock(v.durationSec)).toBe('-');
  });
  it('a wipe and an unclassified-but-not-wipe fight keep their own state word', () => {
    expect(toResultView({ ...base, isWipe: true }).state).toBe('wipe');
    expect(toResultView({ ...base, classification: 'test' }).state).toBe('unknown');
    expect(toResultView(base).state).toBe('killed');
    expect(toResultView({ ...base, endedAt: null }).state).toBe('open');
  });
  it('a viewer with no rows gets no marks and the damage role', () => {
    const v = toResultView({ ...base, players: [{ character_name: 'A', total_damage: 5, dps: 1 }], mine: ['Nobody'] });
    expect(viewerRole(v.mine, v.players)).toBe('damage');
    expect(v.players).toHaveLength(1);
  });
  it('a tank or healer viewer opens that panel', () => {
    const players = [{ character_name: 'T', total_damage: 5, dps: 1 }, { character_name: 'H', total_damage: 4, dps: 1 }];
    const cls = (n) => (n === 'T' ? 'Warrior' : 'Cleric');
    expect(toResultView({ ...base, players, classOf: cls, mine: ['T'] }).role).toBe('tank');
    expect(toResultView({ ...base, players, classOf: cls, mine: ['H'] }).role).toBe('heal');
  });
  it('tank and heal summaries keep each name once at its best number', () => {
    const rp = (n) => ({ defenders: [{ name: 'Tk', damageTaken: n, hits: 2, dodges: 1 }], healers: [{ name: 'Hl', healed: n, ticks: 3 }] });
    const v = toResultView({ ...base, players: [{ character_name: 'Tk', total_damage: 1, dps: 1 }, { character_name: 'Hl', total_damage: 1, dps: 1 }], contribs: [
      { contributor_character: 'x', total_damage: 1, raw_parse: rp(100) }, { contributor_character: 'y', total_damage: 1, raw_parse: rp(500) },
      { contributor_character: null, total_damage: 1, raw_parse: null }] });
    expect(v.tanks).toEqual([{ name: 'Tk', hits: 2, taken: 500, avoided: 1 }]);
    expect(v.healers).toHaveLength(1);
    expect(v.healers[0].healed).toBe(500);
    expect(v.contributors[2].name).toBe('(anonymous)');
  });
});

describe('review fixes', () => {
  it('the tank list drops the boss and adds: only this fight\'s player rows count', () => {
    const v = toResultView({ ...base, players: [{ character_name: 'Aldenmar', total_damage: 5, dps: 1 }], contribs: [
      { contributor_character: 'x', total_damage: 1, raw_parse: { defenders: [
        { name: 'Cazic Thule', damageTaken: 9000, hits: 9 }, { name: 'aldenmar', damageTaken: 400, hits: 4 }] } }] });
    expect(v.tanks.map((t) => t.name)).toEqual(['aldenmar']);
  });
  it('detailKept is false only when no contribution still has its detailed log', () => {
    expect(toResultView({ ...base, contribs: [{ contributor_character: 'x', total_damage: 1, raw_parse: null }] }).detailKept).toBe(false);
    expect(toResultView({ ...base, contribs: [{ contributor_character: 'x', total_damage: 1, raw_parse: { defenders: [] } }] }).detailKept).toBe(true);
  });
  it('lab fixtures cover the open and the older-than-7-days states', () => {
    expect(fixtureOpen().state).toBe('open');
    expect(fixtureOld().detailKept).toBe(false);
    expect(fixtureOld().deaths).toEqual([]);
  });
  const shared = stripJs(fs.readFileSync(path.join(ROOT, 'web/components/lab/parse-result-first/shared.tsx'), 'utf8'));
  it('the panels say the detail is gone, never "Nobody died", when it is', () => {
    expect(shared).toMatch(/if \(!v\.detailKept\) return <Empty>\{OLD\}<\/Empty>;\s+if \(!v\.deaths\.length\)/);
    expect(shared).toContain('Detail is kept for 7 days. This fight is older.');
    expect(shared).toContain('No kill seen');
  });
  it('the real page reads ended_at, and the signed-out redirect keeps ?v=a', () => {
    const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/parses/[id]/page.tsx'), 'utf8'));
    expect(page).toMatch(/id, started_at, ended_at, duration_sec/);
    expect(page).toMatch(/endedAt: enc\.ended_at/);
    expect(page).toMatch(/view === 'a' \? encodeURIComponent\(`\/parses\/\$\{id\}\?v=a`\)/);
  });
});

describe('the staged page', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/parses/[id]/page.tsx'), 'utf8'));
  it('reads ?v=a, the default render is still the one below it, and the draft names the path', () => {
    expect(src).toMatch(/if \(view === 'a'\)/);
    expect(src.indexOf("view === 'a'")).toBeLessThan(src.indexOf('Damage breakdown'));
    expect(draft.staged).toMatch(/^\/parses\/.*\?v=a$/);
  });
});
