// test/tells-scripted-npc.test.js — NPC lines that only look like tells (the guild lead, 2026-09-28:
// "this is an NPC message, not a tell"). Grand Librarian Maelin's quest script prints
// "Maelin tells you, '...'" itself, which lands in the log exactly like a /tell and was DM'd. The
// bot drops an incoming tell whose sender AND text are a line some quest script prints as a tell;
// a real player who shares the NPC's name still gets through. Runs the bot's real code on a fake
// Supabase.
//
// Run: npx vitest run test/tells-scripted-npc.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const bot = readSource(BOT_INDEX);

// Script bodies shaped like the mirror's (Lua; Perl uses the same string).
const MAELIN = `function event_say(e)
  if e.message:findi("hail") then
    e.other:Message(0, "Maelin tells you, 'Welcome to Myrist!  This is truly something for me to be proud of.'");
  elseif e.message:findi("lore") then
    e.other:Message(0, "Maelin tells you, 'Name, " .. e.other:GetName() .. "?'");
  end
end`;

function load(rowsOrError) {
  const calls = [];
  const fakeSupabase = {
    select: async (table, q) => {
      calls.push([table, q]);
      if (rowsOrError instanceof Error) throw rowsOrError;
      return rowsOrError;
    },
  };
  const block = sliceBlock(bot, 'const _scriptedTellKey = ', '\n  return _scriptedTellCache.loading;\n}\n');
  // eslint-disable-next-line no-new-func
  const fns = new Function('require', block + '\nreturn { _scriptedTellKey, _scriptedNpcTells };')(() => fakeSupabase);
  return { ...fns, calls };
}

describe('scripted NPC tell lines', () => {
  it('knows the exact line a script prints, whatever the spacing', async () => {
    const { _scriptedNpcTells, _scriptedTellKey } = load([{ body: MAELIN }]);
    const set = await _scriptedNpcTells();
    expect(set.has(_scriptedTellKey('Maelin', 'Welcome to Myrist!  This is truly something for me to be proud of.'))).toBe(true);
    expect(set.has(_scriptedTellKey('maelin', 'Welcome to Myrist! This is truly something for me to be proud of.'))).toBe(true);
  });

  it('a player who shares the NPC\'s name, saying anything else, still gets through', async () => {
    const { _scriptedNpcTells, _scriptedTellKey } = load([{ body: MAELIN }]);
    const set = await _scriptedNpcTells();
    expect(set.has(_scriptedTellKey('Maelin', 'want to group for Grummus?'))).toBe(false);
    // A line built from pieces (the player's name spliced in) never matches anything real.
    expect([...set].some(k => k.includes('GetName'))).toBe(false);
  });

  it('reads the mirror once and caches it', async () => {
    const { _scriptedNpcTells, calls } = load([{ body: MAELIN }]);
    await _scriptedNpcTells();
    await _scriptedNpcTells();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('eqemu_quest_scripts');
    expect(calls[0][1]).toMatch(/body=like\.\*tells%20you%2C\*/);
  });

  it('fails open: a failed read drops nothing', async () => {
    const { _scriptedNpcTells } = load(new Error('timeout'));
    expect((await _scriptedNpcTells()).size).toBe(0);
  });
});

describe('the tells handler', () => {
  const code = stripJs(sliceBlock(bot, 'async function _handleAgentTells(req, res) {', '\n}\n'));
  it('drops scripted NPC lines before anything is stored or DM\'d', () => {
    expect(code).toMatch(/scriptedNpc\.has\(_scriptedTellKey\(t\.other, t\.text\)\)/);
    expect(code.indexOf('await _scriptedNpcTells()')).toBeLessThan(code.indexOf("supabase.upsert('tells'"));
  });
});
