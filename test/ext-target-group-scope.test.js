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

// The Raid | Group switch (the guild lead, 2026-10-08): in a raid, want === 'group'
// narrows the board to the player's RAID group (type-5 roster, `group` is a string).
describe('in a raid, the Group switch keeps my raid group', () => {
  const RAID = NOW - 5_000;
  // Aldenmar + Brackwyn are raid group "1"; Corvale is "2"; Rethlan + Zarrin "3".
  const roster = () => [
    { name: 'Aldenmar', group: '1' }, { name: 'Brackwyn', group: '1' },
    { name: 'Corvale', group: '2' },
    { name: 'Rethlan', group: '3' }, { name: 'Zarrin', group: '3' },
  ];
  const run = (want, members = roster(), st = MY_GROUP) =>
    _scopeExtToGroup(payload(), me, st, RAID, NOW, want, members);

  it('keeps only rows my raid group is on, and says raid_group', () => {
    const out = run('group');
    expect(out.scope).toBe('raid_group');
    expect(names(out)).toEqual(expect.arrayContaining(
      ['a shissar disciple', 'a shissar guard', 'Brackwyn`s warder']));
    // Corvale is raid group 2 here, so the row only Corvale is on goes too.
    expect(names(out)).not.toContain('a plagued soriz');
    expect(names(out)).not.toContain('Corvale');
    expect(names(out)).not.toContain('a soriz slave');
    expect(names(out)).not.toContain('Zarrin');
  });
  it('counts my raid group and recounts off-tanks', () => {
    const out = run('group');
    expect(out.online).toBe(2);
    expect(out.off_tank_count).toBe(1);
  });
  it('leaves the main-assist fields alone', () => {
    const p = payload(); p.main_assist = { name: 'Rethlan' };
    const out = _scopeExtToGroup(p, me, MY_GROUP, RAID, NOW, 'group', roster());
    expect(out.main_assist).toEqual({ name: 'Rethlan' });
  });
  it('want raid (or nothing): the very same payload, raid-wide', () => {
    const p = payload();
    expect(_scopeExtToGroup(p, me, MY_GROUP, RAID, NOW, 'raid', roster())).toBe(p);
    expect(_scopeExtToGroup(p, me, MY_GROUP, RAID, NOW)).toBe(p);
    expect(_scopeExtToGroup(p, me, MY_GROUP, RAID, NOW, 'bogus', roster())).toBe(p);
  });
  it('self missing from the roster: the fresh Zeal group window', () => {
    const out = run('group', [{ name: 'Rethlan', group: '3' }]);
    expect(out.scope).toBe('raid_group');
    expect(out.online).toBe(3);   // me + Brackwyn + Corvale, from the Zeal window
    expect(names(out)).toContain('a plagued soriz');
  });
  it('self has no group number: the Zeal window too', () => {
    const out = run('group', [{ name: 'Aldenmar', group: null }, { name: 'Zarrin', group: '3' }]);
    expect(out.online).toBe(3);
  });
  it('group 0 is ungrouped, not a group: the Zeal window, never everyone else in group 0', () => {
    const out = run('group', [{ name: 'Aldenmar', group: '0' }, { name: 'Rethlan', group: '0' }, { name: 'Zarrin', group: '0' }]);
    expect(out.online).toBe(3);   // me + Brackwyn + Corvale (Zeal window), not the two other group-0 raiders
    expect(names(out)).not.toContain('Zarrin');
  });
  // A chosen Group never shows the whole raid (the guild lead, 2026-10-08: "still showing other groups").
  it('no usable group anywhere: an empty list that says the group is unknown, never the raid', () => {
    for (const out of [
      _scopeExtToGroup(payload(), me, null, RAID, NOW, 'group', []),
      _scopeExtToGroup(payload(), me, zeal(['Brackwyn'], 120_000), RAID, NOW, 'group', null),
      _scopeExtToGroup(payload(), me, null, null, NOW, 'group', null),
    ]) {
      expect(out.targets).toEqual([]);
      expect(out.group_unknown).toBe(true);
    }
    // Raid (or the default) still fails open outside a raid.
    const p = payload();
    expect(_scopeExtToGroup(p, me, null, null, NOW, 'raid', null)).toBe(p);
  });
  it('Group drops a pet with no known owner', () => {
    const p = payload(); p.targets.push({ kind: 'pet', name: 'a stray warder' });
    expect(names(_scopeExtToGroup(p, me, MY_GROUP, RAID, NOW, 'group', roster()))).not.toContain('a stray warder');
    expect(names(_scopeExtToGroup(p, me, MY_GROUP, null, NOW, 'raid', null))).toContain('a stray warder');
  });
  it('a stale raid window is not a raid: the plain group filter', () => {
    const out = _scopeExtToGroup(payload(), me, MY_GROUP, NOW - 120_000, NOW, 'group', roster());
    expect(out.scope).toBe('group');
    expect(out.online).toBe(3);
  });
  it('outside a raid, want changes nothing', () => {
    const a = _scopeExtToGroup(payload(), me, MY_GROUP, null, NOW, 'raid', roster());
    const b = _scopeExtToGroup(payload(), me, MY_GROUP, null, NOW, 'group', roster());
    expect(b).toEqual(a);
    expect(a.scope).toBe('group');
  });
});

describe('the proxy applies it', () => {
  const clean = stripJs(src);
  it('after every enricher, with the raid window\'s freshness and the raid roster', () => {
    expect(clean).toContain(
      "outPayload = _scopeExtToGroup(outPayload, selfCharacter, selfSt, _lastRaidPipe && _lastRaidPipe.at, Date.now(),");
    expect(clean).toContain("wantScope, _lastRaidPipe && _lastRaidPipe.members);");
  });
  it('reads ?scope=group from the url; anything else is raid', () => {
    expect(clean).toMatch(/\/\[\?&\]scope=group\(\?:&\|\$\)\/\.test\(req\.url\) \? 'group' : 'raid'/);
  });
});
