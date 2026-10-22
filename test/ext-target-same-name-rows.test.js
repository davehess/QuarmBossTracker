// Extended Target: a value known only BY NAME is never copied onto several same-name rows.
//
// The guild lead, 2026-10-21, mid-raid, Plane of Tactics, a boss's 50% split: four rows of one name, each with its
// own spawn id, attackers and tags (identity worked), but every row showed the same health and the same damage
// line, while the game's own target window showed 78%. The agent's V2 enrichment, its near-live HP override and the
// pipe target-of-target patch are all name-keyed; they now apply to a row only when it is the one row of its name,
// or when a spawn id on both sides proves it. These run the real functions sliced from the agent.
//
// Names are invented, per the repo's public-docs convention.
//
// Run: npx vitest run test/ext-target-same-name-rows.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'const EXT_VICTIM_STALE_MS', '\n    return Object.keys(patch).length ? { ...t, ...patch } : t;\n  }) };\n}');
const env = evalBlock(
  'const stats = { recentMobDamage: [], recentTankHits: [] };\n' + block,
  ['stats', '_enrichExtTargetV2', '_overrideExtLocalHp', '_attachPipeTotToExtRows', '_extMobHpHist'],
);
const { stats, _enrichExtTargetV2, _overrideExtLocalHp, _attachPipeTotToExtRows, _extMobHpHist } = env;

const NOW = 1_700_000_000_000;
const row = (over) => ({ name: 'Brakkoth the Splitter', kind: 'npc', hp_pct: 85, ...over });
const four = () => [
  row({ spawn_id: 4829, dup_index: 1, same_name_count: 4 }),
  row({ spawn_id: 4830, dup_index: 2, same_name_count: 4, hp_pct: 80 }),
  row({ spawn_id: 4833, dup_index: 3, same_name_count: 4 }),
  row({ spawn_id: 4832, dup_index: 4, same_name_count: 4 }),
];
const feedName = (mob) => {
  stats.recentMobDamage.length = 0; stats.recentTankHits.length = 0;
  for (let i = 0; i < 6; i++) stats.recentMobDamage.push({ mob, amount: 1000, tsMs: NOW - i * 1000 });
  stats.recentTankHits.push({ mob, mobDisplay: mob, tank: 'Aldenmar', tsMs: NOW - 1000 });
};

describe('the near-live HP override (#128) is for MY target only', () => {
  it('four same-name rows with distinct ids: only the row whose id is my target takes the gauge', () => {
    const out = _overrideExtLocalHp(four(), 'brakkoth the splitter', 78, 4833);
    expect(out.map(t => t.hp_pct)).toEqual([85, 80, 78, 85]);
    expect(out[2].hp_source).toBe('local_live');
    expect(out.filter(t => t.hp_source).length).toBe(1);
  });
  it('four same-name rows and my target id is on none of them: nothing is overwritten', () => {
    const out = _overrideExtLocalHp(four(), 'brakkoth the splitter', 78, 9999);
    expect(out.map(t => t.hp_pct)).toEqual([85, 80, 85, 85]);
  });
  it('four same-name rows and no id on my side (older Zeal): the name cannot pick one, so none changes', () => {
    const out = _overrideExtLocalHp(four(), 'brakkoth the splitter', 78, null);
    expect(out.map(t => t.hp_pct)).toEqual([85, 80, 85, 85]);
  });
  it('one row of that name still takes the gauge by name, with or without an id', () => {
    expect(_overrideExtLocalHp([row()], 'brakkoth the splitter', 78, null)[0].hp_pct).toBe(78);
    expect(_overrideExtLocalHp([row({ spawn_id: 4829 })], 'brakkoth the splitter', 78, 4829)[0].hp_pct).toBe(78);
    // a different name beside it is not affected
    const two = _overrideExtLocalHp([row(), row({ name: 'a tactics guard', hp_pct: 40 })], 'brakkoth the splitter', 78, null);
    expect(two.map(t => t.hp_pct)).toEqual([78, 40]);
  });
});

describe('the damage line, kill-time estimate and victim ride only a name\'s only row', () => {
  it('a name-only damage stream is not copied onto four same-name rows', () => {
    feedName('brakkoth the splitter');
    const out = _enrichExtTargetV2({ targets: four() }, NOW).targets;
    for (const t of out) {
      expect(t.mob_dps).toBeUndefined();
      expect(t.mob_ttl_secs).toBeUndefined();
      expect(t.mob_victim).toBeUndefined();
    }
  });
  it('the same stream on a single row of that name still shows the damage line and the victim', () => {
    feedName('brakkoth the splitter');
    const out = _enrichExtTargetV2({ targets: [row({ spawn_id: 4829 })] }, NOW).targets;
    expect(out[0].mob_dps).toBeGreaterThan(0);
    expect(out[0].mob_victim).toBe('Aldenmar');
  });
  it('another name on the board keeps its own line while the split name shows none', () => {
    feedName('a tactics guard');
    const out = _enrichExtTargetV2({ targets: [...four(), row({ name: 'a tactics guard', hp_pct: 60 })] }, NOW).targets;
    expect(out.slice(0, 4).every(t => t.mob_dps === undefined)).toBe(true);
    expect(out[4].mob_dps).toBeGreaterThan(0);
  });
  it('a split name leaves no health history behind to poison the next single-row moment', () => {
    _enrichExtTargetV2({ targets: four() }, NOW);
    expect(_extMobHpHist.has('brakkoth the splitter')).toBe(false);
  });
  it('a player or pet row of the same name text is not counted as a second mob', () => {
    feedName('brakkoth the splitter');
    const out = _enrichExtTargetV2({ targets: [row(), { name: 'Brakkoth the Splitter', kind: 'player', hp_pct: 50 }] }, NOW).targets;
    expect(out[0].mob_dps).toBeGreaterThan(0);
  });
});

describe('the pipe target-of-target patch (the same name copy)', () => {
  const st = { target_name: 'Brakkoth the Splitter', target_id: 4830, updatedAt: NOW - 500,
               target_of_target: { id: 77, name: 'Corvale', authoritative: true } };
  it('with ids, only the exact instance gets my client\'s answer', () => {
    const out = _attachPipeTotToExtRows(four(), st, NOW);
    expect(out.map(t => t.mob_victim)).toEqual([undefined, 'Corvale', undefined, undefined]);
  });
  it('with no id on the rows, four same-name rows get nothing; one row still gets it by name', () => {
    const bare = [row(), row(), row(), row()];
    expect(_attachPipeTotToExtRows(bare, st, NOW).every(t => t.mob_victim === undefined)).toBe(true);
    expect(_attachPipeTotToExtRows([row()], st, NOW)[0].mob_victim).toBe('Corvale');
  });
});

describe('wiring', () => {
  const a = stripJs(src);
  it('the proxy routes the #128 override through the guarded helper, not a bare name match', () => {
    expect(a).toContain('_overrideExtLocalHp(outPayload.targets, locName, locHp,');
    expect(a).not.toMatch(/String\(t\.name\)\.toLowerCase\(\) === locName/);
  });
});
