// test/rampage-multi-boss.test.js — several bosses rampaging at once (HoH trial 3, the Crazed Norrathians).
//
// The guild lead, 2026-10-19: "for the third trial in HoH we have 3 bosses each with a rampage". The agent
// kept ONE rampage target, so the Command Center card strobed between victims and only the main target's
// rampage was spoken. Now: stats.currentRampages holds one victim per attacker, the tank state carries
// `rampages` (the old `rampage` stays the latest), the Command Center draws one row per attacker when
// there are two or more, and a named raid mob's rampage speaks even when it is not the main target.
// Runs the agent's REAL EncounterBuilder + _serializeTankState and the overlay's REAL rampHtml.
//
// Run: npx vitest run test/rampage-multi-boss.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
beforeEach(() => { agent._resetRampagesForTest(); agent._mobInfoByNameForTest().clear(); agent._setCurrentBossForTest(null); });

const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
const rampBlock = sliceBlock(cmd, '  function rampHtml(r, multi){', '\n  }');

const BOSSES = [
  ['Advocent Joran', 'Brackwyn'],
  ['Halgoz Rellinic', 'Corvale'],
  ['Freegan Haun', 'Rethlan'],
];
const stamp = (sec) => `[Mon Oct 19 20:00:${String(sec).padStart(2, '0')} 2026]`;
function feed(b, sec, text) {
  const line = `${stamp(sec)} ${text}`;
  const ev = agent.parseEvent(line, agent.parseEqTimestamp(line));
  if (ev) b.add(ev);
  return ev;
}
function threeBossesRampage(b) {
  BOSSES.forEach(([boss, victim], i) => feed(b, 10 + i, `${boss} goes on a RAMPAGE against ${victim}!`));
}

describe('tank state', () => {
  it('holds one rampage per attacker, and keeps `rampage` as the latest', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar', silent: true });
    threeBossesRampage(b);
    const t = agent._serializeTankState();
    expect(t.rampages.map(r => [r.attacker, r.target])).toEqual([
      ['Advocent Joran', 'Brackwyn'], ['Freegan Haun', 'Rethlan'], ['Halgoz Rellinic', 'Corvale'],
    ]);
    expect(t.rampage.attacker).toBe('Freegan Haun');
    expect(t.rampage.target).toBe('Rethlan');
  });

  it('one boss changing victims is still ONE entry', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar', silent: true });
    feed(b, 10, 'Advocent Joran goes on a RAMPAGE against Brackwyn!');
    feed(b, 20, 'Advocent Joran goes on a RAMPAGE against Corvale!');
    const t = agent._serializeTankState();
    expect(t.rampages).toHaveLength(1);
    expect(t.rampages[0].target).toBe('Corvale');
    expect(t.rampage.target).toBe('Corvale');
  });
});

describe('Command Center rows', () => {
  const rampHtml = new Function('esc', 'hpClass', 'fmtSec', rampBlock + '\nreturn rampHtml;')(
    (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
    (p) => (p == null ? '' : p <= 25 ? 'crit' : p <= 50 ? 'low' : ''),
    (s) => Math.round(s) + 's',
  );
  const rows = (rs) => rs.map(r => rampHtml(r, rs.length > 1)).join('');

  it('draws one row per attacker with its victim, HP and DA highlight', () => {
    const b = new agent.EncounterBuilder({ character: 'Aldenmar', silent: true });
    threeBossesRampage(b);
    const list = agent._serializeTankState().rampages;
    list[0].da = { seconds: 12, critical: false };
    list[1].hp_pct = 40;
    const html = rows(list);
    expect(html.match(/class="ramp"/g)).toHaveLength(3);
    expect(html).toContain('Advocent Joran: rampage on <span class="who">Brackwyn</span>');
    expect(html).toContain('Freegan Haun: rampage on <span class="who">Rethlan</span>');
    expect(html).toContain('Halgoz Rellinic: rampage on <span class="who">Corvale</span>');
    expect(html).toContain('hpbar gold');
    expect(html).toContain('INV 12s');
    expect(html).toContain('>40%<');
  });

  it('a single rampage renders the card it always did', () => {
    const html = rampHtml({ target: 'Brackwyn', attacker: 'Advocent Joran', hp_pct: 80 }, false);
    expect(html).toBe('<div class="ramp"><div class="row">💀 Rampage on <span class="who">Brackwyn</span></div>'
      + '<div class="hpwrap"><div class="hpbar " style="width:80%"></div><div class="val">80%</div></div></div>');
  });

  it('is wired: 2+ rampages choose the rows, otherwise s.rampage, and the state passes the array on', () => {
    const src = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js')));
    expect(cmd).toContain('s.rampages && s.rampages.length > 1');
    expect(src).toMatch(/rampages:\s+tank\.rampages,/);
  });
});

describe('TTS', () => {
  const spoken = () => agent._activeOverlaysForTest().filter(o => o.trigger === 'rampage').map(o => o.tts).reverse();
  const live = () => new agent.EncounterBuilder({ character: 'Aldenmar', silent: false });
  const raidMob = (name) => agent._mobInfoByNameForTest().set(name.toLowerCase() + '|0', { at: Date.now(), mob: { name, raid_target: 1 } });

  it('a raid mob that is not the main target is announced, by name once several are rampaging', () => {
    agent._setCurrentBossForTest('Advocent Joran');
    BOSSES.forEach(([boss]) => raidMob(boss));
    threeBossesRampage(live());
    const said = spoken();
    expect(said).toEqual(['New rampage: Brackwyn', 'Rellinic rampage on Corvale', 'Haun rampage on Rethlan']);
  });

  it('an add that is not a raid mob stays silent (#155)', () => {
    agent._setCurrentBossForTest('Advocent Joran');
    const b = live();
    feed(b, 10, 'Advocent Joran goes on a RAMPAGE against Brackwyn!');
    feed(b, 11, 'a crazed villager goes on a RAMPAGE against Corvale!');
    expect(spoken()).toEqual(['New rampage: Brackwyn']);
  });
});
