// test/deathroll-rolls-card.test.js — a deathroll is ONE line in the Rolls card
// and the Command Center, not a dozen "1 roller" sets.
//
// The guild lead, 2026-09-23: "These are called Deathrolls. First one to roll a
// zero loses" — option A: collapse each game into one expandable line, and say
// whose turn it is while it is still going. Runs the agent's REAL
// rollSetsSnapshot and the dashboard's REAL renderer.
//
// Run: npx vitest run test/deathroll-rolls-card.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const dash  = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const cmd   = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));

const snapBlock = sliceBlock(agent, 'const DEATHROLL_STEP_MS', '\n// Long-term who_data registry filter');
// The first captured game's ranges and timings; names invented. [who, top, result, sec]
const GAME = [
  ['Brackwyn', 32000, 11194, 0], ['Aldenmar', 11194, 6897, 8], ['Brackwyn', 6897, 5243, 14],
  ['Aldenmar', 5243, 1617, 18], ['Brackwyn', 1617, 736, 22], ['Aldenmar', 736, 527, 25],
  ['Brackwyn', 527, 93, 27], ['Aldenmar', 93, 12, 31], ['Brackwyn', 12, 6, 32],
  ['Aldenmar', 6, 1, 35], ['Brackwyn', 1, 0, 36],
];
// Local _rollSets, shaped as trackRollLine builds them (one set per range).
function setsFor(steps, t0) {
  return steps.map(([name, to, value, sec]) => {
    const atMs = t0 + sec * 1000;
    return { from: 0, to, item: null, qty: null, startMs: atMs, lastMs: atMs,
             rolls: [{ name, nameLower: name.toLowerCase(), value, atMs, reroll: false }] };
  });
}
function snapshot(rollSets) {
  const pre = 'const ROLL_SET_KEEP_MS = 2*60*60*1000; const ROLL_SET_GAP_MS = 10*60*1000;\n'
            + 'const _rollSets = ' + JSON.stringify(rollSets) + ';\n';
  return evalBlock(pre + snapBlock, ['rollSetsSnapshot']).rollSetsSnapshot();
}
const lootSet = (t0) => ({ from: 0, to: 333, item: null, qty: null, startMs: t0 - 60_000, lastMs: t0 - 50_000, rolls: [
  { name: 'Corvale', nameLower: 'corvale', value: 210, atMs: t0 - 60_000 },
  { name: 'Rethlan', nameLower: 'rethlan', value: 77, atMs: t0 - 55_000 },
] });

describe('a finished game', () => {
  const t0 = Date.now() - 90_000;
  const out = snapshot([lootSet(t0), ...setsFor(GAME, t0)]);
  const game = out.find(e => e.kind === 'deathroll');

  it('replaces its eleven sets with one entry, and leaves the loot roll alone', () => {
    expect(out).toHaveLength(2);
    expect(out.filter(e => e.kind === 'deathroll')).toHaveLength(1);
    expect(out.some(e => e.to === 333 && !e.kind)).toBe(true);
  });

  it('knows who lost, who won, where it started and how long it ran', () => {
    expect(game.to).toBe(32000);
    expect(game.deathroll.done).toBe(true);
    expect(game.deathroll.loser).toBe('Brackwyn');
    expect(game.deathroll.winners).toEqual(['Aldenmar']);
    expect(game.deathroll.steps).toHaveLength(11);
    expect(game.open).toBe(false);
  });

  it('keeps the set shape the Command Center keys dismiss/expand on', () => {
    expect(game.from).toBe(0);
    expect(game.started_at_ms).toBe(t0);
  });
});

describe('a game still going', () => {
  it('says whose turn it is and on what range', () => {
    const t0 = Date.now() - 36_000;          // last step 5s ago
    const g = snapshot(setsFor(GAME.slice(0, 8), t0)).find(e => e.kind === 'deathroll');
    expect(g.open).toBe(true);
    expect(g.deathroll.done).toBe(false);
    expect(g.deathroll.next).toEqual({ to: 12, name: 'Brackwyn' });
  });

  it('with three players, names the range but not the roller', () => {
    const steps = [['Brackwyn', 500, 300, 0], ['Aldenmar', 300, 120, 4], ['Corvale', 120, 40, 8]];
    const g = snapshot(setsFor(steps, Date.now() - 12_000)).find(e => e.kind === 'deathroll');
    expect(g.deathroll.next).toEqual({ to: 40, name: null });
  });

  it('left for more than two minutes, it is no longer live', () => {
    const g = snapshot(setsFor(GAME.slice(0, 8), Date.now() - 10 * 60_000)).find(e => e.kind === 'deathroll');
    expect(g.open).toBe(false);
    expect(g.deathroll.done).toBe(false);
  });
});

describe('the dashboard line', () => {
  const block = sliceBlock(dash, 'function _wpDeathrollHtml(e) {', "\n  return h + '</table></details>';\n}");
  const pre = 'function esc(s){return String(s);} function wpKeep(k){return "data-keep=\\"" + k + "\\"";}\n';
  const render = evalBlock(pre + block, ['_wpDeathrollHtml'])._wpDeathrollHtml;

  it('reads as one game with its result', () => {
    const e = snapshot(setsFor(GAME, Date.now() - 90_000)).find(x => x.kind === 'deathroll');
    const html = render(e);
    expect(html).toContain('Deathroll 32,000');
    expect(html).toContain('Brackwyn vs Aldenmar');
    expect(html).toContain('Brackwyn hit 0');
    expect(html).toContain('11 rolls');
    expect(html).toContain('<details data-keep="droll|');
  });

  it('while live, shows whose turn it is', () => {
    const e = snapshot(setsFor(GAME.slice(0, 8), Date.now() - 36_000)).find(x => x.kind === 'deathroll');
    expect(render(e)).toContain('Brackwyn to roll 0–12');
  });

  it('the Rolls card hands deathroll entries to that renderer', () => {
    const tab = stripJs(sliceBlock(dash, 'function renderLootTab(s) {', "var host = document.getElementById('wpLootRolls');"));
    expect(tab).toContain("if (rset.kind === 'deathroll') { h += _wpDeathrollHtml(rset); continue; }");
  });
});

describe('the Command Center row', () => {
  it('draws a deathroll as one row before the ordinary set row', () => {
    const body = stripJs(cmd);
    const at = body.indexOf("if (rs.kind === 'deathroll') {");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(body.indexOf("var winners = (rs.winners || []).map("));
    expect(body.slice(at, at + 3000)).toContain(' hit 0</span>');
  });
});
