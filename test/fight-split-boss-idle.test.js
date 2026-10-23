// test/fight-split-boss-idle.test.js — a fight ends when its top target has taken no damage for 5 minutes.
//
// The guild lead, 2026-10-23: "there were two wipes" on one boss, ~30 minutes apart, and the parse page showed
// ONE 6m30s fight. EncounterBuilder is per LOG, not per mob: it closed a fight on a slain line, a Zeal
// target-dead or 120 s with NO event at all, so trash fought between the pulls kept it open for 40 minutes.
// Now the top target going 5 minutes without taking damage closes it, even while other events keep arriving.
// The reset case must still be ONE fight: a mob that full-heals after a dispel / feign death and is re-engaged
// within a minute or two is one kill, not two attempts.
// Drives the REAL EncounterBuilder with synthetic log lines (no text matching on the source).
//
// Run: npx vitest run test/fight-split-boss-idle.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const BOSS = 'Bertoxxulous';
const TRASH = 'a sporali infected';
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);          // base instant; lines are stamped in LOCAL time to match the parser
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
function stamp(sec) {
  const d = new Date(T0 + sec * 1000);
  return `[${DOW[d.getDay()]} ${MON[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}] `;
}

function harness() {
  const flushes = [];
  const b = new agent.EncounterBuilder({ character: 'Aldenmar', onFlush: p => flushes.push(p) });
  const feed = (sec, text) => {
    const line = stamp(sec) + text;
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (e) b.add(e);
  };
  // Boss damage every 3 s over [from, to).
  const hitBoss = (from, to) => { for (let s = from; s < to; s += 3) feed(s, `Aldenmar hits ${BOSS} for ${900 + (s % 7)} points of damage.`); };
  // The trash that kept the old fight open: damage to a different mob every 2 s, never the boss. (No slain
  // line, so nothing but the new rule can close the fight.)
  const trash = (from, to) => { for (let s = from; s < to; s += 2) feed(s, `Aldenmar hits ${TRASH} for ${50 + (s % 5)} points of damage.`); };
  const kill = (sec) => feed(sec, `${BOSS} has been slain by Aldenmar!`);
  const bossFlushes = () => flushes.filter(f => f.encounter.boss_name === BOSS);
  return { b, flushes, feed, hitBoss, trash, kill, bossFlushes };
}

describe('top target idle for 5 minutes ends the fight', () => {
  it('pull 1 -> wipe -> 20 min of trash -> pull 2 is TWO fights, the first an unconfirmed wipe', () => {
    const h = harness();
    h.hitBoss(0, 180);                    // pull 1, wipes at ~3:00 (no slain line)
    h.trash(185, 185 + 20 * 60);          // 20 minutes of trash on the same log
    h.hitBoss(1500, 1650);                // pull 2
    h.kill(1652);

    const fights = h.bossFlushes();
    expect(fights).toHaveLength(2);
    const [wipe, kill] = fights.map(f => f.encounter);
    expect(wipe.confirmed_kill).toBe(false);          // uploads like an idle-timeout fight: no timer moves
    expect(kill.confirmed_kill).toBe(true);
    // ended_at is the boss's last damage, not the end of the trash that kept the builder open.
    const wipeEnd = Date.parse(wipe.ended_at);
    expect(wipeEnd).toBeLessThanOrEqual(T0 + 180 * 1000);
    expect(wipeEnd).toBeGreaterThanOrEqual(T0 + 175 * 1000);
    // The trash after the last boss hit is not in the wipe's events.
    expect(wipe.events.every(e => Date.parse(e.ts) <= wipeEnd)).toBe(true);
    // The second pull is its own fight, starting at its own first hit.
    expect(Date.parse(kill.started_at)).toBeGreaterThanOrEqual(T0 + 1500 * 1000);
  });

  it('a dispel / feign-death reset with a 60 s gap stays ONE fight', () => {
    const h = harness();
    h.hitBoss(0, 120);
    h.trash(121, 180);                    // a minute with no damage on the boss while it is dispelled and healed
    h.hitBoss(180, 300);                  // re-engaged
    h.kill(302);

    const fights = h.bossFlushes();
    expect(fights).toHaveLength(1);
    expect(fights[0].encounter.confirmed_kill).toBe(true);
    expect(Date.parse(fights[0].encounter.started_at)).toBeLessThan(T0 + 10 * 1000);
  });

  it('the line is 5 minutes: a 4.5 min gap is one fight, a 5.5 min gap is two', () => {
    const near = harness();
    near.hitBoss(0, 120);
    near.trash(121, 120 + 270);
    near.hitBoss(390, 480);
    near.kill(482);
    expect(near.bossFlushes()).toHaveLength(1);

    const far = harness();
    far.hitBoss(0, 120);
    far.trash(121, 120 + 330);
    far.hitBoss(450, 540);
    far.kill(542);
    const two = far.bossFlushes();
    expect(two).toHaveLength(2);
    expect(two[0].encounter.confirmed_kill).toBe(false);
    expect(two[1].encounter.confirmed_kill).toBe(true);
  });

  it('a long fight whose boss keeps taking damage is never split by the trash around it', () => {
    const h = harness();
    h.hitBoss(0, 900);                    // 15 minutes of steady boss damage...
    h.trash(0, 900);                      // ...with adds dying alongside
    h.kill(902);
    const fights = h.bossFlushes();
    expect(fights).toHaveLength(1);
    expect(fights[0].encounter.confirmed_kill).toBe(true);
  });
});
