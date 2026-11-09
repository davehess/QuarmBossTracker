// test/coirnav-counter.test.js — the Command Center's fiend counter for Coirnav the Avatar of Water (Plane of Water).
//
// The guild lead, 2026-11-04: "Do we have a fiend counter for the 75 for command center?" Quarm's script
// (powater/encounters/Coirnav.lua): the Guardian's death starts a 900 s clock; 25 fiends at 0:00, 3:00, 5:00 (the
// waves are clock-driven, not kill-driven); 75 deaths open Coirnav; the lings never count. Runs the agent's REAL
// tracker (sliced from the source) and the overlay's REAL coirnavHtml. The emote texts are the script's own RP()
// strings, taken as plain log lines (an assumption: no live capture of them exists yet).
//
// Run: npx vitest run test/coirnav-counter.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const zoneBlock = sliceBlock(agentSrc, 'const MAP_ZONE_SHORT = ', 'return Number.isFinite(n) && n > 0 ? (MAP_ZONE_SHORT[n] || null) : null;\n}');
const block = sliceBlock(agentSrc, 'const _DEATH_SLAIN_BY_RX', '// ── end Coirnav fiend counter');
const zoneRxBlock = sliceBlock(agentSrc, 'const CHAT_ZONE_RX = ', '\n');

let zeal, T;
function fresh() {
  zeal = {};
  const make = new Function('_zealState', zoneBlock + '\n' + zoneRxBlock + '\n' + block + '\nreturn { note: _coirnavNoteLine, snap: _coirnavSnapshot, state: _coirnavState };');
  return make(zeal);
}
beforeEach(() => { T = fresh(); zeal[WHO] = { zone: 216 }; });   // powater

const WHO = 'Aldenmar';
const t0 = Date.UTC(2026, 10, 4, 20, 0, 0);
const say = (text, now = t0) => T.note(`[Wed Nov 04 20:00:00 2026] ${text}`, WHO, now);
const slainBy = (mob, now = t0) => say(`${mob} has been slain by Brackwyn!`, now);
const snap = (now = t0) => T.snap(WHO, now);

const shout = (who, tail) => `Coirnav the Avatar of Water shouts, "Those that violate my domain will pay. I call upon the power imbued to me by ${who}! ${tail} and destroy these intruders."`;
const W1 = shout('Povar', 'Come forth my minions of vapor');
const W2 = shout('E`ci', 'Come forth my minions of ice');
const W3 = shout('Tarew Marr', 'Come forth minions of water');
const BURN = 'The currents wrench across the reef as Pwelon, Nrinda and Vamuil gather before Coirnav. The Triumvirate speaks as one through the Avatar of Water: "We will permit no further advance. Pwelon, Nrinda, Vamuil - unite and drive these invaders from the depths!"';
const FINAL = 'Water surges, ice fractures and vapor coils through the reef as Coirnav summons the remaining defenders of the depths. The Triumvirate\'s voices thunder as one: "We shall not yield! Defenders of vapor, ice and water - rise! Let the depths claim these invaders!"';
const WON = 'Coirnav, the Avatar of Water, has fallen! His colossal form collapses, driving a thunderous shockwave through the reef.';
const LOST = 'Three voices thunder as one through Coirnav. "The Triumvirate has spoken! These waters reject you. Be banished from our domain!" A crushing surge tears through the reef.';
const FIENDS = ['A triloun vaporfiend', 'A hraquis icefiend', 'A regrua waterfiend'];
const kill = (n, wave = 1, now = t0) => { for (let i = 0; i < n; i++) slainBy(FIENDS[wave - 1], now); };

describe('a full run', () => {
  it('is null before anything happens', () => { expect(snap()).toBeNull(); });

  it('Guardian dies, three waves of deaths (lings ignored), 75, success', () => {
    slainBy('Guardian of Coirnav');
    expect(snap()).toMatchObject({ state: 'waves', kills: 0, wave: 1, started_at: t0, deadline_at: t0 + 900e3 });
    say(W1);
    kill(25, 1);
    slainBy('A triloun vaporling'); slainBy('A hraquis iceling'); slainBy('A regrua waterling');
    expect(snap(t0 + 100e3).kills).toBe(25);
    say(W2, t0 + 180e3);
    kill(25, 2, t0 + 200e3);
    expect(snap(t0 + 200e3)).toMatchObject({ kills: 50, wave: 2 });
    say(W3, t0 + 300e3);
    kill(24, 3, t0 + 330e3);
    expect(snap(t0 + 330e3)).toMatchObject({ state: 'waves', kills: 74, wave: 3 });
    slainBy('A regrua waterfiend', t0 + 340e3);
    expect(snap(t0 + 340e3)).toMatchObject({ state: 'burn', kills: 75 });
    say(BURN, t0 + 345e3);
    slainBy('A triloun vaporfiend', t0 + 350e3);   // never above 75
    expect(snap(t0 + 350e3).kills).toBe(75);
    say(WON, t0 + 600e3);
    expect(snap(t0 + 600e3)).toMatchObject({ state: 'done' });
    expect(snap(t0 + 600e3 + 4 * 60e3)).not.toBeNull();
    expect(snap(t0 + 600e3 + 6 * 60e3)).toBeNull();
  });

  it('a lings-only stream never counts, and the burn emote alone moves to 75', () => {
    slainBy('Guardian of Coirnav');
    slainBy('A triloun vaporling');
    expect(snap().kills).toBe(0);
    kill(10);
    say(BURN);
    expect(snap()).toMatchObject({ state: 'burn', kills: 75 });
  });

  // The guild lead, 2026-11-09: "we should also include the three minis after the 3 waves".
  it('the three minis after the 75: each death ticks, the early wave minis never count', () => {
    slainBy('Guardian of Coirnav');
    slainBy('Pwelon of Vapor', t0 + 60e3);                 // wave 1's early miniboss: not one of the three
    expect(snap(t0 + 60e3).minis_down).toEqual([false, false, false]);
    say(BURN, t0 + 400e3);
    expect(snap(t0 + 400e3)).toMatchObject({ state: 'burn', minis_down: [false, false, false] });
    slainBy('Nrinda of Ice', t0 + 450e3);
    say('You have slain Vamuil of Water!', t0 + 460e3);
    expect(snap(t0 + 460e3).minis_down).toEqual([false, true, true]);
    slainBy('Pwelon of Vapor', t0 + 470e3);
    expect(snap(t0 + 470e3)).toMatchObject({ state: 'burn', minis_down: [true, true, true] });
  });
  it('the final-phase emote marks all three down even when the deaths were out of range', () => {
    slainBy('Guardian of Coirnav');
    kill(30);
    say(FINAL, t0 + 500e3);
    expect(snap(t0 + 500e3)).toMatchObject({ state: 'burn', kills: 75, minis_down: [true, true, true] });
  });

  it('the fail run: banished, retry 20 minutes after, row gone after that', () => {
    slainBy('Guardian of Coirnav');
    kill(40);
    say(LOST, t0 + 900e3);
    expect(snap(t0 + 901e3)).toMatchObject({ state: 'banished', kills: 40, retry_at: t0 + 900e3 + 1200e3 });
    expect(snap(t0 + 900e3 + 1100e3)).not.toBeNull();
    expect(snap(t0 + 900e3 + 1300e3)).toBeNull();
  });

  it('a clock that ran out with no verdict line goes after two minutes', () => {
    slainBy('Guardian of Coirnav');
    expect(snap(t0 + 900e3 + 60e3)).not.toBeNull();
    expect(snap(t0 + 900e3 + 130e3)).toBeNull();
  });

  it('a retry starts fresh over a banished or finished row', () => {
    slainBy('Guardian of Coirnav');
    kill(40);
    say(LOST, t0 + 900e3);
    slainBy('Guardian of Coirnav', t0 + 2200e3);
    expect(snap(t0 + 2200e3)).toMatchObject({ state: 'waves', kills: 0, started_at: t0 + 2200e3 });
  });
});

describe('starting and the clock', () => {
  it('the wave 1 shout starts it when the Guardian was missed', () => {
    say(W1);
    expect(snap()).toMatchObject({ state: 'waves', wave: 1, started_at: t0 });
  });
  it('joining at wave 2 or 3 puts the start back on the clock', () => {
    say(W2);
    expect(snap()).toMatchObject({ wave: 2, started_at: t0 - 180e3 });
    T.state.clear();
    say(W3);
    expect(snap()).toMatchObject({ wave: 3, started_at: t0 - 300e3 });
  });
  it('a second start while running (Guardian then the shout) does not reset', () => {
    slainBy('Guardian of Coirnav');
    kill(5);
    say(W1);
    slainBy('Guardian of Coirnav');
    expect(snap().kills).toBe(5);
  });
  it('the wave follows the clock when a shout is missed', () => {
    slainBy('Guardian of Coirnav');
    expect(snap(t0 + 179e3).wave).toBe(1);
    expect(snap(t0 + 181e3).wave).toBe(2);
    expect(snap(t0 + 301e3).wave).toBe(3);
  });
});

describe('zone gate and scope', () => {
  it('a Guardian death outside Plane of Water starts nothing', () => {
    zeal[WHO] = { zone: 210 };
    slainBy('Guardian of Coirnav');
    expect(snap()).toBeNull();
  });
  it('falls back to the log zone line when Zeal has no zone', () => {
    delete zeal[WHO];
    slainBy('Guardian of Coirnav');
    expect(snap()).toBeNull();
    say('You have entered Plane of Water.');
    slainBy('Guardian of Coirnav');
    expect(snap()).not.toBeNull();
  });
  // The guild lead, 2026-11-05: "I died and lost the timer, it should persist through the timer".
  it('dying and respawning at bind keeps the clock running; it still ends at the deadline', () => {
    slainBy('Guardian of Coirnav');
    const before = snap();
    say('You have entered Plane of Tranquility.');
    zeal[WHO] = { zone: 203 };
    expect(snap()).toMatchObject({ started_at: before.started_at, deadline_at: before.deadline_at, state: 'waves' });
  });
  it('fiend deaths with no run do not start one', () => {
    kill(3);
    expect(snap()).toBeNull();
  });
  it('keeps one tracker per character', () => {
    slainBy('Guardian of Coirnav');
    expect(T.snap('Corvale', t0)).toBeNull();
  });
});

describe('Command Center row', () => {
  const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
  const coirnavHtml = evalBlock(sliceBlock(cmd, '  function coirnavHtml(v, nowMs){', '\n  }'), ['coirnavHtml']).coirnavHtml;
  const plain = (h) => h.replace(/<[^>]+>/g, '');
  const base = { state: 'waves', kills: 37, total: 75, wave: 2, started_at: 1_000_000, deadline_at: 1_000_000 + 900e3 };
  const row = (o, secs) => coirnavHtml({ ...base, ...o }, base.started_at + secs * 1000);

  it('waves: count, next wave countdown, time left, and the clock sub', () => {
    // 200 s in: wave 3 is 100 s away, 700 s (11:40) left
    expect(plain(row({ wave: 2 }, 200))).toBe('🌊 Coirnav: fiends 37/75 · wave 3 in 1:40 · 11:40 left');
    expect(plain(row({ kills: 18, wave: 1 }, 138))).toContain('fiends 18/75 · wave 2 in 0:42 · 12:42 left');
  });
  it('after wave 3 it just names the wave', () => {
    expect(plain(row({ wave: 3, kills: 60 }, 359))).toBe('🌊 Coirnav: fiends 60/75 · wave 3 · 9:01 left');
  });
  it('flashes "wave N soon" only in the last 30 seconds before the next wave', () => {
    expect(row({ kills: 18, wave: 1 }, 149)).not.toContain('crit');
    const h = row({ kills: 18, wave: 1 }, 168);
    expect(h).toContain('class="coirnav crit"');
    expect(plain(h)).toContain('wave 2 soon (0:12)');
    expect(plain(row({ wave: 2 }, 280))).toContain('wave 3 soon (0:20)');
  });
  it('is byte-stable apart from the numbers', () => {
    const shape = (h) => h.replace(/\d+/g, '#');
    expect(shape(row({ kills: 5, wave: 1 }, 10))).toBe(shape(row({ kills: 6, wave: 1 }, 11)));
  });
  it('warns that killing faster will not bring the wave, at 20 (wave 1) and 45 (wave 2)', () => {
    expect(plain(row({ kills: 20, wave: 1 }, 100))).toContain('wave 1 nearly down — wave 2 arrives on the clock at 3:00');
    expect(plain(row({ kills: 19, wave: 1 }, 100))).not.toContain('nearly down');
    expect(plain(row({ kills: 45, wave: 2 }, 250))).toContain('wave 2 nearly down — wave 3 arrives on the clock at 5:00');
    expect(plain(row({ kills: 45, wave: 3 }, 320))).not.toContain('nearly down');
    expect(stripJs(cmd)).not.toMatch(/15:00 clock from the Guardian/);   // the guild lead, 2026-11-09: not needed
  });
  it('a wave the clock has passed counts as arrived even if the agent had not said so yet', () => {
    expect(plain(row({ wave: 1, kills: 30 }, 190))).toContain('wave 3 in');
  });
  it('burn, done and banished', () => {
    expect(plain(row({ state: 'burn', kills: 75, minis_down: [false, false, false] }, 288))).toBe('🌊 Coirnav: 75 down · minis 0/3 · 10:12 left' + 'Pwelon · Nrinda · Vamuil');
    expect(plain(row({ state: 'burn', kills: 75, minis_down: [false, true, false] }, 288))).toBe('🌊 Coirnav: 75 down · minis 1/3 · 10:12 left' + 'Pwelon · ✓ Nrinda · Vamuil');
    expect(plain(row({ state: 'burn', kills: 75, minis_down: [true, true, true] }, 288))).toBe('🌊 Coirnav: minis down · burn Coirnav · 10:12 left');
    expect(plain(row({ state: 'done' }, 500))).toBe('🌊 Coirnav has fallen');
    const b = row({ state: 'banished', retry_at: base.started_at + 2100e3 }, 905);
    expect(plain(b)).toMatch(/^🌊 Banished · retry at /);
    expect(b).toContain('coirnav bad');
  });
  it('is wired into render only when s.coirnav is present, and the agent sends it', () => {
    expect(stripJs(cmd)).toMatch(/if \(s\.coirnav\) html \+= coirnavHtml\(s\.coirnav, Date\.now\(\)\);/);
    expect(stripJs(agentSrc)).toMatch(/coirnav:\s+_coirnavSnapshot\(activeChar, Date\.now\(\)\)/);
    expect(stripJs(agentSrc)).toMatch(/_coirnavNoteLine\(line, b\.character, Date\.now\(\)\)/);
  });
});
