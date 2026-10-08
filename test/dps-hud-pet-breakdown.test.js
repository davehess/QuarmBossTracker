// test/dps-hud-pet-breakdown.test.js — +pet on the DPS HUD (the guild lead, 2026-09-29).
//
// "show the +pet on the DPS hud, then the color of the +pet and the section of the bar that is
// highlighted should match to distinguish how much was the player vs the pet, and if you click on +pet
// it should open a line below to show the pets name and damage and spawnid. we should be able to get
// this when someone does pet leader and has zeal tags on"
//
// The agent runs for real (require) for the spawn-id lookup and the live pet row; the HUD's fold runs
// as a slice; the HUD's drawing and click wiring are checked as stripped source.
//
// Run: npx vitest run test/dps-hud-pet-breakdown.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
beforeEach(() => {
  for (const c of ['Nyssara', 'Brackwyn']) agent._setZealStateForTest(c, null);
  agent._zealTagsForTest.clear();
  agent._applyPetOwnersResponse({ owners: {} });
});

describe('the agent: a pet\'s spawn id, only when provable', () => {
  it('1. this machine runs the owner and Zeal names this pet → its pet_id (and only that is uploaded as fact)', () => {
    agent._setZealStateForTest('Nyssara', { updatedAt: Date.now(), pet_name: 'Kebantik', pet_id: 4321 });
    expect(agent._petSpawnIdFor('Kebantik', 'Nyssara')).toBe(4321);
    expect(agent._ownPetSpawnId('Kebantik', 'Nyssara')).toBe(4321);
    expect(agent._ownPetSpawnId('Gobeker', 'Nyssara')).toBeNull();     // her pet is not this one
    expect(agent._ownPetSpawnId('Kebantik', 'Zarrin')).toBeNull();     // not her pet
  });
  it('2. a fresh Zeal /tag on the pet carries its id; a stale one does not', () => {
    agent._zealTagsForTest.set(555, { spawn_id: 555, mob: 'gobeker', mobDisplay: 'Gobeker', tsMs: Date.now() });
    expect(agent._petSpawnIdFor('Gobeker', 'Zarrin')).toBe(555);
    expect(agent._ownPetSpawnId('Gobeker', 'Zarrin')).toBeNull();      // someone else's tag is not uploaded
    agent._zealTagsForTest.set(555, { spawn_id: 555, mob: 'gobeker', mobDisplay: 'Gobeker', tsMs: Date.now() - 3600_000 });
    expect(agent._petSpawnIdFor('Gobeker', 'Zarrin')).toBeNull();
  });
  it('3. one of this machine\'s characters has it targeted', () => {
    agent._setZealStateForTest('Brackwyn', { updatedAt: Date.now(), target_name: 'Jarn', target_id: 88 });
    expect(agent._petSpawnIdFor('Jarn', 'Aldenmar')).toBe(88);
  });
  it('4. the owner\'s Mimic uploaded it and the bot pooled it — kept only for a pet the pool names', () => {
    agent._applyPetOwnersResponse({ owners: { lekn: 'Rethlan' }, ids: { lekn: 99, gobeker: 5 } });
    expect(agent._petSpawnIdFor('Lekn', 'Rethlan')).toBe(99);
    expect(agent._guildPetIds.has('gobeker')).toBe(false);
    expect(agent._petSpawnIdFor('Zonobn', 'Corvale')).toBeNull();        // nothing knows it: no guess
  });
  it('the live pet row carries it for the HUD', () => {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' }, ids: { kebantik: 1234 } });
    const b = new agent.EncounterBuilder({ character: 'Brackwyn' });
    for (const [i, l] of [['a Shissar acolyte hits Kebantik for 60 points of damage.'], ['Kebantik hits a Shissar acolyte for 45 points of damage.']].entries()) {
      const full = `[Tue Sep 29 07:50:0${i} 2026] ${l[0]}`;
      const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
      if (ev) b.add(ev);
    }
    b._publishLiveThreat();
    const pp = agent._liveThreatForTest().perPlayer;
    expect(pp.Kebantik.pet_owner).toBe('Nyssara');
    expect(pp.Kebantik.pet_spawn_id).toBe(1234);
  });
  it('the upload sends only the owner\'s own id, never from a replay', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    expect(src).toMatch(/const sid = this\.silent \? null : _ownPetSpawnId\(r\.name, r\.pet_owner\);\s*if \(sid\) r\.spawn_id = sid;/);
  });
});

describe('the HUD: the pets folded into their owner stay apart', () => {
  const hud = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
  const fold = evalBlock(sliceBlock(hud, 'function _foldPetsIntoOwners(allRows){',
    "return _folded.sort(function(a,b){ return (b[1]||0)-(a[1]||0); });\n  }"), ['_foldPetsIntoOwners'])._foldPetsIntoOwners;
  it('the owner row keeps each pet: name, damage, spawn id', () => {
    const out = fold([
      ['Nyssara', 300, 0, null, 0, 0, false, undefined, false, null],
      ['Kebantik', 100, 0, 'Nyssara', 0, 0, false, undefined, false, 1234],
      ['Brackwyn', 250, 0, null, 0, 0, false, undefined, false, null],
    ]);
    const ny = out.find(r => r[0] === 'Nyssara');
    expect(ny[1]).toBe(400);
    expect(ny[8]).toBe(true);
    expect(ny[10]).toEqual([{ name: 'Kebantik', v: 100, id: 1234 }]);
    expect(out.find(r => r[0] === 'Kebantik')).toBeUndefined();
  });

  const code = stripJs(hud);
  it('+pet and the pet\'s end of the bar share one colour', () => {
    expect(code).toMatch(/#deeps li \.pb i\.pet\{background:#f0883e\}/);
    expect(code).toMatch(/#deeps \.petx\{color:#f0883e;/);
    // The pet rule sits after the tank and your-row bar colours, which it must beat.
    expect(code.indexOf('#deeps li .pb i.pet{')).toBeGreaterThan(code.indexOf('#deeps li.me .pb i{'));
    expect(code).toMatch(/var petW = \(petSum > 0 && d > 0\) \? barW \* Math\.min\(1, petSum \/ d\) : 0;/);
    expect(code).toMatch(/'<span class="pb"><i style="width:' \+ \(barW - petW\)\.toFixed\(1\) \+ '%"><\/i>'\s*\+ \(petW > 0 \? '<i class="pet" style="width:' \+ petW\.toFixed\(1\) \+ '%"><\/i>' : ''\)/);
  });
  it('clicking +pet opens a line per pet under the owner: name, damage, spawn id', () => {
    expect(code).toMatch(/'<li class="petline">↳ ' \+ esc\(p\.name\) \+ ' · ' \+ fmt\(p\.v \|\| 0\)/);
    expect(code).toMatch(/\(p\.id \? 'spawn id ' \+ p\.id : 'spawn id unknown'\)/);
    expect(code).toMatch(/\+ '<\/li>' \+ petLines;/);
    const wire = sliceBlock(code, 'var _petOpen = new Set();', "tick().catch(function(){});\n    });");
    expect(wire).toMatch(/deepsEl\.addEventListener\('mousedown'/);
    expect(wire).toMatch(/if \(_petOpen\.has\(k\)\) _petOpen\.delete\(k\); else _petOpen\.add\(k\);/);
    // Locked overlays are click-through: the window takes the mouse only over a +pet.
    expect(wire).toMatch(/if \(_onPetx\(e\.target\)\) \{ try \{ window\.mimic\.overlayHoverInteractive\(true\); \}/);
  });
});
