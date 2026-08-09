// #194 — two mobs with one name, told apart by where their tanks stand.
//
// THE ASK (Hitya 2026-08-04): "having zero traction on the [Zeal spawn_id]
// suggestion, we need to make end routes. given the location data we have with
// tanks, with just one person in the raid having zeal and mimic running, we
// should be able to figure out where mobs are being tanked and try to figure
// out which one is being debuffed" — with Thall Va Xakra's two same-name adds
// on the next raid as the live case.
//
// The pipe ceiling is VERIFIED and permanent: no spawn id, no mob loc — two
// same-name mobs are byte-identical on every gauge. The end-around clusters
// the PLAYERS being melee'd instead (a tanked mob stands on its tank), which
// we know from incoming_mob / observed_tanks, at coordinates we know from
// live_state loc and the type-5 raid forward.
//
// Laws under test (docs/DESIGN-mob-serialization.md):
//   • position is a SEPARATOR — it may only ever RAISE the instance count;
//   • a bridging player MERGES clusters (under-report, never phantom-split);
//   • at K=1 the payload is byte-identical to today's (non-negotiable);
//   • a debuff that cannot be placed shows on EVERY row dimmed, never guessed.
//
// Run: npx vitest run test/ext-pos-cluster.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _extHeadingPoint, _extPosCluster, _extBindInstances, _extAttributeDebuffs } = evalBlock(
  sliceBlock(src, 'function _extHeadingPoint(m, reach, scale) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extPosCluster(engaged, units, hOpts) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extBindInstances(hpClusters, posInstances) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extAttributeDebuffs(debuffEntries, rows, observerInfo, hpTol) {', '\n}'),
  ['_extHeadingPoint', '_extPosCluster', '_extBindInstances', '_extAttributeDebuffs'],
);

const UNITS = 25;
const tank = (raider, x, y, z = 0) => ({ raider, tank: raider, x, y, z });

describe('_extPosCluster — engaged raiders → instances', () => {
  it('two tanks apart are two instances, each labeled', () => {
    const out = _extPosCluster([tank('Grabthar', 0, 0), tank('Borim', 120, 0)], UNITS);
    expect(out).toHaveLength(2);
    expect(out.map(c => c.tanks.join())).toEqual(['Borim', 'Grabthar']);
  });

  it('two tanks in one melee ball are ONE instance', () => {
    const out = _extPosCluster([tank('Grabthar', 0, 0), tank('Borim', 10, 5)], UNITS);
    expect(out).toHaveLength(1);
    expect(out[0].tanks.sort()).toEqual(['Borim', 'Grabthar']);
  });

  it('a bridging player merges clusters — the conservative direction', () => {
    // Two tanks 40 apart form two clusters; a third player between them
    // reaches both. Single-linkage says one mob. Under-reporting is the
    // designed behavior: an honest merge is today's status quo, a phantom
    // split is a new lie.
    //
    // Names chosen so the SORTED processing order (Abe, Bob, Zed-the-bridge)
    // builds both endpoint clusters BEFORE the bridge arrives — otherwise the
    // merge branch never executes and this test would pass against a mutant
    // that drops it (caught in the 2026-08-05 mutation run).
    const out = _extPosCluster([tank('Abe', 0, 0), tank('Bob', 40, 0), tank('Zed', 20, 0)], UNITS);
    expect(out).toHaveLength(1);
    expect(out[0].tanks.sort()).toEqual(['Abe', 'Bob', 'Zed']);
  });

  it('uses 3D distance — a tank on a ledge above is not in the melee ball', () => {
    const out = _extPosCluster([tank('Floor', 0, 0, 0), { raider: 'Ledge', tank: 'Ledge', x: 0, y: 0, z: 80 }], UNITS);
    expect(out).toHaveLength(2);
  });

  it('a member with no coordinates folds by tank identity, then by size — never opens a cluster', () => {
    // The no-loc member is the non-Mimic tank an observer reported before the
    // type-5 loc forward covered them. They must not manufacture an instance.
    const noLoc = { raider: 'Borim', tank: 'Borim', x: undefined, y: undefined, z: undefined };
    const out = _extPosCluster([tank('Grabthar', 0, 0), tank('Borim', 100, 0), noLoc], UNITS);
    expect(out).toHaveLength(2);
    const borims = out.find(c => c.tanks.includes('Borim'));
    expect(borims.raiders, 'duplicate raider entries collapse').toEqual(['Borim']);

    const onlyNoLoc = _extPosCluster([noLoc], UNITS);
    expect(onlyNoLoc, 'a lone no-loc member is one (unlocatable) instance').toHaveLength(1);
  });

  it('is deterministic regardless of input order', () => {
    const a = _extPosCluster([tank('Zed', 0, 0), tank('Abe', 120, 0)], UNITS);
    const b = _extPosCluster([tank('Abe', 120, 0), tank('Zed', 0, 0)], UNITS);
    expect(a).toEqual(b);
  });
});

describe('heading modes — opt-in, and mode 1 can never phantom-split', () => {
  // The assumed convention (UNVERIFIED — the shadow log exists to check it):
  // heading 0 = +Y, clockwise, scale 512. h=128 → +X, h=256 → −Y, h=384 → −X.
  const t = (name, x, y, h) => ({ raider: name, tank: name, x, y, z: 0, h });

  it('projects along the assumed convention', () => {
    const p0 = _extHeadingPoint({ x: 0, y: 0, z: 0, h: 0 }, 10, 512);
    expect(p0.y).toBeCloseTo(10); expect(p0.x).toBeCloseTo(0);
    const p128 = _extHeadingPoint({ x: 0, y: 0, z: 0, h: 128 }, 10, 512);
    expect(p128.x).toBeCloseTo(10); expect(p128.y).toBeCloseTo(0);
    expect(_extHeadingPoint({ x: 0, y: 0, z: 0, h: null }, 10, 512)).toBeNull();
  });

  it('mode 0 (default) ignores headings entirely', () => {
    // Back-to-back on one spot: tank distance 6 → one cluster, headings unread.
    const out = _extPosCluster([t('Grabthar', 0, 0, 0), t('Borim', 0, -6, 256)], UNITS);
    expect(out).toHaveLength(1);
  });

  it('mode 1 MERGES the huge-hitbox case distance alone would split', () => {
    // Two tanks on opposite sides of one big mob, 30 apart, both FACING it —
    // projections meet in the middle. min(tank,proj) joins them. This is the
    // safe mode: it can only ever join more than mode 0.
    const facing = [t('Grabthar', 0, 0, 0), t('Borim', 0, 30, 256)];   // 0 faces +Y, 256 faces −Y
    expect(_extPosCluster(facing, UNITS)).toHaveLength(2);             // mode 0 splits at 30 > 25
    expect(_extPosCluster(facing, UNITS, { mode: 1, reach: 12, scale: 512 })).toHaveLength(1);
  });

  it('mode 1 NEVER splits what mode 0 joins — min() is join-only', () => {
    // Back-to-back stacked camp: tank distance 6 (joined today). Projections
    // diverge to ~30, but mode 1 takes min(6, 30) = 6 → still joined. The
    // phantom-split direction is structurally impossible in mode 1.
    const backToBack = [t('Grabthar', 0, 0, 0), t('Borim', 0, -6, 256)];
    expect(_extPosCluster(backToBack, UNITS, { mode: 1, reach: 12, scale: 512 })).toHaveLength(1);
  });

  it('mode 2 splits the back-to-back stacked camp mode 1 cannot', () => {
    // 0 faces +Y from (0,0) → mob at (0,12); 256 faces −Y from (0,-6) → mob at
    // (0,-18). Projected distance 30 > 25 → two instances from one camp spot.
    // This is the aggressive mode gated on the shadow log verifying the
    // convention — a wrong axis here WOULD phantom-split, which is why it
    // ships dark.
    const backToBack = [t('Grabthar', 0, 0, 0), t('Borim', 0, -6, 256)];
    expect(_extPosCluster(backToBack, UNITS, { mode: 2, reach: 12, scale: 512 })).toHaveLength(2);
  });

  it('a member with no heading falls back to tank distance in both modes', () => {
    const mixed = [t('Grabthar', 0, 0, null), t('Borim', 0, 30, 256)];
    expect(_extPosCluster(mixed, UNITS, { mode: 1, reach: 12, scale: 512 }),
      'no projection possible → mode 0 behavior').toHaveLength(2);
    expect(_extPosCluster(mixed, UNITS, { mode: 2, reach: 12, scale: 512 })).toHaveLength(2);
  });
});

describe('_extBindInstances — welding HP rows to position instances', () => {
  it('K=1: no position instances returns the INPUT — same references', () => {
    // The byte-identity guarantee starts here: nothing may touch the common
    // single-instance case, and same-reference is the strongest form of that.
    const clusters = [{ raiders: ['Grabthar'], hp: 62 }];
    expect(Object.is(_extBindInstances(clusters, []), clusters)).toBe(true);
    expect(Object.is(_extBindInstances(clusters, null), clusters)).toBe(true);
    expect(clusters[0].tanks, 'no fields added').toBeUndefined();
  });

  it('labels without splitting when HP already separated the instances', () => {
    // The 44%-vs-90% field case: HP is the workhorse, position adds the name.
    const rows = _extBindInstances(
      [{ raiders: ['Grabthar', 'Wiz'], hp: 44 }, { raiders: ['Borim'], hp: 90 }],
      [{ raiders: ['Grabthar'], tanks: ['Grabthar'] }, { raiders: ['Borim'], tanks: ['Borim'] }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].tanks).toEqual(['Grabthar']);
    expect(rows[1].tanks).toEqual(['Borim']);
    expect(rows.some(r => r.pos_split)).toBe(false);
  });

  it('SPLITS one equal-HP band that position proves is two mobs', () => {
    // Fresh double pull: both adds at 100%, tanked apart — the case HP can
    // never separate and the whole reason position exists as a separator.
    const rows = _extBindInstances(
      [{ raiders: ['Grabthar', 'Borim', 'Healer'], hp: 100 }],
      [{ raiders: ['Grabthar'], tanks: ['Grabthar'] }, { raiders: ['Borim'], tanks: ['Borim'] }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].tanks).toEqual(['Grabthar']);
    expect(rows[1].tanks).toEqual(['Borim']);
    // The healer has no engagement evidence — they stay on the first split
    // rather than vanishing from the board.
    expect(rows[0].raiders).toContain('Healer');
    expect(rows.every(r => r.pos_split)).toBe(true);
  });

  it('an HP cluster touching NO instance passes through unlabeled', () => {
    const c = { raiders: ['Wanderer'], hp: 75 };
    const rows = _extBindInstances([c],
      [{ raiders: ['Grabthar'], tanks: ['Grabthar'] }, { raiders: ['Borim'], tanks: ['Borim'] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tanks).toBeUndefined();
    expect(Object.is(rows[0], c), 'untouched cluster keeps its reference').toBe(true);
  });
});

describe('_extAttributeDebuffs — which one is slowed', () => {
  const mkRows = () => ([
    { raiders: ['Grabthar'], hp: 100, tanks: ['Grabthar'] },
    { raiders: ['Borim'],    hp: 61,  tanks: ['Borim'] },
  ]);

  it('K=1 leaves debuffs completely untouched', () => {
    const rows = [{ raiders: ['Grabthar'], hp: 62, debuffs: [{ name: 'Tashania' }] }];
    _extAttributeDebuffs([{ name: 'X', observers: [] }], rows, new Map(), 8);
    expect(rows[0].debuffs).toEqual([{ name: 'Tashania' }]);
  });

  it('rule 1: the observing TANK pins the debuff to their instance', () => {
    const rows = mkRows();
    _extAttributeDebuffs(
      [{ name: 'Turgur\'s Insects', remaining_secs: 300, observers: ['Borim'] }],
      rows, new Map(), 8);
    expect(rows[1].debuffs).toEqual([{ name: 'Turgur\'s Insects', remaining_secs: 300 }]);
    expect(rows[0].debuffs).toEqual([]);
  });

  it('rule 2: a casting observer whose target-HP matches ONE band pins it', () => {
    // The enchanter isn't in melee, but they target what they tash, and their
    // gauge says 61% — only one instance is at 61%.
    const rows = mkRows();
    const info = new Map([['enchanter', { targetsName: true, targetHp: 63 }]]);
    _extAttributeDebuffs([{ name: 'Tashania', remaining_secs: 200, observers: ['Enchanter'] }], rows, info, 8);
    expect(rows[1].debuffs.map(d => d.name)).toEqual(['Tashania']);
    expect(rows[0].debuffs).toEqual([]);
  });

  it('equal-HP instances defeat rule 2 — the debuff dims on BOTH rows', () => {
    // Both adds at 100%: the caster's gauge matches both bands, so asserting
    // either would be a guess. Wrong attribution is strictly worse than an
    // honest "one of these".
    const rows = [
      { raiders: ['Grabthar'], hp: 100, tanks: ['Grabthar'] },
      { raiders: ['Borim'],    hp: 100, tanks: ['Borim'] },
    ];
    const info = new Map([['enchanter', { targetsName: true, targetHp: 100 }]]);
    _extAttributeDebuffs([{ name: 'Tashania', remaining_secs: 200, observers: ['Enchanter'] }], rows, info, 8);
    for (const r of rows) {
      expect(r.debuffs).toEqual([{ name: 'Tashania', remaining_secs: 200, attributed: false }]);
    }
  });

  it('an unplaceable observer dims on every row rather than guessing', () => {
    const rows = mkRows();
    _extAttributeDebuffs([{ name: 'Malosini', remaining_secs: 90, observers: ['Bystander'] }], rows, new Map(), 8);
    for (const r of rows) expect(r.debuffs[0].attributed).toBe(false);
  });

  it('ANY of the landing\'s observers may place it — first success wins', () => {
    // The same landing reaches the bot once per nearby Mimic. A bystander
    // can't place it; the tank observer two entries later can.
    const rows = mkRows();
    _extAttributeDebuffs(
      [{ name: 'Cripple', remaining_secs: 150, observers: ['Bystander', 'Grabthar'] }],
      rows, new Map(), 8);
    expect(rows[0].debuffs.map(d => d.name)).toEqual(['Cripple']);
    expect(rows[1].debuffs).toEqual([]);
  });
});

// ── The Thall Va Xakra rehearsal — the whole chain on tomorrow's shape ──────
describe('two adds, same capitalized name, tanked apart', () => {
  it('fresh pull at equal HP: split, labeled, and the slow lands on the right one', () => {
    // Both adds at 100% (HP separates nothing), tanks 150 units apart. The
    // name is capitalized (no article) so the classifier calls it "unique" —
    // the handler now runs position clustering for npc names regardless, and
    // position is allowed to overrule the label (asserted on source below).
    const engaged = [tank('Grabthar', 0, 0), tank('Borim', 150, 0)];
    const inst = _extPosCluster(engaged, UNITS);
    expect(inst).toHaveLength(2);

    const rows = _extBindInstances([{ raiders: ['Grabthar', 'Borim'], hp: 100 }], inst);
    expect(rows).toHaveLength(2);

    const info = new Map([['sham', { targetsName: true, targetHp: 100 }]]);
    _extAttributeDebuffs(
      [{ name: 'Turgur\'s Insects', remaining_secs: 300, observers: ['Borim'] },
       { name: 'Tashania',          remaining_secs: 250, observers: ['Sham'] }],
      rows, info, 8);
    // The slow was observed by Borim (that add's tank) → pinned to Borim's add.
    const borimRow = rows.find(r => r.tanks.includes('Borim'));
    expect(borimRow.debuffs.map(d => d.name)).toContain('Turgur\'s Insects');
    // The tash caster couldn't be placed (equal HP) → dimmed on both, never
    // silently asserted on one.
    for (const r of rows) {
      const tash = r.debuffs.find(d => d.name === 'Tashania');
      expect(tash).toBeTruthy();
      expect(tash.attributed).toBe(false);
    }
  });
});

// ── The 4×4 — the tag-channel scenario, end to end ──────────────────────────
//
// "if we have 4 of the same mob and 4 tanks with zeal actively targeting each
// one 25+ units away we could perhaps serialize them by the tank that way"
// (Hitya 2026-08-05). Four tanks tag four same-name mobs in the tag
// channel; one Mimic harvests the claims; the bot serializes by tank. This
// runs the shipped clusterByHp + position + bind + attribution chain over
// exactly that shape.
describe('four same-name mobs, four tagging tanks', () => {
  // clusterByHp lives inline in the handler — slice it with its two deps.
  const { clusterByHp } = evalBlock(
    `const extHpSplitTol = 8;
     const median = (arr) => {
       if (!arr.length) return null;
       const s2 = [...arr].sort((a, b) => a - b); const m2 = Math.floor(s2.length / 2);
       return s2.length % 2 ? s2[m2] : Math.round((s2[m2 - 1] + s2[m2]) / 2);
     };
    ` + sliceBlock(src, 'const clusterByHp = (obs) => {', '\n    };'),
    ['clusterByHp'],
  );

  it('serializes all four by tank: distinct HP bands + distinct camps', () => {
    // Tag claims carried as pseudo-observations: each tank "targets" their mob
    // at the HP their tag reported.
    const obs = [
      { raider: 'Grabthar', hp: 100 }, { raider: 'Borim', hp: 74 },
      { raider: 'Cyra', hp: 51 },      { raider: 'Dolm', hp: 25 },
    ];
    const hpClusters = clusterByHp(obs);
    expect(hpClusters).toHaveLength(4);

    const engaged = [
      tank('Grabthar', 0, 0), tank('Borim', 60, 0),
      tank('Cyra', 0, 60),    tank('Dolm', 60, 60),
    ];
    const inst = _extPosCluster(engaged, UNITS);
    expect(inst).toHaveLength(4);

    const rows = _extBindInstances(hpClusters, inst);
    expect(rows).toHaveLength(4);
    for (const [tk, hp] of [['Grabthar', 100], ['Borim', 74], ['Cyra', 51], ['Dolm', 25]]) {
      const row = rows.find(r => (r.tanks || []).includes(tk));
      expect(row, tk + ' has a row').toBeTruthy();
      expect(row.hp, tk + "'s row keeps their tagged HP").toBe(hp);
    }

    // The slow cast by Cyra's group lands on Cyra's mob — the observing tank
    // pins it, and no other row inherits it.
    _extAttributeDebuffs(
      [{ name: "Turgur's Insects", remaining_secs: 300, observers: ['Cyra'] }],
      rows, new Map(), 8);
    expect(rows.find(r => r.tanks.includes('Cyra')).debuffs.map(d => d.name)).toEqual(["Turgur's Insects"]);
    expect(rows.filter(r => !r.tanks.includes('Cyra')).every(r => r.debuffs.length === 0)).toBe(true);
  });

  it('four tags at EQUAL HP still serialize when the camps are apart', () => {
    // Fresh quad pull, all at 100% — HP separates nothing; the camps do, and
    // the tag identities label them.
    const hpClusters = clusterByHp([
      { raider: 'Grabthar', hp: 100 }, { raider: 'Borim', hp: 100 },
      { raider: 'Cyra', hp: 100 },     { raider: 'Dolm', hp: 100 },
    ]);
    expect(hpClusters).toHaveLength(1);
    const inst = _extPosCluster([
      tank('Grabthar', 0, 0), tank('Borim', 60, 0),
      tank('Cyra', 0, 60),    tank('Dolm', 60, 60),
    ], UNITS);
    const rows = _extBindInstances(hpClusters, inst);
    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.tanks[0]).sort()).toEqual(['Borim', 'Cyra', 'Dolm', 'Grabthar']);
  });

  it('the honest limit: four tags on ONE piled-up camp stay merged', () => {
    // Tags give identity, not geometry. Four tanks stacked on one spot at one
    // HP is still one row — the ceiling, stated rather than papered over.
    const hpClusters = clusterByHp([
      { raider: 'Grabthar', hp: 100 }, { raider: 'Borim', hp: 100 },
      { raider: 'Cyra', hp: 100 },     { raider: 'Dolm', hp: 100 },
    ]);
    const inst = _extPosCluster([
      tank('Grabthar', 0, 0), tank('Borim', 5, 0), tank('Cyra', 0, 5), tank('Dolm', 5, 5),
    ], UNITS);
    expect(inst).toHaveLength(1);
    expect(_extBindInstances(hpClusters, inst)).toHaveLength(1);
  });
});

describe('Zeal /tag integration (spawn ids through chat)', () => {
  it('tags index is freshness-gated and newest-per-spawn-id', () => {
    // Assert the SHAPE and a lower BOUND, never the literal number — pinning
    // 120 is what made this test wrong the moment the TTL was raised, and the
    // number is a tuning decision, not a contract.
    const m = src.match(/const extTagFreshMs = tn\('ext_tag_fresh_sec', (\d+)\) \* 1000;/);
    expect(m, 'tag index must stay freshness-gated via ext_tag_fresh_sec').toBeTruthy();
    expect(Number(m[1]), 'default must outlast a 5-10 min boss fight — a tag is a fight-long mark')
      .toBeGreaterThanOrEqual(300);
    expect(src).toMatch(/if \(!prev \|\| sinceMs > prev\.sinceMs\)/);
  });

  it('a tag welds ONLY when its text names the row tank — no guessed pinning', () => {
    expect(src).toMatch(/const target = rows\.find\(c => !c\._tag && \(c\.tanks \|\| \[\]\)\.some\(t2 =>/);
    expect(src).toMatch(/textLower\.includes\(String\(t2\)\.toLowerCase\(\)\)/);
  });

  it('the single-tag-single-row case welds without a text match', () => {
    expect(src).toMatch(/if \(unwelded\.length === 1 && rows\.length === 1 && !rows\[0\]\._tag\)/);
  });

  it('unwelded tags pool on the FIRST row only — never duplicated per row', () => {
    expect(src).toMatch(/\.\.\.\(idx === 0 && tagPool\.length \? \{ tag_pool: tagPool\.slice\(0, 8\) \} : \{\}\)/);
  });

  it('ingest sanitizes shape to the Zeal set and requires a positive spawn id', () => {
    expect(src).toMatch(/\/\^\[ROYGBWPS\]\$\/\.test\(t\.shape\)/);
    expect(src).toMatch(/\.filter\(t => t\.spawn_id > 0 && t\.mob && t\.since\)/);
  });

  it('the bundle selects zeal_tags and the shadow log records K_tags', () => {
    expect(src).toMatch(/observed_tanks,zeal_tags,updated_at/);
    expect(src).toMatch(/K_tags=\$\{\(tagsByName\.get\(g\.key\) \|\| new Map\(\)\)\.size\}/);
  });
});

describe('tag plumbing through the handler', () => {
  it('engaged tanks become pseudo-observations (mob surfaces, HP band opens)', () => {
    expect(src).toMatch(/g\.obs\.push\(\{ raider: m\.raider, hp: m\.hp != null \? m\.hp : null \}\)/);
    expect(src, 'a missing group is created from the engagement evidence')
      .toMatch(/g = \{ name: m\.mobDisplay \|\| mobKey, key: mobKey, obs: \[\] \}; byName\.set\(mobKey, g\);/);
  });

  it('ingest clamps a tag hp to 0-100', () => {
    expect(src).toMatch(/hp: Math\.max\(0, Math\.min\(100, Math\.trunc\(Number\(ot\.hp\)\)\)\)/);
  });
});

// ── Handler wiring that the slices can't see ────────────────────────────────
describe('handler wiring', () => {
  it('position clustering runs for CAPITALIZED npc names too', () => {
    // Thall Va Xakra's adds carry a capitalized, article-less name that
    // classify() calls unique — clustering must not be gated on `ambiguous`.
    const stanza = src.slice(src.indexOf('const engaged = engagedByMob.get(g.key)'));
    expect(src).toMatch(/const engaged = engagedByMob\.get\(g\.key\) \|\| \[\];/);
    expect(stanza.slice(0, 200), 'must not require cls.ambiguous').not.toMatch(/cls\.ambiguous\s*&&/);
  });

  it('tank labels only ship at K≥2 — the K=1 payload keeps its exact shape', () => {
    expect(src).toMatch(/\.\.\.\(multi && c\.tanks && c\.tanks\.length \? \{ tanks: c\.tanks\.slice\(0, 4\) \} : \{\}\)/);
  });

  it('the select carries loc + observed_tanks, and the roster loc ride-along exists', () => {
    expect(src).toMatch(/incoming_mob,incoming_mob_since,loc_x,loc_y,loc_z,observed_tanks,zeal_tags,updated_at/);
    expect(src).toMatch(/supabase\.select\('raid_roster',[\s\S]{0,200}loc_at=gte\./);
  });

  it('a pos-split row recomputes HP from its own raiders', () => {
    // Without this both splits of one band would show the merged median.
    expect(src).toMatch(/if \(!c\.pos_split\) continue;/);
  });

  it('observed_tanks entries are re-filtered to player-shaped names bot-side', () => {
    // The agent filters too, but the bot must not trust the wire.
    expect(src).toMatch(/if \(!\/\^\[A-Za-z\]\+\$\/\.test\(String\(ot\.tank\)\)\) continue;/);
  });

  it('the officer kill switch exists (flag_ext_pos_off via tuning)', () => {
    expect(src).toMatch(/tn\('flag_ext_pos_off', 0\) === 1/);
  });

  it('roster loc rows are gated on loc_at freshness, never captured_at', () => {
    expect(src).toMatch(/const locMs = rr\.loc_at \? Date\.parse\(rr\.loc_at\) : 0;/);
    expect(src).toMatch(/if \(!locMs \|\| \(now - locMs\) > extPosFreshMs\) continue;/);
  });
});
