// test/mob-hit-types.test.js — Target Info shows how a mob hits (the guild lead, 2026-10-14).
//
// "when we observe what types of hits a mob is doing, put that onto the target info (slashing / piercing
// / etc)". The agent runs for real: real-shaped log lines go through shouldKeep + parseEvent (so the
// miss lines prove they keep their verb) and then the real noteMobMelee tally; mobHitTypesFor is what
// buildMobInfo hands the overlay as `target_hits`.
//
// Names are invented fixtures (see CLAUDE.md): Aldenmar and Brackwyn are the raiders, Jareker a pet.
//
// Run: npx vitest run test/mob-hit-types.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
beforeEach(() => {
  agent._resetMobHitTypesForTest();
  for (const c of ['Aldenmar', 'Brackwyn']) agent._setZealStateForTest(c, null);
  agent._applyPetOwnersResponse({ owners: {} });
});

// Feed one log line through the same two steps the live tail takes.
const STAMP = '[Wed Oct 14 20:15:01 2026] ';
function feed(body, character = 'Aldenmar') {
  const line = STAMP + body;
  if (!agent.shouldKeep(line, agent.DEFAULT_DROP_PATTERNS, agent.KEEP_PATTERNS)) return null;
  const ev = agent.parseEvent(line, agent.parseEqTimestamp(line));
  if (ev) agent.noteMobMelee(ev, character);
  return ev;
}

describe('the verb → type table', () => {
  it('slash / pierce / blunt, the way EQ names them', () => {
    const slash  = ['slash', 'slice', 'claw', 'rend'];
    const pierce = ['pierce', 'stab', 'bite', 'gore', 'sting', 'backstab'];
    const blunt  = ['crush', 'bash', 'punch', 'kick', 'hit', 'maul', 'smash', 'strike'];
    for (const v of slash)  expect(agent.mobHitType(v), v).toBe('slash');
    for (const v of pierce) expect(agent.mobHitType(v), v).toBe('pierce');
    for (const v of blunt)  expect(agent.mobHitType(v), v).toBe('blunt');
  });
  it('the ranged verbs and non-swings are no melee type', () => {
    for (const v of ['shoot', 'fire', 'throw', 'dot', 'non-melee', '', null]) expect(agent.mobHitType(v), String(v)).toBeNull();
  });
  it('the plural log forms come out of the parser as these base verbs', () => {
    const verbs = ['slashes', 'pierces', 'crushes', 'bashes', 'punches', 'kicks', 'hits', 'bites', 'claws', 'gores',
      'mauls', 'stings', 'smashes', 'strikes', 'slices', 'rends', 'stabs', 'backstabs'];
    for (const v of verbs) {
      const ev = agent.parseEvent(`${STAMP}A gnoll pup ${v} YOU for 10 points of damage.`, null);
      expect(ev && ev.type, v).toBe('damage');
      expect(agent.mobHitType(ev.ability), v).not.toBeNull();
    }
  });
});

describe('the tally', () => {
  it('counts a mob\'s swings on YOU and on others by type, with the verbs and the biggest hit per type', () => {
    feed('A gnoll pup slashes YOU for 12 points of damage.');
    feed('A gnoll pup slashes Brackwyn for 30 points of damage.');
    feed('A gnoll pup slashes YOU for 7 points of damage.');
    feed('A gnoll pup bites YOU for 20 points of damage.');
    const h = agent.mobHitTypesFor('a gnoll pup');
    expect(h).toMatchObject({ seen: 4, slash: 3, pierce: 1, blunt: 0 });
    expect(h.max).toEqual({ slash: 30, pierce: 20 });
    expect(h.verbs).toEqual({ slash: 3, bite: 1 });
  });

  it('a MISS counts, and so does a dodge or a parry — the verb is the swing', () => {
    expect(feed('A gnoll pup tries to slash YOU, but misses!')).toMatchObject({ type: 'avoid', verb: 'slash', kind: 'miss' });
    feed('A gnoll pup tries to pierce YOU, but YOU dodge!');
    feed('A gnoll pup tries to crush Brackwyn, but Brackwyn parries!');
    const h = agent.mobHitTypesFor('a gnoll pup');
    expect(h).toMatchObject({ seen: 3, slash: 1, pierce: 1, blunt: 1 });
    expect(h.max).toEqual({});                       // a miss has no damage to be the biggest of
  });

  it('a one-word named mob is a mob when it hits YOU', () => {
    feed('Vox crushes YOU for 800 points of damage.');
    expect(agent.mobHitTypesFor('Vox')).toMatchObject({ seen: 1, blunt: 1 });
  });

  it('the log\'s capitalised sentence start and Zeal\'s lowercase name are one mob', () => {
    feed('A gnoll pup slashes YOU for 12 points of damage.');
    expect(agent.mobHitTypesFor('a gnoll pup')).not.toBeNull();
    expect(agent.mobHitTypesFor('a gnoll pup\'s corpse')).not.toBeNull();   // looting the corpse still shows it
    expect(agent.mobHitTypesFor('a gnoll elder')).toBeNull();
  });

  it('nothing observed → null, so the overlay draws nothing', () => {
    expect(agent.mobHitTypesFor('a gnoll pup')).toBeNull();
    expect(agent.mobHitTypesFor('')).toBeNull();
  });
});

describe('what does NOT count', () => {
  it('a player\'s swings on the mob — "You" and a third-person raider alike', () => {
    feed('You slash a gnoll pup for 120 points of damage.');
    feed('You try to pierce a gnoll pup, but a gnoll pup dodges!');
    feed('Brackwyn crushes a gnoll pup for 90 points of damage.');
    feed('Brackwyn tries to slash a gnoll pup, but misses!');
    expect(agent.mobHitTypesFor('a gnoll pup')).toBeNull();
    expect(agent.mobHitTypesFor('Brackwyn')).toBeNull();
    expect(agent.mobHitTypesFor('Aldenmar')).toBeNull();
  });

  it('a player who swings at YOU (PvP) is no mob, once we know them as a player', () => {
    agent._setZealStateForTest('Brackwyn', { updatedAt: Date.now() });
    feed('Brackwyn slashes YOU for 50 points of damage.');
    expect(agent.mobHitTypesFor('Brackwyn')).toBeNull();
  });

  it('a PET\'s hits are not the mob\'s — ours (Zeal slot 16) and one the guild declared — even on a player', () => {
    agent._setZealStateForTest('Brackwyn', { updatedAt: Date.now(), gauges: [{ slot: 16, text: 'Jareker' }] });
    feed('Jareker slashes YOU for 30 points of damage.');
    feed('Jareker tries to slash YOU, but misses!');
    expect(agent.mobHitTypesFor('Jareker')).toBeNull();
    agent._applyPetOwnersResponse({ owners: { gobeker: 'Zarrin' } });
    feed('Gobeker bites YOU for 20 points of damage.');
    expect(agent.mobHitTypesFor('Gobeker')).toBeNull();
  });

  it('damage shields, spells and procs worded as a swing', () => {
    feed('A gnoll pup was hit by non-melee for 14 points of damage.');
    feed('A gnoll pup was pierced by thorns.');
    feed('A gnoll pup hit YOU for 300 points of non-melee damage.');
    feed('A gnoll pup\'s Stone Gale hits YOU for 1500 points of non-melee damage.');
    expect(agent.mobHitTypesFor('a gnoll pup')).toBeNull();
  });

  it('a verb with no melee type (a ranged shot) is skipped, not guessed', () => {
    feed('A gnoll archer shoots YOU for 40 points of damage.');
    expect(agent.mobHitTypesFor('a gnoll archer')).toBeNull();
  });
});

describe('bounded', () => {
  it('past the cap the least recently touched mob goes first', () => {
    const cap = agent.MOB_HIT_TYPES_MAX;
    feed('A first mob slashes YOU for 5 points of damage.');
    for (let i = 0; i < cap; i++) feed(`A filler mob ${i} slashes YOU for 5 points of damage.`);
    expect(agent.mobHitTypesFor('a first mob')).toBeNull();          // evicted
    expect(agent.mobHitTypesFor(`a filler mob ${cap - 1}`)).not.toBeNull();
    feed('A filler mob 0 slashes YOU for 5 points of damage.');      // touched: now the newest
    feed('A late mob slashes YOU for 5 points of damage.');
    expect(agent.mobHitTypesFor('a filler mob 0')).not.toBeNull();
    expect(agent.mobHitTypesFor('a filler mob 1')).toBeNull();
  });
});

describe('the chip on Target Info (mobinfo.html, the real hitsChip)', () => {
  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
  const { hitsChip } = evalBlock(
    `function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }\n`
    + sliceBlock(html, '  function hitsChip(h){', '\n  // ── DOM handles + tab state '),
    ['hitsChip'],
  );

  it('reads "Hits: Slash 63% · Pierce 38% (seen 8)" from the agent\'s own tally, biggest first', () => {
    for (let i = 0; i < 5; i++) feed('A gnoll pup slashes YOU for 12 points of damage.');
    for (let i = 0; i < 3; i++) feed('A gnoll pup tries to bite YOU, but misses!');
    const out = hitsChip(agent.mobHitTypesFor('a gnoll pup'));
    expect(out).toContain('Hits: Slash 63% · Pierce 38% (seen 8)');
    expect(out).toContain('class="chip hits"');
    expect(out).toContain('slash ×5, bite ×3');          // the verbs, in the tooltip
    expect(out).toContain('Biggest hit: slash 12.');
  });
  it('draws nothing until a swing was seen', () => {
    expect(hitsChip(null)).toBe('');
    expect(hitsChip(agent.mobHitTypesFor('a gnoll pup'))).toBe('');
  });
});
