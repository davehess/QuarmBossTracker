// #194 — two mobs with one name, told apart by where their tanks stand.
//
// THE ASK (Uilnayar 2026-08-04): "having zero traction on the [Zeal spawn_id]
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
const { _extPosCluster, _extBindInstances, _extAttributeDebuffs } = evalBlock(
  sliceBlock(src, 'function _extPosCluster(engaged, units) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extBindInstances(hpClusters, posInstances) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extAttributeDebuffs(debuffEntries, rows, observerInfo, hpTol) {', '\n}'),
  ['_extPosCluster', '_extBindInstances', '_extAttributeDebuffs'],
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
    expect(src).toMatch(/incoming_mob,incoming_mob_since,loc_x,loc_y,loc_z,observed_tanks,updated_at/);
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
