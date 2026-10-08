// Extended Target outside a raid shows YOUR group, not the whole zone.
//
// A member, 2026-09-23: "if we're outside of a raid and have multiple groups
// in the same zone we see each others info on the extended target overlay" —
// and "if we're in group but not raid the default is to not show extended
// target for outside of group". The bot aggregates every online raider in the
// zone; only this client knows its group (Zeal type 6), so the scoping is done
// in the agent's proxy. These run the real function sliced from the agent.
//
// Names are invented, per the repo's public-docs convention.
//
// Run: npx vitest run test/ext-target-group-scope.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const { _scopeExtToGroup } = evalBlock(
  sliceBlock(src, 'const EXT_RAID_FRESH_MS = 60_000;', '\n}'),
  ['_scopeExtToGroup'],
);

const NOW = 1_700_000_000_000;
const me = 'Aldenmar';
// My group: me + Brackwyn + Corvale. The other group in the zone: Rethlan + Zarrin.
const zeal = (members, ageMs = 1000) => ({
  updatedAt: NOW - ageMs,
  group_members: members.map(name => ({ name })),
});
const MY_GROUP = zeal(['Brackwyn', 'Corvale']);

const payload = () => ({
  online: 5,
  off_tank_count: 2,
  targets: [
    { name: 'a shissar disciple', kind: 'npc', raiders: ['Brackwyn'] },
    { name: 'a soriz slave',      kind: 'npc', raiders: ['Rethlan', 'Zarrin'] },
    { name: 'a plagued soriz',    kind: 'npc', raiders: [], mob_victim: 'Corvale' },
    { name: 'a shissar guard',    kind: 'npc', raiders: [], off_tank: true, off_tank_raiders: ['Aldenmar'] },
    { name: 'a shissar warder',   kind: 'npc', raiders: [], off_tank: true, off_tank_raiders: ['Zarrin'] },
    { name: 'Corvale',            kind: 'player', hurt: true },
    { name: 'Zarrin',             kind: 'player', hurt: true },
    { name: 'Rethlan`s warder',   kind: 'pet', owner: 'Rethlan', hurt: true },
    { name: 'Brackwyn`s warder',  kind: 'pet', owner: 'Brackwyn', hurt: true },
  ],
});
const names = (p) => p.targets.map(t => t.name);

describe('grouped, not raiding: only my group\'s rows', () => {
  const out = _scopeExtToGroup(payload(), me, MY_GROUP, null, NOW);

  it('keeps mobs my group targets, is being hit by, or off-tanks', () => {
    expect(names(out)).toEqual(expect.arrayContaining(
      ['a shissar disciple', 'a plagued soriz', 'a shissar guard']));
  });
  it('drops the other group\'s mobs', () => {
    expect(names(out)).not.toContain('a soriz slave');
    expect(names(out)).not.toContain('a shissar warder');
  });
  it('keeps my group\'s hurt players and pets, drops the other group\'s', () => {
    expect(names(out)).toContain('Corvale');
    expect(names(out)).toContain('Brackwyn`s warder');
    expect(names(out)).not.toContain('Zarrin');
    expect(names(out)).not.toContain('Rethlan`s warder');
  });
  it('counts my group, and says so', () => {
    expect(out.online).toBe(3);
    expect(out.scope).toBe('group');
  });
  it('recounts off-tanks for my group only', () => {
    expect(out.off_tank_count).toBe(1);
  });
});

describe('everything else is exactly as before', () => {
  it('in a raid: the very same payload, raid-wide', () => {
    const p = payload();
    expect(_scopeExtToGroup(p, me, MY_GROUP, NOW - 5_000, NOW)).toBe(p);
  });
  it('a raid that ended over a minute ago no longer counts', () => {
    const out = _scopeExtToGroup(payload(), me, MY_GROUP, NOW - 120_000, NOW);
    expect(out.scope).toBe('group');
  });
  it('no Zeal state: unchanged (never hide on missing info)', () => {
    const p = payload();
    expect(_scopeExtToGroup(p, me, null, null, NOW)).toBe(p);
  });
  it('stale Zeal state: unchanged', () => {
    const p = payload();
    expect(_scopeExtToGroup(p, me, zeal(['Brackwyn'], 120_000), null, NOW)).toBe(p);
  });
  it('no group list at all: unchanged', () => {
    const p = payload();
    expect(_scopeExtToGroup(p, me, { updatedAt: NOW }, null, NOW)).toBe(p);
  });
});

describe('solo counts as a group of one', () => {
  it('only rows I am involved in', () => {
    const out = _scopeExtToGroup(payload(), me, zeal([]), null, NOW);
    expect(names(out)).toEqual(['a shissar guard']);
    expect(out.online).toBe(1);
  });
});

describe('the proxy applies it', () => {
  it('after every enricher, with the raid window\'s freshness', () => {
    expect(stripJs(src)).toContain(
      "outPayload = _scopeExtToGroup(outPayload, selfCharacter, selfSt, _lastRaidPipe && _lastRaidPipe.at, Date.now());");
  });
});
