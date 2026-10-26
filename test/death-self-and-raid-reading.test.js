// Two gaps in how the agent records player deaths in a fight parse.
//
// 1. SELF DEATH. EverQuest prints "You have been slain by <killer>!" in the dying character's OWN log.
//    parseEvent matched "<Name> has been slain by" and "You died." but not this first-person line, so the
//    uploader's own death could go unrecorded. One death can print BOTH lines, so it must still be one record.
// 2. RAID MEMBERS. A bystander's death is kept only if isConfirmedPlayer(name). The Zeal raid list (type 5,
//    the data uploaded as raid_roster) was not a source, so a raider nobody had /who'd was dropped.
//
// Real functions throughout (parseEvent / shouldKeep / EncounterBuilder / _maybeUploadRaidRoster), no copies.
// Invented names only (Corvale, Aldenmar, Brackwyn, Nyssara, Rethlan, Zarrin).
//
// Run: npx vitest run test/death-self-and-raid-reading.test.js

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => {
  agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
});

const at = (sec) => `[Sun Aug 02 21:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} 2026] `;

function run(lines, character) {
  const b = new agent.EncounterBuilder({ character, onFlush: () => {}, silent: true });
  for (const [sec, text] of lines) {
    const line = at(sec) + text;
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (e) b.add(e);
  }
  return b.deaths;
}

describe('own death: "You have been slain by <killer>!"', () => {
  it('parses as a self death carrying the killer', () => {
    const line = at(5) + 'You have been slain by a shissar disciple!';
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    expect(e).toMatchObject({ type: 'death', defender: null, attacker: 'a shissar disciple' });
  });

  it('survives the byte-level keep filter (it never reaches parseEvent otherwise)', () => {
    expect(agent.shouldKeep(at(5) + 'You have been slain by a shissar disciple!')).toBe(true);
  });

  it('is recorded against the log\'s own character', () => {
    const d = run([[5, 'You have been slain by a shissar disciple!']], 'Corvale');
    expect(d).toHaveLength(1);
    expect(d[0].name).toBe('Corvale');
  });

  it('one death that prints BOTH lines is recorded once', () => {
    const d = run([
      [5, 'You have been slain by a shissar disciple!'],
      [5, 'You died.'],
    ], 'Corvale');
    expect(d).toHaveLength(1);
  });

  it('the order of the two lines does not matter', () => {
    const d = run([
      [5, 'You died.'],
      [6, 'You have been slain by a shissar disciple!'],
    ], 'Corvale');
    expect(d).toHaveLength(1);
  });

  it('a genuine second death more than 3 s later is still a second death', () => {
    const d = run([
      [5, 'You have been slain by a shissar disciple!'],
      [5, 'You died.'],
      [200, 'You have been slain by a shissar disciple!'],
      [200, 'You died.'],
    ], 'Corvale');
    expect(d).toHaveLength(2);
  });

  it('does not swallow a bystander who dies at the same moment as us', () => {
    agent.confirmPlayer('Aldenmar');
    const d = run([
      [5, 'You have been slain by a shissar disciple!'],
      [5, 'Aldenmar has been slain by a shissar disciple!'],
    ], 'Corvale');
    expect(d.map(x => x.name).sort()).toEqual(['Aldenmar', 'Corvale']);
  });
});

describe('raid members count as players', () => {
  afterEach(() => { agent._setReporterRolesForTest({}); });

  const sample = (names) => ({ data: JSON.stringify(names.map((name, i) => ({ name, class: 'Warrior', group: String(i % 12) }))) });

  it('a raider on the Zeal raid list is a confirmed player; a stranger is not', () => {
    agent._setReporterRolesForTest({ roster: false });   // keep the test off the upload queue
    expect(agent.isConfirmedPlayer('Brackwyn')).toBe(false);
    agent._maybeUploadRaidRoster(sample(['Brackwyn', 'Nyssara']));
    expect(agent.isConfirmedPlayer('Brackwyn')).toBe(true);
    expect(agent.isConfirmedPlayer('Nyssara')).toBe(true);
    expect(agent.isConfirmedPlayer('Zarrin')).toBe(false);
  });

  it('a raider\'s death is kept once they are on the raid list, dropped before', () => {
    agent._setReporterRolesForTest({ roster: false });
    const line = [10, 'Rethlan has been slain by a shissar disciple!'];
    expect(run([line], 'Corvale'), 'nobody has /who\'d Rethlan: dropped').toHaveLength(0);
    agent._maybeUploadRaidRoster(sample(['Rethlan']));
    const d = run([line], 'Corvale');
    expect(d).toHaveLength(1);
    expect(d[0].name).toBe('Rethlan');
  });

  it('a name that is not letters only never becomes a player, even on the list', () => {
    agent._setReporterRolesForTest({ roster: false });
    agent._maybeUploadRaidRoster(sample(['Rydda`Dar']));
    expect(agent.isConfirmedPlayer('Rydda`Dar')).toBe(false);
  });
});
