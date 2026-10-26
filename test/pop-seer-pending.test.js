// test/pop-seer-pending.test.js — the Seer's PENDING memories (the guild lead, 2026-10-26).
//
// A member whose kill left a checklist flag (the step before it was missing) says 'unlock memories' and Seer Mal
// Nae`Shi prints the second entry of that flag's row in her `checklistFlags` table instead of granting the step. A
// partway character's log carried two of them ("a small trinket by Grummus' body", "the Warlord's flaming axe") and no
// reader knew either. Source: poknowledge/Seer_Mal_Nae-Shi.lua (eqemu_quest_scripts body, read 2026-10-26); the
// verbatim sentences are in test/fixtures/seer-pending-memories.json, the same file on main and beta.
//
// What is pinned: every sentence is read by the web reader, the bot's resolver (and, on beta, the agent's gate); it is
// recorded as a PENDING memory (flag_key cl_*), never as a step; stepsHeld/heldClosure carry nothing from it; and the
// helper that turns one into a "do this next" hint says the right thing for ready / blocked / done.
//
// Run: npx vitest run test/pop-seer-pending.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './_source-slice.js';
import {
  PENDING_MEMORIES, PENDING_OPENING, RECITAL_STAGES, parseRecital, heldClosure, pendingHint, pendingNext, norm,
} from '../web/lib/popRecital.ts';
import { parsePopFlags } from '../web/lib/popFlagsPaste.ts';
import { POP_STEPS } from '../web/lib/popSteps.ts';
import { stepsHeld } from '../web/lib/popSteps.ts';

const require = createRequire(import.meta.url);
const S = require(path.join(ROOT, 'utils', 'popFlagStages.js'));
const fx = (n) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', n), 'utf8');
const SCRIPT = JSON.parse(fx('seer-pending-memories.json'));          // [{ key, text|null }] in the script's order
const B_RECITAL = fx('seer-recital-real-b.txt');
const B_FLAGS = fx('popflags-real-b.txt');
const sorted = (a) => [...a].sort();
const STAMP = '[Mon Oct 26 21:10:01 2026] ';

describe('the table is the script\'s', () => {
  it('fifteen rows in the script\'s order, each sentence verbatim; the two blanks stay blank', () => {
    expect(PENDING_MEMORIES.map(m => [m.key, m.text])).toEqual(SCRIPT.map(s => [s.key, s.text]));
    expect(SCRIPT.filter(s => s.text === null).map(s => s.key)).toEqual(['cl_maze', 'cl_behemoth']);
  });
  it('every prerequisite and result is a step our catalog keeps (or the one bit string), and results are never prerequisites', () => {
    const steps = new Set(Object.values(POP_STEPS).flat().map(s => s.key));
    for (const m of PENDING_MEMORIES) {
      expect(steps.has(m.gives), m.key + ' gives ' + m.gives).toBe(true);
      expect(steps.has(m.needs) || m.needs === 'hohtrials_111', m.key + ' needs ' + m.needs).toBe(true);
      expect(m.needs, m.key).not.toBe(m.gives);
    }
  });
  it('the opening used to match is unique and collides with no recital sentence', () => {
    const open = PENDING_MEMORIES.filter(m => m.text).map(m => norm(m.text).slice(0, PENDING_OPENING));
    expect(new Set(open).size).toBe(open.length);
    for (const o of open) for (const [prefix] of RECITAL_STAGES) {
      expect(o.startsWith(norm(prefix)) || norm(prefix).startsWith(o), o).toBe(false);
    }
  });
});

describe('the web reader', () => {
  for (const m of SCRIPT.filter(s => s.text)) {
    it(`${m.key}: recorded as pending, no step, no unknown line (bare, stamped, wrapped, curly quote)`, () => {
      const cut = m.text.indexOf(' ', 40);                       // a copy wraps at a space
      const wrapped = m.text.slice(0, cut) + '\n' + m.text.slice(cut + 1);
      for (const t of [m.text, STAMP + m.text, wrapped, m.text.replace(/'/g, '’')]) {
        const p = parseRecital(t);
        expect(p.pending, t.slice(0, 30)).toEqual([m.key]);
        expect(p.stages, t.slice(0, 30)).toEqual([]);
        expect(p.unknown, t.slice(0, 30)).toEqual([]);
      }
    });
  }
  it('nothing near it counts: a sentence that merely starts like one, or a bare keyword', () => {
    for (const t of ['Grummus', "You remember seeing a small trinket", 'cl_grummus', 'You remember seeing a small trinket by Grumm']) {
      expect(parseRecital(t).pending, t).toEqual([]);
    }
  });
  it('a pending memory is not a step: held closure is empty, and so is what a save would write', () => {
    for (const m of SCRIPT.filter(s => s.text)) {
      const p = parseRecital(m.text);
      expect([...heldClosure(p.stages)]).toEqual([]);
      expect([...stepsHeld(p.stages)]).toEqual([]);
      expect([...stepsHeld(p.pending)].filter(k => !k.startsWith('cl_'))).toEqual([]);
    }
  });
});

describe('the bot resolves the same sentences', () => {
  it('each one to its checklist flag, as a recital, with nothing implied', () => {
    for (const m of SCRIPT.filter(s => s.text)) {
      for (const text of [m.text.slice(0, 160), m.text]) {      // the agent sends the first 160 characters
        const ev = { kind: 'recital', source: 'recital', text, character: 'Aldenmar', ts: '2026-10-26T21:10:01.000Z' };
        expect(S.resolveStage(ev, ''), m.key).toEqual({ stage: m.key, via: 'recital' });
        expect(S.STAGE_IMPLIES[m.key], m.key).toBeUndefined();
      }
    }
  });
  it('the bot\'s openings are the web table\'s sentences\' beginnings, one each, and only for the sentences the script has', () => {
    const want = SCRIPT.filter(s => s.text).map(s => s.key);
    expect(S.PENDING_RECITAL.map(r => r[1])).toEqual(want);
    for (const [opening, key] of S.PENDING_RECITAL) {
      const full = SCRIPT.find(s => s.key === key).text;
      expect(norm(full).startsWith(norm(opening).replace(/\s+/g, ' ')), key).toBe(true);
    }
  });
  it('never a popflags-source key: the #popflags closed vocabulary still holds no cl_* memory', () => {
    for (const [, key] of S.PENDING_RECITAL) expect(S.POPFLAGS_KEYS.has(key), key).toBe(false);
  });
  it('the existing sentences still resolve as before (a pending opening never shadows one)', () => {
    for (const [prefix, stage] of S.RECITAL_STAGES) {
      expect(S.resolveStage({ kind: 'recital', text: prefix }, ''), stage).toEqual({ stage, via: 'recital' });
    }
  });
});

describe('the real recital (a partway character, 2026-10-26) with its #popflags', () => {
  const rec = parseRecital(B_RECITAL);
  const flags = parsePopFlags(B_FLAGS).flags;
  it('reads five known sentences as steps and the two new ones as PENDING: Grummus and Rallos', () => {
    expect(sorted(rec.stages)).toEqual(sorted(['karana_2', 'aerindar_2', 'mavuin_3', 'thelin_4', 'grummus_1', 'zeks_3', 'zeks_4']));
    expect(rec.pending).toEqual(['cl_grummus', 'cl_rallos']);
    expect(rec.unknown).toEqual([]);
    expect(rec.lines).toBe(9);
  });
  it('nothing extra is completed: no Fuirstel 2, no Zek 6 or 7, no Warlord, and no cl_* among the steps', () => {
    const held = heldClosure([...rec.stages, ...flags]);
    for (const k of ['fuirstel_1', 'fuirstel_2', 'zeks_5', 'zeks_6', 'zeks_7', 'rallos_dead', 'pofire_2']) expect(held.has(k), k).toBe(false);
    for (const k of held) expect(k.startsWith('cl_'), k).toBe(false);
    // …while what the recital and #popflags both prove is there
    for (const k of ['grummus_1', 'thelin_4', 'zeks_3', 'zeks_4', 'aerindar_2', 'karana_3']) expect(held.has(k), k).toBe(true);
  });
  it('the two pending hints: Grummus waits for the Fuirstel hail, Rallos for Maelin\'s Zek notes', () => {
    const held = stepsHeld(heldClosure([...rec.stages, ...flags]));
    const [g, r] = pendingNext(rec.pending, held);
    expect(g).toMatchObject({ key: 'cl_grummus', state: 'blocked', step: 'fuirstel_1' });
    expect(g.text).toMatch(/Adler Fuirstel/);
    expect(g.text).toMatch(/unlock memories/);
    expect(r).toMatchObject({ key: 'cl_rallos', state: 'blocked', step: 'zeks_6' });
    expect(r.text).toMatch(/Maelin/);
  });
});

describe('pendingHint: ready, blocked, moot', () => {
  const H = (...keys) => stepsHeld(keys);
  it('ready when the step it waits for is held and the one it grants is not: say "unlock memories"', () => {
    const h = pendingHint('cl_grummus', H('fuirstel_1'));
    expect(h).toMatchObject({ key: 'cl_grummus', state: 'ready', step: 'fuirstel_2' });
    expect(h.text).toMatch(/unlock memories/);
  });
  it('blocked when it is missing, naming that step and where it is done', () => {
    const h = pendingHint('cl_grummus', H());
    expect(h).toMatchObject({ state: 'blocked', step: 'fuirstel_1' });
    expect(h.text).toMatch(/Tranquility/);
  });
  it('moot when the step it would grant is already held: nothing to do', () => {
    expect(pendingHint('cl_grummus', H('fuirstel_2'))).toMatchObject({ state: 'moot', step: null });
    expect(pendingHint('cl_rallos', H('zeks_7'))).toMatchObject({ state: 'moot' });
  });
  it('every row, from the script\'s own pairs (popflags.cpp PopFlagsHasReadyMemory)', () => {
    const PAIRS = { // key: [prerequisite, result]
      cl_grummus: ['fuirstel_1', 'fuirstel_2'], cl_maze: ['thelin_1', 'thelin_2'], cl_behemoth: ['zeks_1', 'zeks_2'],
      cl_aerindar: ['mavuin_3', 'aerindar_2'], cl_terris: ['thelin_2', 'thelin_3'], cl_bertox: ['fuirstel_3', 'fuirstel_4'],
      cl_keeper: ['tylis_1', 'tylis_2'], cl_saryrn: ['tylis_2', 'saryrn_1'], cl_vallon: ['zeks_2', 'zeks_3'],
      cl_tallon: ['zeks_2', 'zeks_4'], cl_rallos: ['zeks_6', 'zeks_7'], cl_karana: ['karana_3', 'karana_4'],
      cl_mmarr: ['hohtrials_111', 'mmarr_1'], cl_mmarr_book: ['hohtrials_111', 'mmarr_book_1'], cl_solusek: ['zeks_7', 'pofire_2'],
    };
    expect(PENDING_MEMORIES.map(m => m.key)).toEqual(Object.keys(PAIRS));
    for (const [key, [needs, gives]] of Object.entries(PAIRS)) {
      expect(pendingHint(key, new Set()), key).toMatchObject({ state: 'blocked', step: needs });
      expect(pendingHint(key, new Set([needs])), key).toMatchObject({ state: 'ready', step: gives });
      expect(pendingHint(key, new Set([needs, gives])), key).toMatchObject({ state: 'moot', step: null });
      expect(pendingHint(key, new Set()).text, key).not.toMatch(/^Do this first: [a-z_]+\d?\./);   // a plain-words label, never a bare key
    }
  });
  it('Vallon after Tallon (zeks 4) and Tallon after Vallon (zeks 3) are still ready, as the script allows', () => {
    expect(pendingHint('cl_vallon', H('zeks_4'))).toMatchObject({ state: 'ready', step: 'zeks_3' });
    expect(pendingHint('cl_tallon', H('zeks_3'))).toMatchObject({ state: 'ready', step: 'zeks_4' });
  });
  it('a key that is not a checklist memory gives nothing; pendingNext keeps the script\'s order and skips strangers', () => {
    expect(pendingHint('fuirstel_2', H())).toBeNull();
    expect(pendingNext(['cl_rallos', 'bogus', 'cl_grummus'], H()).map(h => h.key)).toEqual(['cl_grummus', 'cl_rallos']);
    expect(pendingNext([], H())).toEqual([]);
  });
});
