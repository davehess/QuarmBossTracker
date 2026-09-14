// Target of target off the Zeal pipe — the consumer side of the drafted
// upstream change (docs/zeal-tot-pipe.patch). Hitya, 2026-09-12: "Make a spot
// in mimic beta for those to get exposed in extended target overlay."
//
// The keys are ABSENT on every released Zeal, so the whole path must be a
// no-op without them and must never require them. Three hops, each pinned:
//   Mimic main.js   — sanitizes {id, name, authoritative}; a 0 id is "none".
//   agent           — folds the answer into observed_tanks (raid-wide via the
//                     bot) and patches the row that IS my target (local).
//   extarget.html   — marks where the answer came from.
// The pure functions run for real; the wiring is checked over stripped source.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const main  = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8');
const agent = readSource(AGENT_INDEX);
const overlay = stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8'));

const { _pipeSpawnId, _pipeCandidate } = evalBlock(
  sliceBlock(main, 'function _pipeSpawnId(v) {', '\n  return { id, name, authoritative: v.authoritative === true };\n}'),
  ['_pipeSpawnId', '_pipeCandidate'],
);
const { _pipeCandidateOf, _pipeTotObservedTank, _attachPipeTotToExtRows } = evalBlock(
  sliceBlock(agent, 'function _pipeCandidateOf(st, key) {', '\n    return { ...t, ...patch };\n  });\n}'),
  ['_pipeCandidateOf', '_pipeTotObservedTank', '_attachPipeTotToExtRows'],
);

describe('Mimic edge: ids and candidates off the pipe', () => {
  it('a 0 or missing id is "no target", never spawn zero (the open 3.1.123 twin)', () => {
    expect(_pipeSpawnId(0)).toBeNull();
    expect(_pipeSpawnId(-3)).toBeNull();
    expect(_pipeSpawnId(undefined)).toBeNull();
    expect(_pipeSpawnId('x')).toBeNull();
    expect(_pipeSpawnId(4425)).toBe(4425);
    expect(_pipeSpawnId('4425')).toBeNull();   // the pipe emits numbers; a string is junk
  });

  it('a candidate needs a positive id and a name; authoritative is strictly boolean true', () => {
    expect(_pipeCandidate({ id: 12, name: 'Currygoat', authoritative: true })).toEqual({ id: 12, name: 'Currygoat', authoritative: true });
    expect(_pipeCandidate({ id: 12, name: '  Currygoat ' })).toEqual({ id: 12, name: 'Currygoat', authoritative: false });
    expect(_pipeCandidate({ id: 12, name: 'x', authoritative: 'yes' }).authoritative).toBe(false);
    expect(_pipeCandidate({ id: 0, name: 'Currygoat' })).toBeNull();
    expect(_pipeCandidate({ id: 12 })).toBeNull();
    expect(_pipeCandidate(null)).toBeNull();
    expect(_pipeCandidate('Currygoat')).toBeNull();
    expect(_pipeCandidate({ id: 12, name: 'a'.repeat(200) }).name).toHaveLength(64);
  });

  it('the type-3 reads go through the helpers, and both new keys are assigned unconditionally', () => {
    const m = stripJs(main);
    expect(m).toContain('s.spawn_id  = _pipeSpawnId(inner.spawn_id);');
    expect(m).toContain('s.target_id = _pipeSpawnId(inner.target_id);');
    expect(m).toContain('s.pet_id    = _pipeSpawnId(inner.pet_id);');
    expect(m).toContain('s.target_of_target = _pipeCandidate(inner.target_of_target);');
    expect(m).toContain('s.target_hit_by    = _pipeCandidate(inner.target_hit_by);');
    expect(m).not.toMatch(/Number\.isFinite\(inner\.target_id\) \? inner\.target_id/);
  });
});

describe('agent: observed_tanks gets the pipe answer', () => {
  const NOW = 10_000_000;
  const st = { target_name: 'a cliff golem', updatedAt: NOW - 1000,
               target_of_target: { id: 77, name: 'Currygoat', authoritative: true } };

  it('emits a mob→tank connect for MY target, stamped authoritative', () => {
    expect(_pipeTotObservedTank(st, NOW)).toEqual({
      mob: 'a cliff golem', tank: 'Currygoat', since: new Date(NOW - 1000).toISOString(), authoritative: true,
    });
  });
  it('nothing without a target name, without a candidate, when stale, or when the candidate is not a player', () => {
    expect(_pipeTotObservedTank({ ...st, target_name: null }, NOW)).toBeNull();
    expect(_pipeTotObservedTank({ ...st, target_of_target: null }, NOW)).toBeNull();
    expect(_pipeTotObservedTank({ ...st, updatedAt: NOW - 31_000 }, NOW)).toBeNull();
    expect(_pipeTotObservedTank({ ...st, target_of_target: { id: 5, name: 'a rat pet', authoritative: false } }, NOW)).toBeNull();
    expect(_pipeTotObservedTank(null, NOW)).toBeNull();
  });
  it('is wired into the live-state observed_tanks list, deduped on the same key', () => {
    const a = stripJs(agent);
    expect(a).toMatch(/const pipeTank = _pipeTotObservedTank\(st, now\);/);
    expect(a).toMatch(/if \(!seen\.has\(pk\)\) seen\.set\(pk, pipeTank\);/);
    expect(a).toMatch(/target_of_target: _pipeCandidateOf\(st, 'target_of_target'\),/);
    expect(a).toMatch(/target_hit_by:\s+_pipeCandidateOf\(st, 'target_hit_by'\),/);
  });
});

describe('agent: the row that IS my target gets my own answer', () => {
  const NOW = 10_000_000;
  const rows = [
    { name: 'a cliff golem', kind: 'npc', spawn_id: 4425, mob_victim: 'Hoden' },   // log said Hoden
    { name: 'a cliff golem', kind: 'npc', spawn_id: 4471 },                       // same name, other instance
    { name: 'a cliff golem', kind: 'npc', stale: true },
    { name: 'Currygoat', kind: 'player' },
  ];
  const self = { target_name: 'a cliff golem', target_id: 4425, updatedAt: NOW - 500,
                 target_of_target: { id: 77, name: 'Currygoat', authoritative: true },
                 target_hit_by:    { id: 91, name: 'Fawx', authoritative: false } };

  it('patches only the matching instance; the pipe overrides the log inference', () => {
    const out = _attachPipeTotToExtRows(rows, self, NOW);
    expect(out[0]).toMatchObject({ mob_victim: 'Currygoat', mob_victim_source: 'zeal_assist', mob_hit_by: 'Fawx', mob_hit_by_source: 'zeal_damage' });
    expect(out[1]).toEqual(rows[1]);   // other spawn id → untouched
    expect(out[2]).toEqual(rows[2]);   // stale → untouched
    expect(out[3]).toEqual(rows[3]);   // not an npc → untouched
  });
  it('falls back to the name when either side has no spawn id', () => {
    const out = _attachPipeTotToExtRows(rows, { ...self, target_id: null }, NOW);
    expect(out[0].mob_victim).toBe('Currygoat');
    expect(out[1].mob_victim).toBe('Currygoat');   // name-only: both instances, honestly
  });
  it('is a no-op without candidates, without a target name, or when my state is stale', () => {
    expect(_attachPipeTotToExtRows(rows, { ...self, target_of_target: null, target_hit_by: null }, NOW)).toBe(rows);
    expect(_attachPipeTotToExtRows(rows, { ...self, target_name: '' }, NOW)).toBe(rows);
    expect(_attachPipeTotToExtRows(rows, { ...self, updatedAt: NOW - 61_000 }, NOW)).toBe(rows);
    expect(_attachPipeTotToExtRows(rows, null, NOW)).toBe(rows);
  });
  it('runs in the proxy AFTER the V2 log inference, on the hoisted self state', () => {
    const a = stripJs(agent);
    const v2 = a.indexOf('outPayload = _enrichExtTargetV2(outPayload, Date.now());');
    const tot = a.indexOf('_attachPipeTotToExtRows(outPayload.targets, selfSt, Date.now())');
    expect(v2).toBeGreaterThan(-1);
    expect(tot).toBeGreaterThan(v2);
    // selfSt is declared OUTSIDE the #128 try so the later call can see it.
    const decl = a.lastIndexOf('let selfSt = null;', tot);
    const tryAt = a.indexOf('try {', decl);
    expect(decl).toBeGreaterThan(-1);
    expect(tryAt).toBeGreaterThan(decl);
  });
});

describe('overlay: marks where the answer came from', () => {
  it('🎯 for the server reply, → otherwise, and a ⚔ last-hitter', () => {
    expect(overlay).toContain("var vsrc = t.mob_victim_source || 'log';");
    expect(overlay).toMatch(/vsrc === 'zeal_assist' \? '🎯' : '→'/);
    expect(overlay).toMatch(/if \(t\.mob_hit_by\) \{/);
    expect(overlay).toMatch(/class="hitby"/);
    expect(overlay).toMatch(/\.row \.mobx \.vic\.auth\{color:#7ee787\}/);
  });
});
