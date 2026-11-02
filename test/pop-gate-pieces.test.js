// test/pop-gate-pieces.test.js — "what exactly am I missing for this gate?" (the guild lead, 2026-11-01, shown a table of
// characters against "Saryrn's half / Marr's half / Vallon's notes / Tallon's notes" and "only the Seer and Maelin
// left?": "this format is needed for the pop guide - the side bar where it says specifically what you're missing, not
// just the last thing mentioned"). web/lib/popGatePieces.ts opens each gate flag into its pieces; web/lib/popGateStatus.ts
// says which of them a character has, and the one-line verdict. Both are pure.
//
// No character appears here at all: each case is a bag of flag keys, and the case is what matters, not who. (The page
// tests read source text, so the table and the status file stay free of names by construction: they hold none.)
//
// Run: npx vitest run test/pop-gate-pieces.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { POP_FLAGS, POP_ZONES, POP_ZONE_BY_KEY } from '../web/lib/popFlags.ts';
import { PENDING_MEMORIES } from '../web/lib/popRecital.ts';
import { charNextSteps, nextCard } from '../web/lib/popNextSteps.ts';
import { REQ_PIECES, ALL_PIECES, GATES, gatePieces, piecesForBlocker } from '../web/lib/popGatePieces.ts';
import {
  stagesHeld, heldFor, pieceStatus, verdictFor, gateReport, gateCardEntries, gateKeyOr, gateMode, DEFAULT_GATE,
} from '../web/lib/popGateStatus.ts';
import popFlagStages from '../utils/popFlagStages.js';

const { POPFLAGS_KEYS } = popFlagStages;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PIECE = Object.fromEntries(ALL_PIECES.map(p => [p.key, p]));
const sol = POP_ZONE_BY_KEY.solro;

// The Sol Ro table for one character: piece key → state.
const states = (input, zone = sol) => Object.fromEntries(gateReport(zone, input).pieces.map(p => [p.key, p.state]));

describe('the table of pieces', () => {
  it('has unique keys', () => {
    const keys = ALL_PIECES.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is built from the catalog: every gate requirement has an entry, and every entry is some gate\'s requirement', () => {
    const required = new Set(POP_ZONES.flatMap(z => z.requires));
    for (const f of required) expect(REQ_PIECES[f], `no pieces for requirement ${f}`).toBeTruthy();
    for (const f of Object.keys(REQ_PIECES)) expect(required.has(f), `${f} is no gate's requirement`).toBe(true);
    expect(GATES.map(g => g.key)).toEqual(POP_ZONES.filter(z => z.requires.length).map(z => z.key));
  });

  it('names only keys the server tables know', () => {
    const pending = new Map(PENDING_MEMORIES.map(m => [m.key, m]));
    const known = new Set([...POPFLAGS_KEYS, ...Object.keys(POP_FLAGS), ...pending.keys()]);
    for (const p of ALL_PIECES) {
      for (const k of p.proof) expect(known.has(k), `${p.key}: proof ${k}`).toBe(true);
      for (const k of p.kills ?? []) expect(POP_FLAGS[k]?.kind, `${p.key}: kill ${k}`).toBe('kill');
      if (p.pending) {
        const m = pending.get(p.pending);
        expect(m, `${p.key}: pending ${p.pending}`).toBeTruthy();
        // the Seer's memory unlocks exactly the stage this piece is proven by
        expect(p.proof, `${p.key}: ${p.pending} gives ${m.gives}`).toContain(m.gives);
      }
      if (p.kind === 'handin') expect(p.to, `${p.key} is a hand-in with nobody to hand it to`).toBeTruthy();
      expect(p.needs.length, p.key).toBeGreaterThan(0);
    }
  });

  it('covers the planes the guild lead named: Sol Ro, Fire, the other elementals, Time', () => {
    for (const z of ['solro', 'fire', 'earth', 'air', 'water', 'time', 'torment']) {
      expect(gatePieces(POP_ZONE_BY_KEY[z]).length, z).toBeGreaterThan(0);
    }
    expect(gatePieces(sol).map(p => p.label)).toEqual([
      "Saryrn's half", "Marr's half", 'Maelin joins the halves', "Vallon's notes", "Tallon's notes", 'Maelin reads the notes',
    ]);
    expect(gatePieces(POP_ZONE_BY_KEY.air)).toEqual(gatePieces(POP_ZONE_BY_KEY.water));
  });

  it('marks what rests on an unverified catalog flag, rather than passing it off', () => {
    expect(PIECE.hoh_t1.verified).toBe(false);
    expect(PIECE.e_arbitor.verified).toBe(false);
    expect(PIECE.c_saryrn.verified).toBe(true);
  });

  it('opening a requirement flag it holds completes every piece of it (a later stage carries the earlier ones)', () => {
    for (const f of ['trial_justice', 'carprin_cycle', 'hedge_event', 'askr_quest', 'hoh_trials', 'cipher_1', 'zeks_6',
      'fuirstel_5', 'thelin_4', 'zebuxoruk_2', 'time_1']) {
      const held = heldFor({ flags: [f] });
      for (const p of REQ_PIECES[f]) expect(pieceStatus(p, held, true).state, `${f}: ${p.key}`).toBe('done');
    }
    // Fire's own kill flag is not its hand-in; the stage is. Holding the stage opens all four pieces.
    const held = heldFor({ flags: ['pofire_2'] });
    for (const p of REQ_PIECES.solro_dead) expect(pieceStatus(p, held, true).state, p.key).toBe('done');
  });
});

describe('a kill is not the hail after it', () => {
  it('does not carry a kill flag across to the step after the kill', () => {
    const held = stagesHeld(['saryrn_dead', 'marr_dead', 'vallon_dead', 'rallos_dead', 'solro_dead']);
    for (const k of ['saryrn_1', 'mmarr_1', 'zeks_3', 'zeks_7', 'pofire_2']) expect(held.has(k), k).toBe(false);
  });

  it('still carries a stage forward to the kill it proves, and a later value back to the earlier ones', () => {
    const held = stagesHeld(['cipher_1']);
    for (const k of ['saryrn_1', 'mmarr_1', 'saryrn_dead', 'marr_dead']) expect(held.has(k), k).toBe(true);
    const z = stagesHeld(['zeks_6']);
    for (const k of ['zeks_3', 'zeks_4', 'vallon_dead', 'tallon_dead', 'cipher_1']) expect(z.has(k), k).toBe(true);
  });

  it('shows a kill on record with no hail as not recorded, even after a full read', () => {
    const st = pieceStatus(PIECE.c_saryrn, heldFor({ flags: ['saryrn_dead'] }), true);
    expect(st.state).toBe('unknown');
    expect(st.killOnly).toBe(true);
  });

  it('a Seer-held memory is pending: not done, not missing', () => {
    const held = heldFor({ flags: ['cl_saryrn', 'saryrn_dead'] });
    expect(pieceStatus(PIECE.c_saryrn, held, true).state).toBe('pending');
    expect(pieceStatus(PIECE.c_saryrn, held, false).state).toBe('pending');
    // ...and it is done the moment the Seer has unlocked it
    expect(pieceStatus(PIECE.c_saryrn, heldFor({ flags: ['cl_saryrn', 'saryrn_1'] }), true).state).toBe('done');
  });

  it('a kill-only gate (the pipe by Grummus) is satisfied by the kill, or by the Seer holding it', () => {
    expect(pieceStatus(PIECE.grummus_kill, heldFor({ flags: ['cl_grummus'] }), true).state).toBe('done');
    expect(pieceStatus(PIECE.grummus_kill, heldFor({ flags: ['grummus_dead'] }), false).state).toBe('done');
  });
});

describe('missing vs not recorded', () => {
  it('is missing after a full read and not recorded without one', () => {
    const flags = ['saryrn_1'];
    expect(states({ flags, fullRead: true }).c_marr).toBe('missing');
    expect(states({ flags, fullRead: false }).c_marr).toBe('unknown');
    expect(states({ flags, fullRead: false }).c_saryrn).toBe('done');
  });

  it('counts the wings it has of the five', () => {
    const rep = gateReport(POP_ZONE_BY_KEY.fire, { flags: ['sol_room_1', 'sol_room_2'], fullRead: true });
    const wings = rep.pieces.find(p => p.key === 's_wings');
    expect(wings.state).toBe('missing');
    expect(wings.detail).toBe('2 of 5');
    const all = gateReport(POP_ZONE_BY_KEY.fire, { flags: ['solro_minis'], fullRead: true });
    expect(all.pieces.find(p => p.key === 's_wings').state).toBe('done');
  });
});

describe('/who: standing in a plane proves the gates to it', () => {
  it('Tower of Solusek Ro proves the cipher, the Zek reading and everything under them', () => {
    const s = states({ flags: [], seen: ['solro'], fullRead: false });
    for (const p of gatePieces(sol)) expect(s[p.key], p.key).toBe('done');
    const t = states({ flags: [], seen: ['solro'] }, POP_ZONE_BY_KEY.torment);
    for (const p of gatePieces(POP_ZONE_BY_KEY.torment)) expect(t[p.key], p.key).toBe('done');
  });

  it('Doomfire proves the whole Sol Ro run, the five wings and Solusek Ro', () => {
    const s = states({ flags: [], seen: ['fire'] }, POP_ZONE_BY_KEY.fire);
    for (const p of gatePieces(POP_ZONE_BY_KEY.fire)) expect(s[p.key], p.key).toBe('done');
  });

  it('a plane that needs less proves less', () => {
    const s = states({ flags: [], seen: ['storms'] });
    for (const k of ['c_saryrn', 'c_marr', 'z_vallon']) expect(s[k], k).toBe('unknown');
  });
});

describe('the verdict', () => {
  const sit = (flags, fullRead = true) => gateReport(sol, { flags, fullRead }).verdict;

  it('says only Maelin is left when the halves and notes are all in', () => {
    expect(sit(['saryrn_1', 'mmarr_1', 'zeks_3', 'zeks_4'])).toEqual({ tone: 'handins', text: 'Yes, only Maelin left' });
  });

  it('adds the Seer when a half is held back', () => {
    expect(sit(['saryrn_1', 'cl_mmarr', 'zeks_3', 'zeks_4'])).toEqual({ tone: 'handins', text: 'Yes, only the Seer and Maelin left' });
  });

  it('says what kill is owed, then what follows', () => {
    expect(sit(['saryrn_1', 'zeks_3', 'zeks_4'])).toEqual({ tone: 'blocked', text: 'No, needs a Marr kill, then Maelin' });
    expect(sit(['saryrn_1', 'cl_vallon', 'zeks_4']).text).toBe('No, needs a Marr kill, then the Seer and Maelin');
  });

  it('lists several owed kills', () => {
    expect(sit([]).text).toBe("No, needs a Saryrn kill, a Marr kill, a Vallon kill and a Tallon kill, then Maelin");
  });

  it('is done when nothing is left', () => {
    expect(sit(['cipher_1', 'zeks_6'])).toEqual({ tone: 'done', text: 'Nothing left here' });
  });

  it('does not guess when nothing is recorded', () => {
    expect(sit([], false).tone).toBe('unsure');
    expect(sit([], false).text).toMatch(/Nothing recorded yet/);
  });

  it('names what is not recorded when the rest is fine', () => {
    expect(sit(['saryrn_1', 'mmarr_1', 'zeks_3'], false)).toEqual({
      tone: 'unsure', text: 'Not sure: Maelin joins the halves, Tallon\'s notes and Maelin reads the notes are not recorded',
    });
  });

  it('counts a hand-in once however many pieces are Maelin\'s', () => {
    const v = verdictFor([
      { state: 'missing', kind: 'handin', to: 'Maelin', label: 'a', needs: 'a' },
      { state: 'missing', kind: 'handin', to: 'Maelin', label: 'b', needs: 'b' },
    ]);
    expect(v.text).toBe('Yes, only Maelin left');
  });
});

describe('the sidebar card', () => {
  const blocked = (flags) => [{ line: 'solro', label: 'Sol Ro to Fire', blockedOn: flags.map(flag => ({ flag, label: flag })) }];

  it('opens a blocked gate into every piece, in order, with the gate named', () => {
    const [e] = gateCardEntries(blocked(['cipher_1', 'zeks_6']), { flags: ['saryrn_1', 'cl_mmarr', 'zeks_3'], fullRead: true });
    expect(e.gate).toBe('Tower of Solusek Ro');
    expect(e.pieces.map(p => [p.label, p.state])).toEqual([
      ["Saryrn's half", 'done'], ["Marr's half", 'pending'], ['Maelin joins the halves', 'missing'],
      ["Vallon's notes", 'done'], ["Tallon's notes", 'missing'], ['Maelin reads the notes', 'missing'],
    ]);
    expect(e.verdict.text).toBe("No, needs a Tallon kill, then the Seer and Maelin");
  });

  it('shows a kill flag as the notes it hands out, each piece once', () => {
    expect(piecesForBlocker('agnarr_dead').map(p => p.key)).toEqual(['p_karana']);
    const [e] = gateCardEntries(blocked(['cipher_1', 'saryrn_dead']), { flags: [], fullRead: false });
    expect(e.pieces.filter(p => p.key === 'c_saryrn')).toHaveLength(1);
  });

  it('falls back to one row for a flag it has no pieces for, rather than drawing nothing', () => {
    const [e] = gateCardEntries(blocked(['unmapped']), { flags: [], fullRead: true });
    expect(e.pieces).toHaveLength(1);
    expect(e.pieces[0].state).toBe('missing');
  });

  it('reads its blockers from the real next-steps engine', () => {
    const lines = charNextSteps({ manual: [], auto: {}, flags: ['saryrn_1', 'zeks_3', 'zeks_4', 'grummus_dead'] });
    const card = nextCard(lines);
    const entries = gateCardEntries(card.blocked, { flags: ['saryrn_1', 'zeks_3', 'zeks_4'], fullRead: true });
    expect(entries.length).toBe(card.blocked.length);
    for (const e of entries) expect(e.pieces.length, e.line).toBeGreaterThan(0);
  });
});

describe('the switches', () => {
  it('gateMode answers only the two new values, so the layouts keep ?v=b and ?v=c', () => {
    expect(gateMode('gate-a')).toBe('a');
    expect(gateMode('gate-b')).toBe('b');
    for (const v of [undefined, 'a', 'b', 'c', ['gate-a'], '', 'gate-c']) expect(gateMode(v)).toBe(null);
  });

  it('gateKeyOr takes a gate with a requirement and falls back to the default', () => {
    expect(gateKeyOr('fire')).toBe('fire');
    expect(gateKeyOr('justice')).toBe(DEFAULT_GATE);   // no requirement: nothing to take apart
    expect(gateKeyOr('nonsense')).toBe(DEFAULT_GATE);
    expect(gateKeyOr(undefined)).toBe(DEFAULT_GATE);
    expect(gateKeyOr(['fire'])).toBe(DEFAULT_GATE);
  });
});

describe('the page', () => {
  const page = stripJs(read('web/app/pop/guide/page.tsx'));

  it('builds the gate panel only behind ?v=gate-a / ?v=gate-b, above the checklist, in the default layout', () => {
    expect(page).toMatch(/const gm = gateMode\(v\)/);
    expect(page).toMatch(/const gates = gm \? await gatePanel\(/);
    expect(page).toMatch(/const gateChars = gm \? /);
    // drawn once, in the default branch (after the ?v=b/c branch has returned), before the checklist
    const defaultBranch = page.split('const names = mine.map')[1];
    expect(defaultBranch.indexOf('{gates}')).toBeGreaterThan(-1);
    expect(defaultBranch.indexOf('{gates}')).toBeLessThan(defaultBranch.indexOf('<GuideChecklist'));
    expect(page.match(/\{gates\}/g)).toHaveLength(1);
  });

  it('reads the family through the same set of characters the page already lists', () => {
    expect(page).toMatch(/loadRoute\(mine\)/);
    expect(stripJs(read('web/app/pop/guide/gatePanel.tsx'))).toMatch(/chars\.map\(ch =>/);
  });

  it('keeps the card\'s one-line list when no gate data is passed', () => {
    const nextUp = stripJs(read('web/app/pop/guide/NextUp.tsx'));
    expect(nextUp).toMatch(/Waiting on something else · \{card\.blocked\.length\}/);
    expect(nextUp).toMatch(/gates\?: Record<string, GateCardEntry\[\]>/);
  });

  it('keeps the family table inside its own scrolling box', () => {
    const table = stripJs(read('web/app/pop/guide/GateTable.tsx'));
    expect(table).toMatch(/overflow-x-auto/);
    expect(table).toMatch(/What&apos;s left/);
  });
});

// Picked 2026-11-02: the family table is the default; a character's name opens their own piece-by-piece list.
describe('the family table is the default and names drill down', () => {
  const fs2 = require('node:fs'), p2 = require('node:path');
  const page = fs2.readFileSync(p2.join(__dirname, '..', 'web/app/pop/guide/page.tsx'), 'utf8');
  const table = fs2.readFileSync(p2.join(__dirname, '..', 'web/app/pop/guide/GateTable.tsx'), 'utf8');
  const panel = fs2.readFileSync(p2.join(__dirname, '..', 'web/app/pop/guide/gatePanel.tsx'), 'utf8');
  it('opens on the family table when no ?v= or ?nx= is asked for', () => {
    expect(page).toMatch(/const gm = gateMode\(v\) \?\? \(!v && !nx \? 'b' : null\);/);
  });
  it('a name links to that character in ?v=gate-a', () => {
    expect(table).toMatch(/<a href=\{charHref\(r\.name\)\}/);
    expect(panel).toMatch(/charHref=\{name => href\('gate-a', name\)\}/);
  });
});
