// test/deathroll-copy.test.js — 📋 on a Command Center deathroll copies the whole game as one line.
//
// The guild lead, 2026-09-29: "add in a copy button for deathrolls". The line is pasted into EQ chat, so
// it is plain ASCII and at most 250 characters; a long game keeps its opening roll and as many of the
// last rolls as fit, with "..." between. Runs the page's REAL deathrollCopyLine.
//
// Run: npx vitest run test/deathroll-copy.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
const { deathrollCopyLine, DR_COPY_MAX } = evalBlock(
  sliceBlock(cmd, 'var DR_COPY_MAX = 250;', '\n  }\n'), ['deathrollCopyLine', 'DR_COPY_MAX']);

// Names invented. [who, top, rolled]
const game = (steps, { done = true, open = false, next = null } = {}) => ({
  kind: 'deathroll', to: steps[0][1], open,
  deathroll: {
    players: [...new Set(steps.map(s => s[0]))],
    steps: steps.map(([name, to, value]) => ({ name, to, value })),
    done, loser: done ? steps[steps.length - 1][0] : null, next,
  },
});
const SHORT = [['Aldenmar', 32000, 26189], ['Brackwyn', 26189, 24160], ['Corvale', 24160, 10371],
  ['Aldenmar', 10371, 155], ['Brackwyn', 155, 2], ['Corvale', 2, 0]];

describe('the copied deathroll line', () => {
  it('reads as the game in order, and names who lost', () => {
    expect(deathrollCopyLine(game(SHORT))).toBe(
      'Deathroll 32,000: Aldenmar 26189 > Brackwyn 24160 > Corvale 10371 > Aldenmar 155 > Brackwyn 2 > Corvale 0. Corvale loses.');
  });

  it('a game still going says whose roll it is', () => {
    const live = game(SHORT.slice(0, 3), { done: false, open: true, next: { name: 'Aldenmar', to: 10371 } });
    expect(deathrollCopyLine(live)).toBe(
      'Deathroll 32,000: Aldenmar 26189 > Brackwyn 24160 > Corvale 10371. Aldenmar to roll 0-10371.');
  });

  it('a long game fits one chat line: the first roll, "...", then the last rolls that fit', () => {
    const steps = [];
    let top = 999999;
    for (let i = 0; i < 40; i++) { const v = Math.max(0, top - 1 - i * 17); steps.push([i % 2 ? 'Brackwyn' : 'Aldenmar', top, v]); top = v; }
    steps.push(['Corvale', top, 0]);
    const line = deathrollCopyLine(game(steps));
    expect(line.length).toBeLessThanOrEqual(DR_COPY_MAX);
    expect(line.startsWith('Deathroll 999,999: Aldenmar 999998 > ... > ')).toBe(true);
    expect(line.endsWith('Corvale 0. Corvale loses.')).toBe(true);
    // It keeps as many of the last rolls as fit: one more would not.
    const kept = line.split(' > ... > ')[1].split(' > ').length;
    const oneMore = 'Deathroll 999,999: Aldenmar 999998 > ... > '
      + steps.slice(steps.length - kept - 1).map(([n, , v]) => n + ' ' + v).join(' > ') + '. Corvale loses.';
    expect(oneMore.length).toBeGreaterThan(DR_COPY_MAX);
  });

  it('is plain ASCII, which EQ chat can show', () => {
    for (const line of [deathrollCopyLine(game(SHORT)),
      deathrollCopyLine(game(SHORT.slice(0, 2), { done: false, open: true, next: { name: null, to: 24160 } }))]) {
      expect([...line].every(ch => ch.charCodeAt(0) < 128), line).toBe(true);
    }
  });
});

describe('the button', () => {
  const code = stripJs(cmd);
  it('sits on every deathroll row and copies that row\'s own game', () => {
    expect(code).toMatch(/'<span class="rollCopy" data-roll-id="' \+ esc\(rid\) \+ '"/);
    expect(code).toMatch(/if \(_rollId\(_lastState\.rolls\[rc\]\) === rcid\) \{ rset = _lastState\.rolls\[rc\]; break; \}/);
    expect(code).toMatch(/_copyText\(deathrollCopyLine\(rset\)/);
  });
  it('works on a locked Command Center: it is on the hover handshake', () => {
    const hovers = code.match(/\bt\.closest\('\.rollCopy'\)/g) || [];
    expect(hovers.length).toBe(2);   // mouseover (interactive on) and mouseout (off)
  });
});
