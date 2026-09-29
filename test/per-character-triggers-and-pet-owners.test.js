// test/per-character-triggers-and-pet-owners.test.js — two member reports, 2026-09-29.
//
// FB-34: "Can these be made to per character triggers and not across the board?" (the Suggested
//   triggers panel). A personal trigger now carries an optional `characters` list; the panel has a
//   "For:" picker; a line only fires a trigger set for the character whose log it came from.
// FB-35: "This doesn't show pets? maybe its only if they dont use /pet leader, not sure". Right: a
//   summoned pet names its owner only in "My leader is <Owner>." The bot now hands back the owners it
//   pooled from every raider's uploads, and a pet named by the server's pet-name generator that /who
//   never showed is labelled "(pet)" instead of passing for a raider.
//
// The shipped agent runs for real (require); the Suggested POST handler and the overlay are slices.
//
// Run: npx vitest run test/per-character-triggers-and-pet-owners.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
beforeEach(() => {
  agent._setWatchedLogsForTest([
    { character: 'Brackwyn', logPath: 'eqlog_Brackwyn_pq.proj.txt' },
    { character: 'Corvale',  logPath: 'eqlog_Corvale_pq.proj.txt' },
  ]);
  agent._setPersonalTriggersForTest([]);
  agent._setZealStateForTest('Brackwyn', null);
  agent._setZealStateForTest('Corvale', null);
  agent._guildPetOwners.clear();
  agent.whoData.delete('kebantik');
});

const LINE = '[Tue Sep 29 06:50:00 2026] Your charm spell has worn off.';
const fires = (name) => agent._fireLog.filter(f => f.name === name).length;
const trig = (id, extra) => agent._compilePersonalTrigger(Object.assign({ id, name: id, pattern: 'Your charm spell has worn off',
  enabled: true, actions: [{ type: 'text_overlay', text: 'X', duration_ms: 1000 }] }, extra || {}));

describe('FB-34: a trigger can be on for some characters only', () => {
  it('the character list is cleaned: lowercase, names only, none = every character', () => {
    expect(agent._normCharList(['Brackwyn', ' corvale ', 'Brackwyn', 'x', 'not a name', 7])).toEqual(['brackwyn', 'corvale']);
    expect(agent._normCharList([])).toBeNull();
    expect(agent._compilePersonalTrigger({ id: 'a', name: 'a', pattern: 'x', characters: ['Brackwyn'] }).characters).toEqual(['brackwyn']);
    expect(agent._compilePersonalTrigger({ id: 'b', name: 'b', pattern: 'x' }).characters).toBeUndefined();
  });

  it('a line fires it only from the log of a character it is on for', () => {
    agent._setPersonalTriggersForTest([trig('pc-scoped', { characters: ['brackwyn'] }), trig('pc-all')]);
    const s0 = fires('pc-scoped'), a0 = fires('pc-all');
    agent.evaluateTriggersAgainstLine(LINE, Date.now(), 'Corvale');
    expect(fires('pc-scoped')).toBe(s0);        // Corvale's log: not for Corvale
    expect(fires('pc-all')).toBe(a0 + 1);       // no list: every character, as before
    agent.evaluateTriggersAgainstLine(LINE, Date.now() + 5000, 'Brackwyn');
    expect(fires('pc-scoped')).toBe(s0 + 1);
  });

  it('a timer-bar switch set for one character is on only while that character is being played', () => {
    const sw = agent._compilePersonalTrigger({ id: 'suggested:timer_lull', name: 'lulls', pattern: '', builtin_timer: 'lull', characters: ['brackwyn'] });
    agent._setPersonalTriggersForTest([sw]);
    agent._setZealStateForTest('Corvale', { updatedAt: Date.now() });
    expect(agent._builtinTimerKindsOn().has('lull')).toBe(false);
    agent._setZealStateForTest('Brackwyn', { updatedAt: Date.now() });
    expect(agent._builtinTimerKindsOn().has('lull')).toBe(true);
  });

  it('a Zeal gauge trigger set for one character only watches that character', () => {
    const t = agent._compilePersonalTrigger({ id: 'pc-hp', name: 'pc-hp', pattern: '', enabled: true, characters: ['brackwyn'],
      zeal_condition: { field: 'self_hp_pct', op: '<=', value: 30 }, actions: [{ type: 'text_overlay', text: 'LOW', duration_ms: 1000 }] });
    agent._setPersonalTriggersForTest([t]);
    const n0 = fires('pc-hp');
    agent._setZealStateForTest('Corvale', { updatedAt: Date.now(), self_hp_pct: 10 });
    agent._evaluateZealConditions('Corvale', Date.now());
    expect(fires('pc-hp')).toBe(n0);             // Corvale at 10%: not Corvale's trigger
    agent._setZealStateForTest('Brackwyn', { updatedAt: Date.now(), self_hp_pct: 10 });
    agent._evaluateZealConditions('Brackwyn', Date.now());
    expect(fires('pc-hp')).toBe(n0 + 1);         // the same state on Brackwyn fires it
  });

  it('the dashboard\'s whole-list save keeps the list', () => {
    expect(agent.PERSONAL_CARRY_FIELDS).toContain('characters');
  });
});

describe('FB-34: the Suggested panel\'s toggle, per character', () => {
  const src = readSource(AGENT_INDEX);
  const handler = sliceBlock(src, "if (req.url === '/api/triggers/suggested' && req.method === 'POST') {",
    "return res.end(JSON.stringify({ error: 'compile failed: ' + (err.message || String(err)) }));\n        }\n      }");
  async function post(list, body) {
    const res = { writeHead() {}, end(b) { this.body = b; return b; } };
    const run = new Function('req', 'res', '_readBody', 'SUGGESTED_TRIGGERS', '_personalTriggers', '_normCharList', '_watchedCharacters',
      '_templateToPersonalRow', '_compilePersonalTrigger', 'savePersonalTriggers', '_suggestedHasTts',
      'return (async () => { ' + handler + ' })();');
    await run({ url: '/api/triggers/suggested', method: 'POST' }, res, async () => JSON.stringify(body), agent.SUGGESTED_TRIGGERS, list,
      agent._normCharList, () => ['Brackwyn', 'Corvale', 'Nyssara'], agent._templateToPersonalRow, agent._compilePersonalTrigger,
      () => {}, () => false);
    return list;
  }
  const ID = 'cast_fizzle';
  const row = (list) => list.find(t => t.id === 'suggested:' + ID);
  it('ticking it for one character makes a row for that character alone', async () => {
    const list = await post([], { id: ID, enabled: true, char: 'Brackwyn' });
    expect(row(list).characters).toEqual(['brackwyn']);
    await post(list, { id: ID, enabled: true, char: 'Corvale' });
    expect(row(list).characters).toEqual(['brackwyn', 'corvale']);
  });
  it('unticking one character keeps it for the others — including a row that was on for everyone', async () => {
    const list = await post([], { id: ID, enabled: true });            // every character
    expect(row(list).characters).toBeUndefined();
    await post(list, { id: ID, enabled: false, char: 'Corvale' });
    expect(row(list).characters).toEqual(['brackwyn', 'nyssara']);
    await post(list, { id: ID, enabled: false, char: 'Brackwyn' });
    await post(list, { id: ID, enabled: false, char: 'Nyssara' });
    expect(row(list)).toBeUndefined();                                  // nobody left: the row goes
  });
  it('ticking it in the every-character view clears the list; a TTS flip keeps it', async () => {
    const list = await post([], { id: ID, enabled: true, char: 'Brackwyn' });
    await post(list, { id: ID, tts: true });
    expect(row(list).characters).toEqual(['brackwyn']);
    await post(list, { id: ID, enabled: true });
    expect(row(list).characters).toBeUndefined();
  });
});

describe('FB-34: dashboard picker', () => {
  const dash = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));
  it('the panel offers For: every character or one, and sends the choice with each tick', () => {
    expect(dash).toMatch(/<option value="">Every character<\/option>/);
    expect(dash).toMatch(/JSON\.stringify\(\{ id: id, enabled: en\.checked, char: forChar \|\| undefined \}\)/);
    expect(dash).toMatch(/if \(en && en\.getAttribute\('data-partial'\)\) en\.indeterminate = true;/);
  });
});

describe('FB-35: pets on the live meter', () => {
  const MOB = 'a Shissar acolyte';
  const feed = (b, i, line) => {
    const full = `[Tue Sep 29 06:50:${String(i).padStart(2, '0')} 2026] ${line}`;
    const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
    if (ev) b.add(ev);
  };
  function fight(silent) {
    const b = new agent.EncounterBuilder({ character: 'Brackwyn', silent });
    [`${MOB} hits Kebantik for 60 points of damage.`, `Kebantik hits ${MOB} for 45 points of damage.`,
      `Aldenmar slashes ${MOB} for 120 points of damage.`, `Kebantik bites ${MOB} for 40 points of damage.`]
      .forEach((l, i) => feed(b, i, l));
    b._publishLiveThreat();
    return agent._liveThreatForTest().perPlayer;
  }
  it('the server\'s pet-name generator, and nothing else', () => {
    for (const n of ['Kebantik', 'Gobeker', 'Jarn', 'Gtik', 'Zonobn', 'Lekn']) expect(agent._isGeneratedPetName(n), n).toBe(true);
    for (const n of ['Aldenmar', 'Brackwyn', 'Gan', 'Gektik', 'Kab', 'Qebantik', 'kebantik']) expect(agent._isGeneratedPetName(n), n).toBe(false);
  });
  it('a pet the guild has named is credited to its owner', () => {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' } });
    const pp = fight(false);
    expect(pp.Kebantik.pet_owner).toBe('Nyssara');
    expect(pp.Kebantik.pet_summoned).toBeUndefined();
  });
  it('a generator-named pet nobody has named is marked a pet, not a raider — until /who shows the name', () => {
    expect(fight(false).Kebantik.pet_summoned).toBe(true);
    agent.whoData.set('kebantik', { name: 'Kebantik', class: 'Warrior' });
    expect(fight(false).Kebantik.pet_summoned).toBeUndefined();
  });
  it('a replay of an old log does not borrow tonight\'s owners', () => {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' } });
    const b = new agent.EncounterBuilder({ character: 'Brackwyn', silent: true });
    feed(b, 0, `Kebantik hits ${MOB} for 45 points of damage.`);
    expect(b.petLeaders.kebantik).toBeUndefined();
  });
  it('only one-word pets and plain owner names are taken from the pool', () => {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara', 'a shissar arbiter': 'Corvale', gobeker: 'not a name' } });
    expect([...agent._guildPetOwners.keys()]).toEqual(['kebantik']);
  });
});

describe('FB-35: the DPS HUD says (pet) and keeps it out of the /rs line', () => {
  const hud = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html')));
  it('labels the row and filters it from the copied parse', () => {
    expect(hud).toMatch(/\(t && t\.pet_charm\) \|\| \(t && t\.pet_summoned \? 'pet' : false\)/);
    expect(hud).toMatch(/petCharm === 'pet'[\s\S]{0,300}>\(pet\)</);
    expect(hud).toMatch(/return !x\[2\] && !x\[3\] && !\/\\s\/\.test\(x\[0\]\);/);
  });
});
