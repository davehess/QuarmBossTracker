// test/pop-self-flags.test.js — members tick their own PoP flags on the site (the guild lead, 2026-10-03:
// "I need [a way] for people to be able to check off their own flags for their own characters outside of
// using mimic or relying on someone else with mimic to do it. they could do it on the matrix page or
// somewhere else that makes sense").
//
// One store: pop_guide_ticks, the table the /pop/guide checklist writes. A tick of a flag is the guide step
// that grants it, else `flag:<key>`. web/lib/popSelfFlags.ts is pure and runs for real here; the action's
// gate and the page's wiring are read as comment-stripped source, because they import the framework.
//
// Run: npx vitest run test/pop-self-flags.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs } from './_source-slice.js';
import { POP_FLAGS, POP_FLAG_DEFS, POP_ZONES, POP_ZONE_BY_KEY } from '../web/lib/popFlags.ts';
import { GUIDE_ITEMS, GUIDE_KEYS, tickedKeys } from '../web/lib/popGuide.ts';
import {
  FLAG_TICK_PREFIX, MAX_FLAGS_PER_TICK, SELF_TICK_KEYS, SELF_TICK_TITLE,
  tickKeyForFlag, tickKeysForFlag, flagForTickKey, selfFlagsFromTicks, gateState, proofFor,
} from '../web/lib/popSelfFlags.ts';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const real = POP_FLAG_DEFS.map(f => f.key).filter(k => k !== 'unmapped');
const none = new Set();

describe('a flag and the row that stores it', () => {
  it('a flag a guide step grants is stored as that step, so the checklist shows the tick', () => {
    expect(tickKeyForFlag('grummus_dead')).toBe('flag_grummus');
    expect(tickKeyForFlag('trial_justice')).toBe('flag_trial_justice');
    expect(tickKeyForFlag('zebuxoruk_2')).toBe('zebuxoruk_maelin');
    for (const i of GUIDE_ITEMS.filter(g => g.flag)) expect(tickKeyForFlag(i.flag), i.key).toBe(i.key);
  });

  it('a flag no step names is stored as flag:<key>', () => {
    for (const f of ['fuirstel_5', 'thelin_4', 'hoh_trials', 'stone_loot']) {
      expect(GUIDE_ITEMS.some(i => i.flag === f), f).toBe(false);
      expect(tickKeyForFlag(f)).toBe(`${FLAG_TICK_PREFIX}${f}`);
    }
  });

  it('refuses anything the catalog does not name, including what a plain object would claim to have', () => {
    for (const bad of ['', 'unmapped', 'hail', 'nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 7, null, undefined]) {
      expect(tickKeyForFlag(bad), String(bad)).toBeNull();
      expect(tickKeysForFlag(bad), String(bad)).toEqual([]);
    }
    expect(flagForTickKey('flag:constructor')).toBeNull();
    expect(flagForTickKey('flag:__proto__')).toBeNull();
    expect(flagForTickKey('flag:unmapped')).toBeNull();
  });

  it('every catalog flag round-trips: key → flag → key, and the key is one the table can hold', () => {
    for (const f of real) {
      const key = tickKeyForFlag(f);
      expect(flagForTickKey(key), f).toBe(f);
      expect(tickKeysForFlag(f), f).toContain(key);
      expect(GUIDE_KEYS.has(key) || key === `flag:${f}`, f).toBe(true);
      expect(SELF_TICK_KEYS, f).toContain(key);
    }
  });

  it('un-ticking can reach every key that counts: the step and the flag: spelling both', () => {
    expect(tickKeysForFlag('grummus_dead')).toEqual(['flag_grummus', 'flag:grummus_dead']);
    expect(tickKeysForFlag('fuirstel_5')).toEqual(['flag:fuirstel_5']);
  });

  it('a plain checklist step reports no flag; only keys that stand for one are read', () => {
    expect(flagForTickKey('start_level46')).toBeNull();
    expect(flagForTickKey('not_a_key')).toBeNull();
    for (const k of SELF_TICK_KEYS) expect(flagForTickKey(k), k).not.toBeNull();
    expect(SELF_TICK_KEYS).not.toContain('start_level46');
    expect(SELF_TICK_KEYS.every(k => GUIDE_KEYS.has(k) || k.startsWith(FLAG_TICK_PREFIX))).toBe(true);
  });
});

describe('selfFlagsFromTicks', () => {
  it('maps ticks to flags per character, case-blind, from both kinds of row', () => {
    const m = selfFlagsFromTicks([
      { character_name: 'Aldenmar', item_key: 'flag_grummus' },
      { character_name: 'Aldenmar', item_key: 'flag:fuirstel_5' },
      { character_name: 'aldenmar', item_key: 'flag:grummus_dead' },
      { character_name: 'Brackwyn', item_key: 'zebuxoruk_maelin' },
    ]);
    expect([...m.keys()].sort()).toEqual(['aldenmar', 'brackwyn']);
    expect([...m.get('aldenmar')].sort()).toEqual(['fuirstel_5', 'grummus_dead']);
    expect([...m.get('brackwyn')]).toEqual(['zebuxoruk_2']);
  });

  it('ignores steps that grant no flag, junk keys and unknown flags', () => {
    const m = selfFlagsFromTicks([
      { character_name: 'Corvale', item_key: 'start_level46' },
      { character_name: 'Corvale', item_key: 'flag:made_up' },
      { character_name: 'Corvale', item_key: 'flag:unmapped' },
      { character_name: 'Corvale', item_key: '' },
    ]);
    expect(m.size).toBe(0);
  });

  it('one store, both pages: a flag ticked on /pop ticks its step on the checklist, and the reverse', () => {
    // /pop ticks the Justice flag → the checklist's own tickedKeys sees the step done.
    expect(tickedKeys([tickKeyForFlag('trial_justice')], []).has('flag_trial_justice')).toBe(true);
    // The checklist ticks the Grummus step → /pop reads the Grummus flag.
    const m = selfFlagsFromTicks([{ character_name: 'Rethlan', item_key: 'flag_grummus' }]);
    expect(m.get('rethlan').has('grummus_dead')).toBe(true);
  });

  it('reads all of a large table without mixing characters up', () => {
    const rows = [];
    for (let n = 0; n < 300; n++) rows.push({ character_name: `Char${n}`, item_key: tickKeyForFlag(real[n % real.length]) });
    const m = selfFlagsFromTicks(rows);
    expect(m.size).toBe(300);
    expect([...m.get('char7')]).toEqual([real[7 % real.length]]);
  });
});

describe('one gate cell: who proved it, what a click does', () => {
  it('an open flag is not held and a click ticks it', () => {
    const g = gateState(['trial_justice'], {}, none);
    expect(g).toMatchObject({ access: false, mark: 'none', selfFlags: [], open: ['trial_justice'] });
    expect(g.toggle).toEqual({ action: 'tick', flags: ['trial_justice'] });
  });

  it('the owner’s tick holds the gate, shows ☑, and a click takes it back', () => {
    const g = gateState(['trial_justice'], {}, new Set(['trial_justice']));
    expect(g).toMatchObject({ access: true, mark: 'self', selfFlags: ['trial_justice'], open: [] });
    expect(g.toggle).toEqual({ action: 'untick', flags: ['trial_justice'] });
  });

  it('a cell Mimic or /who proved shows that proof and is not a toggle', () => {
    for (const proof of ['mimic', 'who']) {
      const g = gateState(['trial_justice'], { trial_justice: proof }, none);
      expect(g.access).toBe(true);
      expect(g.mark).toBe(proof);
      expect(g.toggle).toBeNull();
    }
  });

  it('a proof outranks a tick: the same flag proven AND ticked shows the proof and stays read-only', () => {
    for (const proof of ['mimic', 'who']) {
      const g = gateState(['trial_justice'], { trial_justice: proof }, new Set(['trial_justice']));
      expect(g.mark).toBe(proof);
      expect(g.selfFlags).toEqual([]);
      expect(g.toggle).toBeNull();
    }
  });

  it('a two-flag gate is only as proven as its weakest flag', () => {
    const req = ['fuirstel_5', 'thelin_4'];
    // One proven, one open: not held, and a click ticks only the open one.
    const half = gateState(req, { fuirstel_5: 'mimic' }, none);
    expect(half.access).toBe(false);
    expect(half.toggle).toEqual({ action: 'tick', flags: ['thelin_4'] });
    // One proven, one ticked: held on a tick, so ☑; a click takes back only the tick.
    const mixed = gateState(req, { fuirstel_5: 'mimic' }, new Set(['thelin_4']));
    expect(mixed).toMatchObject({ access: true, mark: 'self', selfFlags: ['thelin_4'] });
    expect(mixed.toggle).toEqual({ action: 'untick', flags: ['thelin_4'] });
    // /who on one and a tick on the other: still ☑.
    expect(gateState(req, { fuirstel_5: 'who' }, new Set(['thelin_4'])).mark).toBe('self');
    // Both proven: /who's blue wins over Mimic's green, and nothing to tick.
    const proven = gateState(req, { fuirstel_5: 'mimic', thelin_4: 'who' }, none);
    expect(proven.mark).toBe('who');
    expect(proven.toggle).toBeNull();
    // Both ticked at once, then both taken back at once.
    const both = gateState(req, {}, new Set(req));
    expect(both.toggle).toEqual({ action: 'untick', flags: req });
    expect(gateState(req, {}, none).toggle).toEqual({ action: 'tick', flags: req });
  });

  it('runs against the real gates: Torment and Sol Ro need two flags, the rest one', () => {
    expect(POP_ZONE_BY_KEY.torment.requires).toEqual(['fuirstel_5', 'thelin_4']);
    for (const z of POP_ZONES.filter(z => z.requires.length > 0)) {
      const g = gateState(z.requires, {}, new Set(z.requires));
      expect(g.access, z.key).toBe(true);
      expect(g.toggle.flags, z.key).toEqual(z.requires);
      // Every flag a gate asks for is one a member can tick.
      for (const f of z.requires) expect(tickKeyForFlag(f), `${z.key} ${f}`).not.toBeNull();
    }
  });
});

describe('proofFor', () => {
  it('says how each held flag is proven, and leaves ticked and missing flags out', () => {
    const c = {
      flags: new Set(['a', 'b', 'c']),
      seen: new Map([['b', { zone: 'storms' }]]),
      self: new Set(['c']),
    };
    expect(proofFor(['a', 'b', 'c', 'd'], c)).toEqual({ a: 'mimic', b: 'who' });
  });
});

describe('the tick action: gate, then write', () => {
  const raw = read('web/app/pop/guide/actions.ts');
  const src = stripJs(raw);
  const flagAction = stripJs(sliceBlock(raw, 'export async function setFlagTicks', '\n}\n'));
  const guideAction = stripJs(sliceBlock(raw, 'export async function setGuideTick', '\n}\n'));

  it('checks every flag against the catalog before anything is written, and caps how many', () => {
    expect(MAX_FLAGS_PER_TICK).toBeGreaterThanOrEqual(2);
    expect(flagAction).toMatch(/Array\.isArray\(flags\)/);
    expect(flagAction).toMatch(/flags\.length > MAX_FLAGS_PER_TICK/);
    const unknown = flagAction.indexOf("error: 'unknown flag'");
    const write = flagAction.indexOf('writeTicks(');
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBeLessThan(write);
    expect(flagAction).toMatch(/tickKeyForFlag\(f\)/);
  });

  it('writes nothing itself: the one gate (writeTicks) is the only place that touches the table', () => {
    expect(flagAction).not.toMatch(/from\(/);
    expect(guideAction).not.toMatch(/from\(/);
    expect(src.match(/from\('pop_guide_ticks'\)/g)).toHaveLength(2);   // the upsert and the delete
    const gate = src.indexOf('async function writeTicks(');
    expect(gate).toBeGreaterThan(0);
    expect(src.lastIndexOf("from('pop_guide_ticks')")).toBeGreaterThan(gate);
    expect(src.indexOf("from('pop_guide_ticks')")).toBeGreaterThan(gate);
  });

  it('signs in and proves ownership before any write, under the character’s real name', () => {
    const write = src.indexOf("from('pop_guide_ticks')");
    for (const gateText of ['auth.getUser()', 'ownedCharacters(user.id)', "error: 'not your character'"]) {
      const at = src.indexOf(gateText);
      expect(at, gateText).toBeGreaterThan(0);
      expect(at, gateText).toBeLessThan(write);
    }
    expect(src).toMatch(/character_name: owned\.name/);
    expect(src).toMatch(/\.eq\('character_name', owned\.name\)/);
    expect(src).not.toMatch(/character_name: character\b/);
  });

  it('un-ticking removes every key that counts as the report, not just the one it would write', () => {
    expect(flagAction).toMatch(/tickKeysForFlag\(f\)/);
    expect(src).toMatch(/\.in\('item_key', remove\)/);
  });

  it('refreshes /pop and /pop/guide after a flag tick, and /pop after a guide tick', () => {
    expect(flagAction).toMatch(/revalidatePath\('\/pop'\)/);
    expect(flagAction).toMatch(/revalidatePath\('\/pop\/guide'\)/);
    expect(guideAction).toMatch(/revalidatePath\('\/pop'\)/);
  });

  it('still refuses a step the guide does not define', () => {
    expect(guideAction).toMatch(/!GUIDE_KEYS\.has\(itemKey\)/);
  });
});

describe('the page: the owner’s cells are buttons, everyone else’s are marks', () => {
  const raw = read('web/app/pop/page.tsx');
  const page = stripJs(raw);
  const cell = stripJs(sliceBlock(raw, 'function GateCell(', '\n  }\n'));
  const accessMark = stripJs(sliceBlock(raw, 'function AccessMark(', '\n  }\n'));

  it('reads the ticks from the guide table by the keys that stand for a flag', () => {
    expect(page).toMatch(/from\('pop_guide_ticks'\)/);
    expect(page).toMatch(/\.in\('item_key', SELF_TICK_KEYS\)/);
    expect(page).toMatch(/selfFlagsFromTicks\(tickRows\)/);
  });

  it('applies a tick LAST and never over a flag Mimic or /who already holds', () => {
    expect(page.indexOf('flagsFromSightings(rows)')).toBeGreaterThan(0);
    expect(page.indexOf('selfFlagsFromTicks(tickRows)')).toBeGreaterThan(page.indexOf('flagsFromSightings(rows)'));
    const merge = page.slice(page.indexOf('selfFlagsFromTicks(tickRows)'));
    expect(merge.slice(0, 900)).toMatch(/if \(c\.flags\.has\(f\)\) continue;[\s\S]*c\.self\.add\(f\)/);
    // Only the roster and the viewer's own characters, like /who.
    expect(merge.slice(0, 300)).toMatch(/if \(!nameOf\.has\(k\)\) continue;/);
  });

  it('turns a cell into the owner’s button only for a character the viewer owns', () => {
    expect(cell).toMatch(/if \(!owned\) return <AccessMark z=\{z\} c=\{c\} \/>;/);
    expect(cell.indexOf('<OwnedGateCell')).toBeGreaterThan(cell.indexOf('if (!owned)'));
    expect(page.match(/<OwnedGateCell/g)).toHaveLength(1);
    // The matrix decides per row from the viewer's own characters, hidden and low-level ones included.
    expect(page).toMatch(/const ownedKeys = new Set\(myCharsAll\.map\(c => c\.name\.toLowerCase\(\)\)\);/);
    expect(page).toMatch(/const owned = ownedKeys\.has\(c\.name\.toLowerCase\(\)\);/);
    expect(page).toMatch(/<GateCell z=\{z\} c=\{c\} owned=\{owned\} \/>/);
    // My Characters lists only the viewer's characters, so every one of its cells is theirs.
    expect(page).toMatch(/<GateCell z=\{z\} c=\{f\} owned \/>/);
  });

  it('never gives another member’s cell a button: the matrix has no other path to one', () => {
    const matrix = page.slice(page.indexOf('<SelfFlagsProvider initial={ownTicks(scopedChars)}>'));
    const end = matrix.indexOf('</SelfFlagsProvider>');
    const table = matrix.slice(0, end);
    expect(table).not.toMatch(/<OwnedGateCell/);
    expect(table).not.toMatch(/<AccessMark/);
    expect(table).toMatch(/owned \? <OwnedFlagCount/);
  });

  it('seeds each table’s provider with the viewer’s own ticks only', () => {
    expect(page).toMatch(/rows\.filter\(r => ownedKeys\.has\(r\.name\.toLowerCase\(\)\)\)/);
    expect(page.match(/<SelfFlagsProvider initial=/g)).toHaveLength(2);   // My Characters and the matrix
  });

  it('shows a tick as its own gold ☑, with the title, and lets a proof outrank it', () => {
    expect(SELF_TICK_TITLE).toBe('Ticked by its owner on the site');
    expect(accessMark).toMatch(/gateState\(z\.requires, proofFor\(z\.requires, c\), c\.self\)/);
    expect(accessMark).toMatch(/g\.mark === 'self' \? selfTitle\(z, c\)/);
    expect(accessMark).toMatch(/<GateMark kind=\{g\.mark\}/);
    expect(page).toMatch(/\$\{SELF_TICK_TITLE\}: /);
    const mark = stripJs(read('web/app/pop/GateMark.tsx'));
    expect(mark).toMatch(/self: \{ glyph: '☑', cls: 'text-gold' \}/);
    expect(mark).toMatch(/mimic: \{ glyph: '✓', cls: 'text-green' \}/);
    expect(mark).toMatch(/who: \{ glyph: '✓', cls: 'text-blue' \}/);
  });

  it('has a legend next to the tables, and counts the ticks on the chart', () => {
    expect(page).toMatch(/const gateLegend = \(/);
    expect(page.match(/\{gateLegend\}|&& gateLegend\}/g)).toHaveLength(2);   // My Characters and the matrix
    expect(page).toMatch(/selfFlagCount\.get\(f\)/);
  });

  it('keeps the matrix in its one horizontal scroller and adds no wrapper that could widen the page', () => {
    const m = page.indexOf('<SelfFlagsProvider initial={ownTicks(scopedChars)}>');
    const before = page.slice(page.lastIndexOf('<section', m), m);
    expect(before).toMatch(/overflow-x-auto/);
    const provider = stripJs(read('web/app/pop/SelfFlagCells.tsx'));
    expect(provider).toMatch(/<SelfFlags\.Provider value=\{ctx\}>/);
    expect(provider).not.toMatch(/<div/);
  });
});

describe('what the browser loads', () => {
  // popSelfFlags imports the guide catalog (60 KB of text) for the flag ↔ row mapping; the button, the mark
  // and the gate rules are all the browser needs, and must not drag it in. The page stays server-side.
  it('the button, the mark and the gate rules never import the guide catalog or the flag catalog', () => {
    for (const p of ['web/app/pop/SelfFlagCells.tsx', 'web/app/pop/GateMark.tsx', 'web/lib/popGateCell.ts']) {
      const from = [...stripJs(read(p)).matchAll(/^import [^\n]* from '([^']+)'/gm)].map(m => m[1]);
      for (const f of from) expect(f, p).not.toMatch(/popGuide|popSelfFlags|popFlags/);
    }
    expect(stripJs(read('web/lib/popGateCell.ts'))).not.toMatch(/^import /m);
  });

  it('popSelfFlags re-exports the gate rules, so the server page imports from one place', () => {
    expect(typeof gateState).toBe('function');
    expect(typeof proofFor).toBe('function');
    expect(SELF_TICK_TITLE).toBe('Ticked by its owner on the site');
  });
});

describe('the cell component: a button only where there is something to tick', () => {
  const src = stripJs(read('web/app/pop/SelfFlagCells.tsx'));
  const cell = stripJs(sliceBlock(read('web/app/pop/SelfFlagCells.tsx'), 'export function OwnedGateCell', '\n}\n'));

  it('is a keyboard-reachable, labelled toggle', () => {
    expect(cell).toMatch(/<button\s+type="button"/);
    expect(cell).toMatch(/aria-pressed=\{g\.access\}/);
    expect(cell).toMatch(/aria-label=/);
    expect(cell).toMatch(/focus-visible:outline/);
  });

  it('returns a plain mark BEFORE it can return a button when every flag is proven', () => {
    const readOnly = cell.indexOf('if (!ctx || !g.toggle)');
    expect(readOnly).toBeGreaterThan(0);
    expect(readOnly).toBeLessThan(cell.indexOf('<button'));
    expect(cell.slice(readOnly, cell.indexOf('<button'))).toMatch(/return mark \?/);
  });

  it('asks the gate what a click does, and sends exactly those flags', () => {
    expect(cell).toMatch(/gateState\(requires\.map\(r => r\.key\), proof, ctx\?\.self\(character\) \?\? NONE\)/);
    expect(cell).toMatch(/ctx\.toggle\(character, t\.action, t\.flags\)/);
  });

  it('flips first, saves in a transition, and puts the flags back with the reason when the save fails', () => {
    expect(src).toMatch(/apply\(character, flags, on\);[\s\S]*start\(async \(\) => \{[\s\S]*await setFlagTicks\(character, flags, on\)/);
    expect(src).toMatch(/if \(!res\.ok\) \{ apply\(character, flags, !on\); setError\(/);
    expect(src).toMatch(/role="alert"/);
    expect(src).toMatch(/useTransition\(\)/);
  });

  it('keeps the row count live: proven flags plus whatever is ticked now, counted once', () => {
    expect(src).toMatch(/new Set\(\[\.\.\.proven, \.\.\.\(ctx\?\.self\(character\) \?\? NONE\)\]\)\.size/);
  });
});
