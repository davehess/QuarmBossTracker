// Real deaths carry a corpse-run confirmation; feigns cannot.
//
// "<Name> dies." is the feign-death message (see feign-death-not-a-death.test.js),
// which meant a month of stored deaths mixed genuine ones with every feign a
// knight or necro threw — and the stored record kept only name/ts/class, so the
// two were byte-identical and could not be separated after the fact.
//
// Uilnayar's insight: a REAL death has a tail a feign never produces —
//     You died.
//     You are bleeding to death!
//     Returning to home point, please wait...
//     LOADING, PLEASE WAIT...
// Those lines appear ONLY in the dying player's own log. Nobody feigns their way
// to a home point. So `confirmed: true` is evidence, and a backfill can separate
// real deaths from false ones instead of guessing by class.
//
// Run: npx vitest run test/death-confirmation.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => {
  agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
});

const at = (sec) => `[Sun Aug 02 21:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} 2026] `;

function run(lines, character = 'Syko') {
  const b = new agent.EncounterBuilder({ character, onFlush: () => {}, silent: true });
  for (const [sec, text] of lines) {
    const line = at(sec) + text;
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (e) b.add(e);
  }
  return b.deaths;
}

describe('death confirmation', () => {
  it('a real self-death with the corpse-run tail is CONFIRMED', () => {
    const d = run([
      [10, 'You died.'],
      [12, 'You are bleeding to death!'],
      [14, 'Returning to home point, please wait...'],
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].confirmed).toBe(true);
  });

  it('either tail line alone confirms — players release at different times', () => {
    expect(run([[10, 'You died.'], [11, 'You are bleeding to death!']])[0].confirmed).toBe(true);
    expect(run([[10, 'You died.'], [40, 'Returning to home point, please wait...']])[0].confirmed).toBe(true);
  });

  it('a REZZED death is still recorded, just not confirmed', () => {
    // Accepting a rez means no home point and no corpse run. The death is real;
    // we simply have no positive proof, so it must not be silently dropped.
    const d = run([[10, 'You died.']]);
    expect(d).toHaveLength(1);
    expect(d[0].confirmed).toBeUndefined();
  });

  it('a feign produces NO death record at all, so nothing to confirm', () => {
    expect(run([[10, 'Syko dies.'], [12, 'You are bleeding to death!']]).filter(x => x.name === 'Syko' && x.confirmed))
      .toHaveLength(0);
  });

  it('confirmation cannot reach back past the window to an older death', () => {
    const d = run([
      [10, 'You died.'],
      [200, 'Returning to home point, please wait...'],   // 190s later — a different event
    ]);
    expect(d[0].confirmed, 'a much later corpse run must not confirm an old death').toBeUndefined();
  });

  it('confirmation only ever stamps OUR OWN death, never a bystander\'s', () => {
    // These lines exist solely in the dying player's log, so our corpse run must
    // never be credited to a death we merely observed.
    //
    // Fargan has to be made a CONFIRMED player first, or the builder drops his
    // death via isConfirmedPlayer and there is nothing left to mis-stamp — the
    // assertion would pass whether or not the self-only guard existed.
    agent._setWatchedLogsForTest([
      { character: 'Syko',   logPath: '/x/eqlog_Syko_pq.proj.txt',   lastSeen: Date.now() },
      { character: 'Fargan', logPath: '/x/eqlog_Fargan_pq.proj.txt', lastSeen: Date.now() },
    ]);
    try {
      const d = run([
        [10, 'Fargan has been slain by a shissar disciple!'],
        [12, 'You are bleeding to death!'],
      ]);
      const fargan = d.find(x => x.name === 'Fargan');
      expect(fargan, 'Fargan must actually be recorded for this test to mean anything').toBeTruthy();
      expect(fargan.confirmed, 'our corpse run says nothing about Fargan').toBeUndefined();
    } finally {
      agent._setWatchedLogsForTest([]);
    }
  });

  it('a corpse run with no self-death of ours confirms nothing', () => {
    expect(run([[12, 'Returning to home point, please wait...']])).toHaveLength(0);
  });
});
