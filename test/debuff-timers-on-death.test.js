// The guild lead, 2026-10-19, from a screenshot of the trigger overlay's timer list ("A scrounging rat - Turgur's
// Insects 00:26", "Foul Pusling - Turgur's Insects 03:42" ...): "when a mob dies it should remove those triggers for
// debuffs. Mention the mob's spawn id in the timer."
//
// The rows are _builtinTimerRows' "<mob> - <spell>" bars, built from _buffLandingsByTarget. A death line (or the Zeal
// target window going to a corpse / 0 HP) now drops that mob's debuff entries via _dropDebuffTimersOnDeath, and a
// row whose landing proved a spawn id carries "#<id>" in its label. Every behaviour test drives the SHIPPED agent;
// the two hook sites are source assertions on comment-stripped text.
//
// Run: npx vitest run test/debuff-timers-on-death.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
const NOW = Date.now();

function on() {
  const tpl = agent.SUGGESTED_TRIGGERS.find(t => t.id === 'timer_my_spells');
  agent._setPersonalTriggersForTest([agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl))]);
}
function land(key, mobName, spell, id, extra) {
  let mp = agent._buffLandingsByTarget.get(key);
  if (!mp) { mp = new Map(); agent._buffLandingsByTarget.set(key, mp); }
  mp.set(spell.toLowerCase(), Object.assign({ name: spell, dur_ticks: 20, landed_at: NOW - 1000, cast_by: ME,
    target_name: mobName, target_id: id }, extra || {}));
}
const labels = () => agent._builtinTimerRows(NOW).map(r => r.name).sort();
const effects = () => agent._builtinTimerRows(NOW).map(r => r.effect).sort();
const dieLine = (mob) => `[Mon Oct 19 20:41:34 2026] ${mob} has been slain by Torvahk!`;
const die = (mob, id) => agent._dropDebuffTimersOnDeath(agent._deadMobNameFromLine(dieLine(mob)), id, NOW, 'log');

beforeEach(() => {
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
  agent._setSpellCatalogForTest([
    { name: "Turgur's Insects", good: 0 }, { name: 'Malosini', good: 0 }, { name: 'Ancient: Feral Avatar', good: 1 },
    { name: 'Clarity', good: 1 }, { name: 'Allure', good: 0 },
  ]);
  agent._buffLandingsByTarget.clear();
  agent._builtinTimerHidden.clear();
  agent.whoData.clear();
  on();
});

describe('a death removes that mob\'s debuff timers', () => {
  it('by spawn id: only the entries stamped with the dead spawn go, its same-name sibling keeps its own', () => {
    land('a scrounging rat', 'A scrounging rat', "Turgur's Insects", 4182);
    land('a scrounging rat', 'A scrounging rat', 'Malosini', 4190);
    expect(effects()).toEqual(['Malosini', "Turgur's Insects"]);
    expect(die('A scrounging rat', 4182)).toBe(1);
    expect(effects()).toEqual(['Malosini']);                            // the other rat's timer is still counting
    expect(agent._activeTimersSnapshot().some(r => r.effect === "Turgur's Insects")).toBe(false);   // gone from the very next poll
  });
  it('by unique name: no id anywhere, one mob of that name, so the whole bucket goes', () => {
    land('foul pusling', 'Foul Pusling', "Turgur's Insects", null);
    land('foul pusling', 'Foul Pusling', 'Malosini', null);
    land('a scrounging rat', 'A scrounging rat', 'Malosini', null);    // a different mob: untouched
    expect(die('Foul Pusling', null)).toBe(2);
    expect(agent._buffLandingsByTarget.has('foul pusling')).toBe(false);
    expect(labels()).toEqual(['A scrounging rat - Malosini']);
  });
  it('the death id may be known while the landing carried none: still one mob of that name, so it goes', () => {
    land('foul pusling', 'Foul Pusling', "Turgur's Insects", null);
    expect(die('Foul Pusling', 5001)).toBe(1);
    expect(effects()).toEqual([]);
  });
  it('NOT when the name is ambiguous and the death has no id: nothing is removed, the timers expire', () => {
    land('a scrounging rat', 'A scrounging rat', "Turgur's Insects", 4182);
    land('a scrounging rat', 'A scrounging rat', 'Malosini', 4190);     // two different spawns carry timers
    expect(die('A scrounging rat', null)).toBe(0);
    expect(effects()).toEqual(['Malosini', "Turgur's Insects"]);
  });
  it('NOT an id-less landing when another spawn of that name is proven alive (the dead id differs from a stamped one)', () => {
    land('a scrounging rat', 'A scrounging rat', "Turgur's Insects", null);
    land('a scrounging rat', 'A scrounging rat', 'Malosini', 4190);
    expect(die('A scrounging rat', 4182)).toBe(0);                       // 4182 has no stamped entry; the unstamped one might be 4190's
    expect(effects()).toEqual(['Malosini', "Turgur's Insects"]);
  });
  it('a landing that arrived AFTER the death is a new mob of the same name and stays', () => {
    land('foul pusling', 'Foul Pusling', "Turgur's Insects", null, { landed_at: NOW + 5000 });
    expect(die('Foul Pusling', null)).toBe(0);
    expect(effects()).toEqual(["Turgur's Insects"]);
  });
});

describe('what a death never touches', () => {
  it('buffs on a player: the dead name is a known player, so nothing goes (player deaths print the same slain line)', () => {
    agent.whoData.set('torvahk', { name: 'Torvahk', class: 'Warrior', level: 60 });
    land('torvahk', 'Torvahk', "Turgur's Insects", null);              // even a debuff on a player
    land('torvahk', 'Torvahk', 'Clarity', null);
    expect(die('Torvahk', null)).toBe(0);
    expect(agent._buffLandingsByTarget.get('torvahk').size).toBe(2);
  });
  it('a watched character, a friendly buff on a named mob and a charm entry are all kept', () => {
    land('fenrisk', ME, 'Malosini', null);
    expect(die(ME, null)).toBe(0);
    land('smokestomp', 'Smokestomp', 'Ancient: Feral Avatar', null);
    land('smokestomp', 'Smokestomp', 'Allure', null, { is_charm_spell: true, owner: ME });
    land('smokestomp', 'Smokestomp', 'Malosini', null);
    expect(die('Smokestomp', null)).toBe(1);                           // only the debuff
    expect([...agent._buffLandingsByTarget.get('smokestomp').keys()].sort()).toEqual(['allure', 'ancient: feral avatar']);
  });
  it('"You died." is nobody\'s mob', () => {
    land('you', 'You', 'Malosini', null);
    expect(agent._dropDebuffTimersOnDeath('You', null, NOW, 'log')).toBe(0);
  });
});

describe('the row label shows the spawn id', () => {
  it('"<mob> #<id> - <spell>" when the landing proved one; the old label when it did not', () => {
    land('a scrounging rat', 'A scrounging rat', "Turgur's Insects", 4182);
    land('foul pusling', 'Foul Pusling', "Turgur's Insects", null);
    land('smokestomp', 'Smokestomp', 'Malosini', 0);                    // 0 = "no target", never an id
    const rows = agent._builtinTimerRows(NOW);
    expect(rows.map(r => r.name).sort()).toEqual(['A scrounging rat #4182 - Turgur\'s Insects', "Foul Pusling - Turgur's Insects", 'Smokestomp - Malosini']);
    const rat = rows.find(r => r.target_id === 4182);
    expect(rat).toMatchObject({ target: 'A scrounging rat #4182', effect: "Turgur's Insects" });
    expect(rows.filter(r => r.target_id === null).length).toBe(2);
  });
  it('is byte-stable across polls', () => {
    land('a scrounging rat', 'A scrounging rat', "Turgur's Insects", 4182);
    expect(JSON.stringify(agent._builtinTimerRows(NOW))).toBe(JSON.stringify(agent._builtinTimerRows(NOW)));
  });
});

describe('both death sources are wired', () => {
  const src = stripJs(readSource(AGENT_INDEX));
  it('the live log tail drops them on a slain/died line, next to the map\'s death handling', () => {
    const tail = sliceBlock(src, '_cancelTimersOnMobDeath(line); }', '_mapNoteLogDeath(');
    expect(tail).toMatch(/_deadMobNameFromLine\(line\)/);
    expect(tail).toMatch(/_dropDebuffTimersOnDeath\(_dbDead, _provableTargetId\(b\.character, _dbDead\), _dbAt, 'log'\)/);
  });
  it('the Zeal target window (name became a corpse, or HP hit 0) drops them with the target\'s spawn id', () => {
    const fn = sliceBlock(src, 'function _mapNoteState(', '\n}\n');
    expect(fn).toMatch(/_dropDebuffTimersOnDeath\(base, id, now, 'zeal'\)/);
    expect(fn.indexOf('_dropDebuffTimersOnDeath(')).toBeGreaterThan(fn.indexOf('if (!becameCorpse && !hitZero) return;'));
  });
});
