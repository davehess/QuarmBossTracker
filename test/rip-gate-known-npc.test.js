// The require_raid_member gate outside a raid (the guild lead, 2026-10-05: "earlier we had a RIP
// callout on one of the wolf named mobs in Bastion of THunder that has a single name").
//
// "Death touch — RIP" captures a one-word victim from "<Name> has been slain by …" and asks for a
// raid member. With no raid roster the gate fell open, so grouping in Bastion of Thunder a named
// mob with a one-word name was called "Rest in Peace". Now, out of a raid, a known NPC that is not
// a known player is suppressed; anything unknown still falls open. The gate and its helpers run
// here sliced from the shipped source, so a comment cannot satisfy these.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const helpers = sliceBlock(src, 'function _knownPlayerName(nameLower) {',
  'k.startsWith(prefix)) return true; }\n  return false;\n}');
const gate = sliceBlock(src, '  {\n    const inRaid = _raidRosterMembers.size > 0;',
  '\n        return;\n      }\n    }\n  }');

function build({ roster = [], who = [], zeal = {}, group = null, pack = {}, info = [], pets = [] } = {}) {
  const env = { timers: 0, journal: [] };
  const fn = new Function('env', `
    const _raidRosterMembers = new Set(${JSON.stringify(roster)});
    function _raidRosterHas(n) { return _raidRosterMembers.has(String(n).toLowerCase()); }
    const _pets = new Set(${JSON.stringify(pets)});
    function _isOurPetName(n) { return _pets.has(n); }
    const whoData = new Map(${JSON.stringify(who)}.map(n => [n, { name: n }]));
    const _zealState = ${JSON.stringify(zeal)};
    const _zeal = { lastSamples: ${group ? JSON.stringify({ 6: { at: Date.now(), obj: { data: JSON.stringify(group) } } }) : '{}'} };
    const _pack = ${JSON.stringify(pack)};
    function _mobPackLookup(name, z) { const m = _pack[z]; return (m && m[String(name).toLowerCase()]) || null; }
    function _normMobNameAgent(n) { return String(n || '').trim().toLowerCase().replace(/[\\s\`'’]+/g, '_'); }
    const _mobInfoByName = new Map(${JSON.stringify(info)});
    const TJ = { GATES: 'gates' };
    function _startTimer() { env.timers++; }
    function _journalTrigger(j) { env.journal.push(j); }
    ${helpers}
    return function fire(t, captures, test, tsMs) {
      ${gate}
      return 'fired';
    };
  `);
  const fire = fn(env);
  return { fire, env };
}

const RIP = { name: 'Death touch — RIP', _scope: 'guild', _noJournal: false,
  actions: [{ type: 'text_overlay', text: 'RIP {victim}', require_raid_member: 'victim' }] };
const BOT = { zone: 209 };   // Bastion of Thunder
const WOLF_PACK = { 209: { gaukr: { name: 'Gaukr' } } };

describe('RIP gate outside a raid', () => {
  it('a one-word named mob in our zone pack is not called RIP', () => {
    const { fire, env } = build({ zeal: { Aldenmar: BOT }, pack: WOLF_PACK });
    expect(fire(RIP, { victim: 'Gaukr' })).toBeUndefined();
    expect(env.journal[0].reason).toMatch(/Gaukr a known NPC/);
  });

  it('a mob Target Info already resolved is not called RIP either', () => {
    const { fire } = build({ zeal: { Aldenmar: BOT }, info: [['gaukr|209|gaukr', { at: 1, mob: { name: 'Gaukr' } }]] });
    expect(fire(RIP, { victim: 'Gaukr' })).toBeUndefined();
  });

  it('a Target Info miss (mob: null) proves nothing', () => {
    const { fire } = build({ zeal: { Aldenmar: BOT }, info: [['brackwyn|209|brackwyn', { at: 1, mob: null }]] });
    expect(fire(RIP, { victim: 'Brackwyn' })).toBe('fired');
  });

  it('an unknown name still falls open (out-of-raid testing keeps firing)', () => {
    const { fire } = build({ zeal: { Aldenmar: BOT }, pack: WOLF_PACK });
    expect(fire(RIP, { victim: 'Corvale' })).toBe('fired');
  });

  it('a groupmate, a /who sighting, our own character or our pet always passes, even if a mob shares the name', () => {
    const pack = { 209: { brackwyn: {}, corvale: {}, aldenmar: {}, rethlan: {} } };
    const zeal = { Aldenmar: BOT };
    expect(build({ zeal, pack, group: [{ name: 'Brackwyn' }] }).fire(RIP, { victim: 'Brackwyn' })).toBe('fired');
    expect(build({ zeal, pack, who: ['corvale'] }).fire(RIP, { victim: 'Corvale' })).toBe('fired');
    expect(build({ zeal, pack }).fire(RIP, { victim: 'Aldenmar' })).toBe('fired');
    expect(build({ zeal, pack, pets: ['rethlan'] }).fire(RIP, { victim: 'Rethlan' })).toBe('fired');
  });

  it('a timer-bearing trigger still arms on the suppressed fire, like the in-raid rule', () => {
    const CD = { ...RIP, name: 'Stampede — countdown', timer_duration_sec: 120 };
    const { fire, env } = build({ zeal: { Aldenmar: BOT }, pack: WOLF_PACK });
    expect(fire(CD, { victim: 'Gaukr' })).toBeUndefined();
    expect(env.timers).toBe(1);
  });
});

describe('RIP gate inside a raid is unchanged', () => {
  it('a raid member passes and a non-member is suppressed', () => {
    const { fire, env } = build({ roster: ['nyssara'] });
    expect(fire(RIP, { victim: 'Nyssara' })).toBe('fired');
    expect(fire(RIP, { victim: 'Zarrin' })).toBeUndefined();
    expect(env.journal[0].reason).toMatch(/Zarrin not a raid member/);
  });

  it('our pet passes in a raid', () => {
    const { fire } = build({ roster: ['nyssara'], pets: ['rethlan'] });
    expect(fire(RIP, { victim: 'Rethlan' })).toBe('fired');
  });
});

// A Death Touch COUNTDOWN is a claim that a raider was death-touched (the guild lead, 2026-10-21: a
// purple "Death Touch — <pet>" card appeared when a cleric's pet destroyed itself). The shipped
// pattern is "<X> hit <target> for 15000+ points of non-melee damage".
const DT_CD = { name: 'Death touch — countdown', _scope: 'guild', _noJournal: false, timer_duration_sec: 120,
  actions: [{ type: 'text_overlay', text: 'DEATH TOUCH on {target}', require_raid_member: 'target' }] };
const dt = (hitter, target) => ({ '1': hitter, target });

describe('Death Touch countdown is for raiders only', () => {
  it('a real Death Touch on a raider still arms and fires', () => {
    const { fire, env } = build({ roster: ['nyssara'] });
    expect(fire(DT_CD, dt('Va Dyn Khar', 'Nyssara'))).toBe('fired');
    expect(env.journal).toEqual([]);
  });

  it('a pet destroying itself never arms or fires (several log shapes)', () => {
    for (const [hitter, target] of [['Zekn', 'Zekn'], ['#Zekn', 'Zekn'], ['zekn', 'ZEKN']]) {
      const { fire, env } = build({ roster: ['nyssara'] });
      expect(fire(DT_CD, dt(hitter, target))).toBeUndefined();
      expect(env.timers).toBe(0);
    }
  });

  it('another raider\'s pet (not in the roster) arms nothing, whoever hit it', () => {
    const { fire, env } = build({ roster: ['nyssara'] });
    expect(fire(DT_CD, dt('A Hobgoblin Shaman', 'Zekn'))).toBeUndefined();
    expect(env.timers).toBe(0);
  });

  it('our own pet arms nothing, even in a raid or with an empty roster', () => {
    expect(build({ roster: ['nyssara'], pets: ['zekn'] }).fire(DT_CD, dt('A Hobgoblin', 'Zekn'))).toBeUndefined();
    const { fire, env } = build({ pets: ['zekn'] });
    expect(fire(DT_CD, dt('Zekn', 'Zekn'))).toBeUndefined();
    expect(env.timers).toBe(0);
  });

  it('a self-hit by a raider-named capture is also dropped', () => {
    const { fire } = build({ roster: ['nyssara'] });
    expect(fire(DT_CD, dt('Nyssara', 'Nyssara'))).toBeUndefined();
  });

  it('the RIP callout (no timer) keeps its own rules', () => {
    const { fire } = build({ roster: ['nyssara'], pets: ['rethlan'] });
    expect(fire(RIP, { victim: 'Rethlan' })).toBe('fired');
  });
});
