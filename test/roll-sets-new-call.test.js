// FB-45: a later loot call that reuses the same roll numbers starts NEW roll sets with the
// new items. The guild lead, 2026-10-01: "when we do rolls way later we should post the new
// items - we had a long time in between these rolls and we should have made them separate
// rolls even if it's the same numbers". Runs the real roll tracker over log lines shaped
// like that night: one call at 22:08 (111/222/333), a second at 22:15 reusing the numbers.
// Names are invented.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tracker = sliceBlock(src, 'const _ROLL_DIE_RX', '\n// ── Deathrolls (the guild lead');
const snap = sliceBlock(src, 'const DEATHROLL_STEP_MS', '\n// Long-term who_data registry filter');
const pre = sliceBlock(src, 'const TS_RX', '\n') + '\n'
  + sliceBlock(src, 'function parseEqTimestamp(line) {', '\n}') + '\n'
  + sliceBlock(src, 'const _CH_SPEAKER_RX', '\n') + '\n'
  + 'const funEventBuffer = [];\n';

function load() {
  return evalBlock(pre + tracker + '\n' + snap,
    ['trackRollLine', 'trackRollItemLine', '_rollSets', '_rollItemByNumber', 'rollSetsSnapshot', 'ROLL_RELABEL_QUIET_MS']);
}
const ts = (hh, mm, ss) => `[Wed Sep 30 ${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} 2026]`;
function call(m, t, who, text) { m.trackRollItemLine(`${ts(...t)} ${who} tells the raid,  '${text}'`); }
function roll(m, t, who, to, value) {
  m.trackRollLine(`${ts(...t)} **A Magic Die is rolled by ${who}.`, 'Aldenmar');
  m.trackRollLine(`${ts(...t)} **It could have been any number from 0 to ${to}, but this time it turned up a ${value}.`, 'Aldenmar');
}

describe('a later call reusing the same numbers', () => {
  it('starts new sets under the new items, and the old sets keep their own rolls', () => {
    const m = load();
    call(m, [22, 8, 10], 'Corvale', "Frakadar's Talisman 111| Gauntlets of Mortality 222 | Massive Dragonclaw Shard 333");
    roll(m, [22, 8, 30], 'Brackwyn', 222, 80);
    roll(m, [22, 8, 40], 'Rethlan', 333, 12);
    roll(m, [22, 9, 5], 'Nyssara', 333, 171);
    // Seven minutes later, inside the 10-minute same-range window: new items on 111/222/333.
    call(m, [22, 15, 44], 'Corvale', "Scroll of Power 111| Spell: Aegolism | Vaniki's Heart 222 | Willsapper 333");
    roll(m, [22, 16, 0], 'Rethlan', 333, 280);
    roll(m, [22, 16, 10], 'Zarrin', 333, 333);
    roll(m, [22, 16, 20], 'Brackwyn', 222, 56);

    const s333 = m._rollSets.filter(s => s.to === 333);
    expect(s333.map(s => s.item)).toEqual(['Massive Dragonclaw Shard', 'Willsapper']);
    expect(s333[0].rolls.map(r => r.name)).toEqual(['Rethlan', 'Nyssara']);
    expect(s333[1].rolls.map(r => r.name)).toEqual(['Rethlan', 'Zarrin']);
    // Rethlan rolled once per item: neither roll is a re-roll.
    expect(s333[1].rolls[0].reroll).toBe(false);
    expect(m._rollSets.filter(s => s.to === 222).map(s => s.item)).toEqual(['Gauntlets of Mortality', "Vaniki's Heart"]);
  });

  it('shows the old set closed and the new one open', () => {
    const m = load();
    const now = Date.now();
    const at = (secAgo) => new Date(now - secAgo * 1000);
    // Same shape, but timed against now so the snapshot's "open" window applies.
    const z = (n) => String(n).padStart(2, '0');
    const tsNow = (d) => { const p = d.toDateString().split(' ');   // Thu Oct 01 2026
      return `[${p[0]} ${p[1]} ${p[2]} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())} ${p[3]}]`; };
    const c = (t, text) => m.trackRollItemLine(`${tsNow(t)} Corvale tells the raid,  '${text}'`);
    const r = (t, who, value) => {
      m.trackRollLine(`${tsNow(t)} **A Magic Die is rolled by ${who}.`, 'Aldenmar');
      m.trackRollLine(`${tsNow(t)} **It could have been any number from 0 to 333, but this time it turned up a ${value}.`, 'Aldenmar');
    };
    c(at(400), 'Massive Dragonclaw Shard 333');
    r(at(390), 'Rethlan', 12);
    c(at(60), 'Willsapper 333');
    r(at(50), 'Zarrin', 300);
    const sets = m.rollSetsSnapshot().filter(s => s.to === 333);
    const byItem = Object.fromEntries(sets.map(s => [s.item, s.open]));
    expect(byItem).toEqual({ 'Massive Dragonclaw Shard': false, Willsapper: true });
  });
});

describe('what does not start a new set', () => {
  it('the same item posted again as a reminder', () => {
    const m = load();
    call(m, [22, 8, 10], 'Corvale', 'Willsapper 333');
    roll(m, [22, 8, 30], 'Rethlan', 333, 12);
    call(m, [22, 11, 0], 'Corvale', 'Willsapper 333 still open');   // posted again
    roll(m, [22, 11, 20], 'Zarrin', 333, 300);
    expect(m._rollItemByNumber.get(333).atMs).toBeGreaterThan(m._rollSets[0].startMs);   // the repost did register
    expect(m._rollSets.filter(s => s.to === 333)).toHaveLength(1);
  });

  it('a call that comes just after the first rolls names that set', () => {
    const m = load();
    roll(m, [22, 8, 0], 'Rethlan', 333, 12);
    call(m, [22, 8, 54], 'Corvale', 'Willsapper 333');   // 54 s late, as measured once
    roll(m, [22, 9, 10], 'Zarrin', 333, 300);
    const s333 = m._rollSets.filter(s => s.to === 333);
    expect(s333).toHaveLength(1);
    expect(s333[0].item).toBe('Willsapper');
    expect(s333[0].rolls).toHaveLength(2);
  });

  it('but an unnamed set gone quiet, then a call, is a new wave', () => {
    const m = load();
    roll(m, [22, 0, 0], 'Rethlan', 333, 12);
    call(m, [22, 5, 0], 'Corvale', 'Willsapper 333');    // five quiet minutes later
    roll(m, [22, 5, 20], 'Zarrin', 333, 300);
    const s333 = m._rollSets.filter(s => s.to === 333);
    expect(s333.map(s => s.item)).toEqual([null, 'Willsapper']);
  });
});
