// test/tell-npc-sender.test.js — a banker's small talk must not reach a
// raider's Discord DMs.
//
// The guild lead, 2026-09-22: "Some NPCs will tell you things like this
// privately." The evidence was a DM thread reading
//   Gage → Hitya: Welcome to my bank!
//   Gage → Hitya: Come back soon!
// twice over, two minutes apart. "Gage" is a real eqemu_npc_types row, and it
// defeats BOTH existing guards: the sender is one capitalised word (so it has
// a player's name shape) and the text carries no "Master" and no coin (so the
// text heuristic passes it).
//
// ⚠ The fix deliberately does NOT string-match the greeting. Banker and
// merchant lines are server-side, not in eqemu_npc_emotes (checked), so such a
// list could only be guessed and extended forever — and "Come back soon!" is
// something a player might genuinely type. The rule in the source is that an
// NPC tell slipping through is harmless while dropping a real one is not.
//
// These RUN the shipped parseTellLine.
//
// Run: npx vitest run test/tell-npc-sender.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// Stubs for the three collaborators, so the test drives what the agent is
// looking at and what the catalog knows.
const PRELUDE = `
  let __target = null, __catalog = new Set();
  function __setTarget(t){ __target = t; }
  function __setCatalog(names){ __catalog = new Set((names||[]).map(_normMobNameAgent)); }
  function _currentTargetState(){ return __target; }
  function _normMobNameAgent(n){ return String(n||'').trim().toLowerCase().replace(/[\\s\`']+/g, '_'); }
  function _npcMobInfoFor(name){ return __catalog.has(_normMobNameAgent(name)) ? { name } : null; }
  function parseEqTimestamp(){ return new Date('2026-09-22T10:06:00Z'); }
  function transformEqItemLinks(s){ return s; }
  const crypto = { createHash: () => ({ update: () => ({ digest: () => 'f'.repeat(40) }) }) };
`;

const api = evalBlock(
  PRELUDE + sliceBlock(src, 'const TELL_INCOMING_RX =',
                            '\n// Append a parsed tell to the LOCAL ring buffer'),
  ['parseTellLine', '__setTarget', '__setCatalog'],
);
const { parseTellLine, __setTarget, __setCatalog } = api;

const TS = '[Tue Sep 22 10:06:12 2026]';
const tell = (who, text) => `${TS} ${who} tells you, '${text}'`;

beforeEach(() => { __setTarget(null); __setCatalog([]); });

describe('a targeted NPC talking at you', () => {
  it('drops the banker whose name looks exactly like a player', () => {
    __setCatalog(['Gage']);
    __setTarget({ target_name: 'Gage' });
    expect(parseTellLine(tell('Gage', 'Welcome to my bank!'), 'Aldenmar')).toBeNull();
    expect(parseTellLine(tell('Gage', 'Come back soon!'), 'Aldenmar')).toBeNull();
  });

  // The half that stops this from silencing people.
  it('KEEPS a real tell from a player who shares an NPC name, when not targeted', () => {
    __setCatalog(['Gage']);
    __setTarget({ target_name: 'a decaying skeleton' });
    const t = parseTellLine(tell('Gage', 'inv?'), 'Aldenmar');
    expect(t).not.toBeNull();
    expect(t.other).toBe('Gage');
    expect(t.text).toBe('inv?');
  });

  // The other half: being targeted is not enough — the name has to be a mob.
  it('KEEPS a tell from the player you happen to be targeting', () => {
    __setCatalog([]);                       // catalog has no such NPC
    __setTarget({ target_name: 'Brackwyn' });
    expect(parseTellLine(tell('Brackwyn', 'ready when you are'), 'Aldenmar')).not.toBeNull();
  });

  it('keeps ordinary tells with nothing targeted at all', () => {
    expect(parseTellLine(tell('Corvale', 'coming to the raid?'), 'Aldenmar')).not.toBeNull();
  });

  // Outgoing is you typing, so it can never be NPC chatter — and gating it on
  // the target would drop your own message to someone you are not looking at.
  it('never applies the rule to what YOU sent', () => {
    __setCatalog(['Gage']);
    __setTarget({ target_name: 'Gage' });
    const out = parseTellLine(`${TS} You told Gage, 'hello'`, 'Aldenmar');
    expect(out).not.toBeNull();
    expect(out.direction).toBe('outgoing');
  });

  // Fail-open: a missing or broken collaborator must never cost a real tell.
  it('keeps the tell when there is no target state to consult', () => {
    __setCatalog(['Gage']);
    __setTarget(undefined);
    expect(parseTellLine(tell('Gage', 'inv?'), 'Aldenmar')).not.toBeNull();
  });

  // The pre-existing guards still have to work.
  it('still drops pet acks and merchant coin quotes', () => {
    expect(parseTellLine(tell('Genarn', 'Attacking a bat Master.'), 'Aldenmar')).toBeNull();
    expect(parseTellLine(tell('Emilyy', "That'll be 12 platinum for the Bone Chips"), 'Aldenmar')).toBeNull();
  });

  it('still drops an incoming tell whose sender is plainly a mob', () => {
    expect(parseTellLine(tell('a kobold runner', 'hi'), 'Aldenmar')).toBeNull();
  });
});
