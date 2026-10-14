// The escort NPC list lives in two places that must stay identical: the bot's shared-trail constant
// (utils/raidTargets.js ESCORT_NPCS) and the agent's MAP_TRACKED_PATHS (packages/wolfpack-logsync/index.js). The
// same file ships on both branches. Each side is checked against the list the guild lead's research produced
// (2026-10-14); when both sides carry their constant, they are also compared with each other. A side that does not
// have its constant yet (the bot branch is cut from main, the agent branch from beta) is skipped, never passed:
// the pinned-list test for the side that does have it still runs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const EXPECTED = {
  ponightmare: ['thelin poxbourne', 'aid eino'], poinnovation: ['nitram anizok'], eastwastes: ['garadain glacierbane'],
  iceclad: ['general bragmur'], cazicthule: ['gimlik cogboggle'], steamfont: ['cargo clockwork'], tenebrous: ['johanius barleou'],
  fungusgrove: ['caller groo', 'caller murkin', 'caller torgal'], netherbian: ['lerin sardor'], eastkarana: ['teloa'],
  sharvahl: ['shainai'],
  grimling: ['scout husman', 'scout derrin', 'scout danarin', 'captain necin', 'sergeant jherum', 'veteran vadrel', 'scout gergil'],
};

// `const NAME = { ... };` → the object, from comment-stripped source. Null when the constant is absent.
function literal(src, name) {
  const clean = stripJs(src);
  const m = new RegExp('const ' + name + '\\s*=\\s*(\\{[\\s\\S]*?\\n?\\})\\s*;').exec(clean);
  if (!m) return null;
  // eslint-disable-next-line no-new-func
  return new Function('return ' + m[1].replace(/\/\/.*$/gm, ''))();
}
const botPath = path.join(ROOT, 'utils', 'raidTargets.js');
const bot = fs.existsSync(botPath) ? literal(readSource(botPath), 'ESCORT_NPCS') : null;
const agent = literal(readSource(AGENT_INDEX), 'MAP_TRACKED_PATHS');

describe('escort list', () => {
  it.skipIf(!bot)('the bot constant is the researched list', () => { expect(bot).toEqual(EXPECTED); });
  it.skipIf(!agent)('the agent constant is the researched list', () => { expect(agent).toEqual(EXPECTED); });
  it.skipIf(!bot || !agent)('the bot and the agent hold the same list', () => { expect(bot).toEqual(agent); });
  it('every name is lowercase, with no leading # and no underscore (the spelling both sides normalise to)', () => {
    for (const list of [bot, agent, EXPECTED].filter(Boolean)) {
      for (const names of Object.values(list)) for (const n of names) expect(n).toBe(n.toLowerCase().replace(/^[#!~]+/, '').replace(/_/g, ' ').trim());
    }
  });
});
