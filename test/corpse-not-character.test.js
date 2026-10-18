// A dead character's Zeal name is "<Name>'s corpse<N>". It reached /me's "Characters we think are yours" card as a
// character (the guild lead, 2026-10-17), through the trigger-feedback upload's upload-stats row.
//
// The shared isCorpse runs for real (bot and web copies). The three bot choke points and the /me card are checked
// as TEXT with comments stripped (stripJs), since they live inside the monolith and a server component.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, stripJs, sliceBlock, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const { isCorpse } = nodeRequire('./utils/raidBuffs');
const ROOT = path.dirname(BOT_INDEX);

describe('isCorpse', () => {
  it.each([
    ["Melting's corpse480", true],
    ['Melting`s corpse480', true],
    ['Melting’s corpse', true],
    ["Melting's_corpse12", true],
    ['Melting', false],
    ['Mycorpseishere', false],   // a real character name that contains the word
  ])('%s → %s', (name, want) => { expect(isCorpse(name)).toBe(want); });

  it('the web copy uses the same pattern', () => {
    const web = readSource(path.join(ROOT, 'web/lib/buffs.ts'));
    const bot = readSource(path.join(ROOT, 'utils/raidBuffs.js'));
    const rx = (s) => /const CORPSE_RX = (\/.+\/i);/.exec(s)[1];
    expect(rx(web)).toBe(rx(bot));
  });
});

describe('the bot never records a corpse as a character', () => {
  const src = readSource(BOT_INDEX);
  it('upload stats drop the corpse name', () => {
    const b = stripJs(sliceBlock(src, 'function _trackUpload(', '\n}\n'));
    expect(b).toMatch(/if \(character && require\('\.\/utils\/raidBuffs'\)\.isCorpse\(character\)\) character = null;/);
  });
  it('trigger feedback stores no corpse voter', () => {
    const b = stripJs(sliceBlock(src, 'async function _handleAgentTriggerFeedback(', '\n}\n'));
    expect(b).toMatch(/voter_character: v\.voter_character && !require\('\.\/utils\/raidBuffs'\)\.isCorpse\(v\.voter_character\)/);
  });
  it('live state skips a corpse', () => {
    const b = stripJs(sliceBlock(src, 'async function _handleAgentLiveState(', '\n}\n'));
    expect(b).toMatch(/if \(require\('\.\/utils\/raidBuffs'\)\.isCorpse\(character\)\) continue;/);
  });
});

describe('/me suspects', () => {
  it('skips corpse names from upload stats', () => {
    const page = stripJs(readSource(path.join(ROOT, 'web/app/me/page.tsx')));
    expect(page).toMatch(/if \(!u\.character \|\| isCorpse\(u\.character\)\) continue;/);
  });
});
