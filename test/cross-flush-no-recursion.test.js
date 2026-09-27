// Closing a fight must close the matching fight on each peer tracker ONCE — not
// bounce back and forth between them.
//
// The guild lead's agent froze mid-raid on Emperor Ssraeshza (2026-09-25): Target
// Info stopped, the CH chain overlay went "OVERLAY BLIND — agent not responding",
// and only a Mimic restart brought it back. The agent log showed one line 4,656
// times in a row — "<A>'s fight ... ended via peer <B>" / "<B>'s ... via peer <A>".
// EncounterBuilder.flush() closed its peers BEFORE resetting itself, so each
// peer's own flush found the first tracker still open and flushed it back, until
// the stack overflowed; a bare catch swallowed the RangeError. Every level re-ran
// a full boss flush and re-queued its upload, which is what blocked the agent.
//
// These drive the REAL class through parseEvent — a comment cannot satisfy them.
//
// Run: npx vitest run test/cross-flush-no-recursion.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => {
  agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
});

const at = (sec) => `[Thu Sep 25 03:${String(10 + Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} 2026] `;

// A dozen melee hits on one boss — enough to pass flush()'s 10-event floor.
function fight(boss, attacker) {
  const lines = [];
  for (let s = 0; s < 12; s++) lines.push([s, `${attacker} hits ${boss} for ${400 + s} points of damage.`]);
  return lines;
}

function tracker(character, boss, attacker) {
  const flushes = [];
  const b = new agent.EncounterBuilder({ character, onFlush: p => flushes.push(p) });  // live: registers as a peer
  for (const [sec, text] of fight(boss, attacker)) {
    const line = at(sec) + text;
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (e) b.add(e);
  }
  return { b, flushes };
}

describe('cross-flush between peer trackers', () => {
  it('two trackers on the same boss each flush exactly once', () => {
    const a = tracker('Aldenmar', 'Emperor Ssraeshza', 'Aldenmar');
    const b = tracker('Brackwyn', 'Emperor Ssraeshza', 'Brackwyn');
    expect(a.b.events.length).toBeGreaterThanOrEqual(10);
    a.b.flush();
    expect(a.flushes).toHaveLength(1);
    expect(b.flushes, 'the peer closes along with us — once, not thousands of times').toHaveLength(1);
    expect(a.b.events).toHaveLength(0);
    expect(b.b.events).toHaveLength(0);
  });

  it('three trackers on the same boss each flush exactly once', () => {
    const t = ['Corvale', 'Rethlan', 'Nyssara'].map(n => tracker(n, 'Thall Va Kelun', n));
    t[1].b.flush();
    expect(t.map(x => x.flushes.length)).toEqual([1, 1, 1]);
  });

  it('a tracker on a different boss is left open', () => {
    const a = tracker('Zarrin', 'A Shissar Defiler', 'Zarrin');
    const other = tracker('Aldenmar', 'Emperor Ssraeshza', 'Aldenmar');
    a.b.flush();
    expect(a.flushes).toHaveLength(1);
    expect(other.flushes).toHaveLength(0);
    expect(other.b.events.length).toBeGreaterThanOrEqual(10);
    other.b.flush();  // leave the shared peer set clean for later tests
  });
});
