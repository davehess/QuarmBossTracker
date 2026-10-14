// test/roll-tie.test.js — two characters on the same top number is a TIE, shown as one and settled by deathroll.
//
// The guild lead, 2026-10-14, from a Rolls card reading `611 (Carved Bone Ring) — <name> 507 · 7 rolls open`
// with two characters both on 507: "if two toons roll the same number on a roll it should trigger a
// deathroll and highlight the tie". The agent decides it ONCE (rollSetTies, carried on the snapshot as
// `tie` / `lower_ties`); the dashboard's Rolls card and the Command Center only draw it. Everything here
// runs the REAL shipped functions. Names are invented.
//
// Run: npx vitest run test/roll-tie.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import * as detector from '../utils/deathroll.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const dash  = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const cmd   = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));

// rollSetTies + _rollTieResolve + rollSetsSnapshot live in one block with the deathroll chain code.
const snapBlock = sliceBlock(agent, 'const DEATHROLL_STEP_MS', '\n// Long-term who_data registry filter');
const supersededBlock = sliceBlock(agent, 'const ROLL_RELABEL_QUIET_MS', '\n}\n');
const PRE = 'const ROLL_SET_KEEP_MS = 2*60*60*1000; const ROLL_SET_GAP_MS = 10*60*1000;\n'
          + 'const _rollItemByNumber = new Map();\n' + supersededBlock + '\n';
const { rollSetTies } = evalBlock(PRE + snapBlock, ['rollSetTies']);
function snapshot(rollSets) {
  return evalBlock(PRE + 'const _rollSets = ' + JSON.stringify(rollSets) + ';\n' + snapBlock, ['rollSetsSnapshot']).rollSetsSnapshot();
}

const T0 = Date.now() - 120_000;
const roll = (name, value, sec = 0) => ({ name, nameLower: name.toLowerCase(), value, atMs: T0 + sec * 1000 });
// A set as trackRollLine builds it; `rolls` are [name, value, sec] triples.
const set = (to, rolls, extra = {}) => {
  const rs = rolls.map(([n, v, s]) => ({ ...roll(n, v, s), reroll: false }));
  const seen = new Set();
  for (const r of rs) { if (seen.has(r.nameLower)) r.reroll = true; seen.add(r.nameLower); }
  return { from: 0, to, item: null, qty: null, startMs: rs[0].atMs, lastMs: rs[rs.length - 1].atMs, rolls: rs, ...extra };
};
const ITEM = [['Corvale', 400, 0], ['Aldenmar', 507, 2], ['Rethlan', 310, 4], ['Brackwyn', 507, 6]];
const tieSet = (extra) => set(611, ITEM, { item: 'Carved Bone Ring', ...extra });

describe('rollSetTies — which tie decides the item', () => {
  it('two characters on the highest number are a top tie, in the order they rolled', () => {
    const t = rollSetTies(tieSet().rolls, null);
    expect(t.top.value).toBe(507);
    expect(t.top.names).toEqual(['Aldenmar', 'Brackwyn']);
    expect(t.lower).toEqual([]);
  });

  it('a tie lower down is only marked, and triggers nothing', () => {
    const t = rollSetTies([roll('Aldenmar', 600), roll('Brackwyn', 300, 1), roll('Corvale', 300, 2), roll('Rethlan', 100, 3)], null);
    expect(t.top).toBe(null);
    expect(t.lower).toEqual([300]);
  });

  it('the same character rolling the same number twice is a re-roll, not a tie', () => {
    const t = rollSetTies([roll('Aldenmar', 507), roll('Brackwyn', 300, 1), roll('Aldenmar', 507, 5)], null);
    expect(t.top).toBe(null);
    expect(t.lower).toEqual([]);
  });

  it('a re-roll never joins the top: only the first roll counts', () => {
    const t = rollSetTies([roll('Aldenmar', 100), roll('Brackwyn', 300, 1), roll('Aldenmar', 300, 5)], null);
    expect(t.top).toBe(null);
  });

  it('three on the top number are one three-way tie', () => {
    const t = rollSetTies([roll('Aldenmar', 507), roll('Brackwyn', 507, 1), roll('Corvale', 507, 2), roll('Rethlan', 9, 3)], null);
    expect(t.top.names).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
  });

  it('a later, lower roll does not break the tie', () => {
    const rolls = [roll('Aldenmar', 507), roll('Brackwyn', 507, 1), roll('Corvale', 12, 90), roll('Rethlan', 506, 120)];
    expect(rollSetTies(rolls, null).top.names).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('a higher roll after the tie replaces it', () => {
    expect(rollSetTies([roll('Aldenmar', 507), roll('Brackwyn', 507, 1), roll('Corvale', 580, 9)], null).top).toBe(null);
  });

  it('two winners linked on the item: a top pair is not contested, a top trio is', () => {
    const pair = [roll('Aldenmar', 507), roll('Brackwyn', 507, 1), roll('Corvale', 3, 2)];
    expect(rollSetTies(pair, 2).top).toBe(null);
    const trio = [...pair, roll('Rethlan', 507, 3)];
    expect(rollSetTies(trio, 2).top.names).toHaveLength(3);
  });
});

describe('the snapshot — what every surface receives', () => {
  it('carries the tie on the set, still named and counted as before', () => {
    const e = snapshot([tieSet()]).find(x => x.to === 611);
    expect(e.tie.value).toBe(507);
    expect(e.tie.names).toEqual(['Aldenmar', 'Brackwyn']);
    expect(e.tie.state).toBe('pending');
    expect(e.item).toBe('Carved Bone Ring');
    expect(e.players).toBe(4);
  });

  it('the starter is whoever rolled the tied number first', () => {
    expect(snapshot([tieSet()])[0].tie.starter).toBe('Aldenmar');
  });

  it('an ordinary set carries no tie, and a lower tie carries only its number', () => {
    const clean = snapshot([set(333, [['Aldenmar', 200, 0], ['Brackwyn', 100, 1]])])[0];
    expect(clean.tie).toBeUndefined();
    expect(clean.lower_ties).toBeUndefined();
    const low = snapshot([set(333, [['Aldenmar', 300, 0], ['Brackwyn', 100, 1], ['Corvale', 100, 2]])])[0];
    expect(low.tie).toBeUndefined();
    expect(low.lower_ties).toEqual([100]);
  });
});

describe('the tie\'s deathroll — fed by the same rule the deathroll detector uses', () => {
  // The follow-ups are ordinary /random sets: the tied number is the first range, then each result.
  const follow = (steps) => steps.map(([name, to, value, sec]) => set(to, [[name, value, sec]]));

  it('starts at the tied number, so a /random 507 chains straight onto the 0-611 roll', () => {
    const e = snapshot([tieSet()]).find(x => x.to === 611);
    expect(e.tie.state).toBe('pending');
    expect(e.tie.starter).toBe('Aldenmar');
    expect(e.tie.value).toBe(507);
  });

  it('a game in progress: says whose roll it is and on what range', () => {
    const g = follow([['Aldenmar', 507, 211, 20], ['Brackwyn', 211, 90, 24]]);
    const e = snapshot([tieSet(), ...g]).find(x => x.to === 611);
    expect(e.tie.state).toBe('live');
    expect(e.tie.next).toEqual({ to: 90, name: 'Aldenmar' });
  });

  it('settles on the first 0: the other character wins, and the header winners follow', () => {
    const g = follow([['Aldenmar', 507, 211, 20], ['Brackwyn', 211, 90, 24], ['Aldenmar', 90, 0, 28]]);
    const e = snapshot([tieSet(), ...g]).find(x => x.to === 611);
    expect(e.tie.state).toBe('done');
    expect(e.tie.out).toEqual(['Aldenmar']);
    expect(e.tie.winners).toEqual(['Brackwyn']);
    expect(e.winners).toEqual([{ name: 'Brackwyn', value: 507 }]);
  });

  it('a two-roll game still settles it, even though the detector wants three rolls to count a game', () => {
    const g = follow([['Brackwyn', 507, 2, 20], ['Aldenmar', 2, 0, 24]]);
    const e = snapshot([tieSet(), ...g]).find(x => x.to === 611);
    expect(e.tie.winners).toEqual(['Brackwyn']);
  });

  it('the follow-up sets do not sit beside the tie as one-roller sets', () => {
    const g = follow([['Aldenmar', 507, 211, 20], ['Brackwyn', 211, 90, 24], ['Aldenmar', 90, 0, 28]]);
    const out = snapshot([tieSet(), ...g]);
    expect(out.map(x => x.to)).toEqual([611]);
    expect(out.some(x => x.kind === 'deathroll')).toBe(false);   // not drawn a second time as "Deathroll 611"
  });

  it('a roll by someone who was not tied, or on the wrong range, does not move it', () => {
    const g = follow([['Corvale', 507, 0, 20], ['Aldenmar', 400, 0, 22]]);
    const e = snapshot([tieSet(), ...g]).find(x => x.to === 611);
    expect(e.tie.state).toBe('pending');
  });

  it('two perfect rolls on the top of the range: those rolls are the tie, not the start of its game', () => {
    const e = snapshot([set(507, [['Aldenmar', 507, 0], ['Brackwyn', 507, 2]])])[0];
    expect(e.tie.state).toBe('pending');
    expect(e.tie.steps).toEqual([]);
  });

  it('a character cannot roll twice in a row', () => {
    const g = follow([['Aldenmar', 507, 211, 20], ['Aldenmar', 211, 0, 24]]);
    const e = snapshot([tieSet(), ...g]).find(x => x.to === 611);
    expect(e.tie.state).toBe('live');
  });

  it('three tied: the first 0 puts one out and the other two start again from the tied number', () => {
    const three = set(611, [['Aldenmar', 507, 0], ['Brackwyn', 507, 2], ['Corvale', 507, 4]]);
    const round1 = follow([['Aldenmar', 507, 30, 20], ['Brackwyn', 30, 0, 24]]);
    const mid = snapshot([three, ...round1]).find(x => x.to === 611);
    expect(mid.tie.state).toBe('live');
    expect(mid.tie.out).toEqual(['Brackwyn']);
    expect(mid.tie.remaining).toEqual(['Aldenmar', 'Corvale']);
    const round2 = follow([['Corvale', 507, 5, 40], ['Aldenmar', 5, 0, 44]]);
    const end = snapshot([three, ...round1, ...round2]).find(x => x.to === 611);
    expect(end.tie.state).toBe('done');
    expect(end.tie.winners).toEqual(['Corvale']);
  });
});

describe('the dashboard Rolls card', () => {
  const block = sliceBlock(dash, 'function _wpRollTieChip(label) {', "\n  return '';\n}");
  const pre = 'function esc(s){return String(s);}\n';
  const { _wpRollWhoHtml, _wpRollTiePrompt, _wpRollRowMark } = evalBlock(pre + block, ['_wpRollWhoHtml', '_wpRollTiePrompt', '_wpRollRowMark']);
  const entry = (extra) => ({ ...snapshot([tieSet(extra)])[0] });
  const g = (steps) => steps.map(([name, to, value, sec]) => set(to, [[name, value, sec]]));

  it('the header shows the tie instead of one winner', () => {
    const html = _wpRollWhoHtml(entry());
    expect(html).toContain('TIE 507');
    expect(html).toContain('Aldenmar · Brackwyn');
    expect(html).not.toContain('<b>507</b>');
  });

  it('an ordinary set still shows its winners with their numbers', () => {
    const e = snapshot([set(333, [['Aldenmar', 200, 0], ['Brackwyn', 100, 1]])])[0];
    expect(_wpRollWhoHtml(e)).toBe('Aldenmar <b>200</b>');
    expect(_wpRollTiePrompt(e)).toBe('');
  });

  it('prompts the deathroll with the starter and the tied number', () => {
    expect(_wpRollTiePrompt(entry())).toContain('Tie → deathroll: Aldenmar starts with /random 507');
  });

  it('once played, the header and prompt name the deathroll winner', () => {
    const e = snapshot([tieSet(), ...g([['Aldenmar', 507, 211, 20], ['Brackwyn', 211, 90, 24], ['Aldenmar', 90, 0, 28]])]).find(x => x.to === 611);
    expect(_wpRollWhoHtml(e)).toContain('TIE 507');
    expect(_wpRollWhoHtml(e)).toContain('Brackwyn</span> won the deathroll');
    expect(_wpRollTiePrompt(e)).toContain('Deathroll over: Brackwyn wins');
  });

  it('marks the tied rows TIE, a lower tie only with "=", and nobody else', () => {
    const e = snapshot([set(611, [['Aldenmar', 507, 0], ['Brackwyn', 507, 1], ['Corvale', 300, 2], ['Rethlan', 300, 3], ['Nyssara', 12, 4]])])[0];
    const row = (n, v) => _wpRollRowMark(e, { name: n, value: v });
    expect(row('Aldenmar', 507)).toContain('>TIE<');
    expect(row('Brackwyn', 507)).toContain('>TIE<');
    expect(row('Corvale', 300)).not.toContain('TIE');
    expect(row('Corvale', 300)).toContain('=');
    expect(row('Nyssara', 12)).toBe('');
  });

  it('a re-roll of the tied number is not marked', () => {
    expect(_wpRollMarkFor({ reroll: true })).toBe('');
    function _wpRollMarkFor(extra) { return _wpRollRowMark(entry(), { name: 'Aldenmar', value: 507, ...extra }); }
  });

  it('the card draws them', () => {
    const tab = stripJs(sliceBlock(dash, 'function renderLootTab(s) {', "var host = document.getElementById('wpLootRolls');"));
    expect(tab).toContain('var rWinners = _wpRollWhoHtml(rset);');
    expect(tab).toContain('h += _wpRollTiePrompt(rset);');
    expect(tab).toContain('_wpRollRowMark(rset, rr)');
  });
});

describe('the Command Center row', () => {
  const block = sliceBlock(cmd, 'function rollTieWhoHtml(rs) {', "join('').slice(0, DR_COPY_MAX);\n  }");
  const pre = 'function esc(s){return String(s);} var DR_COPY_MAX = 250;\n';
  const { rollTieWhoHtml, rollTiePromptText, rollTieRowHtml, rollTieCopyLine } =
    evalBlock(pre + block, ['rollTieWhoHtml', 'rollTiePromptText', 'rollTieRowHtml', 'rollTieCopyLine']);
  const entry = (extra) => snapshot([tieSet(extra)])[0];

  it('the row names the tie, not a winner', () => {
    const html = rollTieWhoHtml(entry());
    expect(html).toContain('TIE 507');
    expect(html).toContain('Aldenmar · Brackwyn');
  });

  it('the expanded set says what to do', () => {
    expect(rollTiePromptText(entry())).toBe('Tie → deathroll: Aldenmar starts with /random 507');
  });

  it('tied rows carry the chip and the tie class; a lower tie a dim "="; a re-roll nothing', () => {
    const e = snapshot([set(611, [['Aldenmar', 507, 0], ['Brackwyn', 507, 1], ['Corvale', 300, 2], ['Rethlan', 300, 3]])])[0];
    expect(rollTieRowHtml(e, { name: 'Aldenmar', value: 507 })).toEqual({ cls: ' tie', mark: '<span class="tt">TIE</span>' });
    expect(rollTieRowHtml(e, { name: 'Corvale', value: 300 }).cls).toBe('');
    expect(rollTieRowHtml(e, { name: 'Corvale', value: 300 }).mark).toContain('class="eq"');
    expect(rollTieRowHtml(e, { name: 'Aldenmar', value: 507, reroll: true })).toEqual({ cls: '', mark: '' });
  });

  it('copies ONE raid-say line announcing the deathroll, plain ASCII, within a chat line', () => {
    const line = rollTieCopyLine(entry());
    expect(line).toBe('/rs TIE 507 on Carved Bone Ring: Aldenmar vs Brackwyn. Deathroll! Aldenmar rolls /random 507, '
      + 'then each rolls what the last got. First to 0 loses.');
    expect([...line].every(ch => ch.charCodeAt(0) < 128)).toBe(true);
    expect(line.length).toBeLessThanOrEqual(250);
  });

  it('a three-way tie says "is out", and a long item name cannot push the line past a chat line', () => {
    const e = snapshot([set(611, [['Aldenmar', 507, 0], ['Brackwyn', 507, 1], ['Corvale', 507, 2]], { item: 'X'.repeat(300) })])[0];
    const line = rollTieCopyLine(e);
    expect(line).toContain('Aldenmar vs Brackwyn vs Corvale');
    expect(line).toContain('First to 0 is out.');
    expect(line.length).toBeLessThanOrEqual(250);
  });

  it('after the game it announces who won', () => {
    const g = [['Aldenmar', 507, 211, 20], ['Brackwyn', 211, 90, 24], ['Aldenmar', 90, 0, 28]].map(([n, to, v, s]) => set(to, [[n, v, s]]));
    const e = snapshot([tieSet(), ...g]).find(x => x.to === 611);
    expect(rollTieCopyLine(e)).toBe('/rs Deathroll over on Carved Bone Ring: Brackwyn wins the 507 tie.');
  });

  it('the row and the copy button are wired for ties, and the copy sends nothing to the game', () => {
    const body = stripJs(cmd);
    expect(body).toContain("rs.tie ? rollTieWhoHtml(rs)");
    expect(body).toContain("rset.kind === 'deathroll' ? deathrollCopyLine(rset) : rollTieCopyLine(rset)");
    expect(body).toContain("if (rs.tie) html += '<div class=\"d tiebox\">'");
  });
});

describe('end to end — real log lines in, the bot\'s own deathroll detector out', () => {
  const tracker = sliceBlock(agent, 'const _ROLL_DIE_RX', '\n// ── Deathrolls (the guild lead');
  const pre = sliceBlock(agent, 'const TS_RX', '\n') + '\n'
    + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}') + '\n'
    + sliceBlock(agent, 'const _CH_SPEAKER_RX', '\n') + '\n'
    + 'const funEventBuffer = [];\n';
  const load = () => evalBlock(pre + tracker + '\n' + snapBlock,
    ['trackRollLine', '_rollSets', 'rollSetsSnapshot']);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = (n) => String(n).padStart(2, '0');
  const base = Date.now() - 6 * 60_000;
  const stamp = (sec) => { const d = new Date(base + sec * 1000);
    return `[${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}]`; };
  function say(m, sec, who, to, value) {
    m.trackRollLine(`${stamp(sec)} **A Magic Die is rolled by ${who}.`, 'Corvale');
    m.trackRollLine(`${stamp(sec)} **It could have been any number from 0 to ${to}, but this time it turned up a ${value}.`, 'Corvale');
  }
  // What uploadRollSets sends the bot for each set.
  const rowsOf = (m) => m._rollSets.map(s => ({ roll_from: s.from, roll_to: s.to, started_at: new Date(s.startMs).toISOString(),
    rolls: s.rolls.map(r => ({ name: r.name, value: r.value, at: new Date(r.atMs).toISOString() })) }));

  it('the follow-ups the card asks for are a deathroll to the bot, and it agrees on the winner', () => {
    const m = load();
    say(m, 0, 'Corvale', 611, 400); say(m, 2, 'Aldenmar', 611, 507);
    say(m, 4, 'Rethlan', 611, 310); say(m, 6, 'Brackwyn', 611, 507);
    expect(m.rollSetsSnapshot()[0].tie.starter).toBe('Aldenmar');
    say(m, 30, 'Aldenmar', 507, 211); say(m, 34, 'Brackwyn', 211, 90); say(m, 38, 'Aldenmar', 90, 0);
    const tie = m.rollSetsSnapshot().find(e => !e.kind).tie;
    expect(tie.state).toBe('done');
    expect(tie.winners).toEqual(['Brackwyn']);
    const games = detector.deathrollsFromRows(rowsOf(m));
    expect(games).toHaveLength(1);
    expect(games[0].loser).toBe('Aldenmar');
    expect(games[0].winners).toEqual(['Brackwyn']);
  });

  it('started long after the tie, the bot still sees a game that opens on the tied number', () => {
    const m = load();
    say(m, 0, 'Aldenmar', 611, 507); say(m, 3, 'Brackwyn', 611, 507);
    say(m, 200, 'Aldenmar', 507, 211); say(m, 205, 'Brackwyn', 211, 90); say(m, 209, 'Aldenmar', 90, 0);
    expect(m.rollSetsSnapshot().find(e => !e.kind).tie.winners).toEqual(['Brackwyn']);
    const games = detector.deathrollsFromRows(rowsOf(m));
    expect(games).toHaveLength(1);
    expect(games[0].start).toBe(507);
  });
});
