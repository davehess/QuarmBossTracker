// test/ui-backups-owner-only.test.js — UI backups and staged UI edits are served to their owner only.
//
// A UI backup holds a character's whole set of files. The list, download, staged-edit and edit-result routes
// now check that the character belongs to the caller (their household's Discord ids, the same walk /me
// uses) instead of trusting the character name alone (2026-10-11).
//
// Run: npx vitest run test/ui-backups-owner-only.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const helper = sliceBlock(src, 'const _householdCache = new Map();', '\n  return ids;\n}');

function load(stub) {
  const prelude = `const require = () => (${stub});\n`;
  return evalBlock(prelude + helper, ['_householdDiscordIds']);
}

describe('_householdDiscordIds', () => {
  it('a merged account and its household root count as one person', async () => {
    const { _householdDiscordIds } = load(`{ select: async (table, q) => q.startsWith('discord_id=eq.')
      ? [{ discord_id: 'A', merged_into_discord_id: 'R' }]
      : [{ discord_id: 'R' }, { discord_id: 'A' }, { discord_id: 'B' }] }`);
    expect([...await _householdDiscordIds('A')].sort()).toEqual(['A', 'B', 'R']);
  });

  it('an unmerged member is just themselves', async () => {
    const { _householdDiscordIds } = load(`{ select: async (table, q) => q.startsWith('discord_id=eq.')
      ? [{ discord_id: 'C', merged_into_discord_id: null }] : [{ discord_id: 'C' }] }`);
    expect([...await _householdDiscordIds('C')]).toEqual(['C']);
  });

  it('a failed read narrows to the caller alone, never widens', async () => {
    const { _householdDiscordIds } = load(`{ select: async () => { throw new Error('down'); } }`);
    expect([...await _householdDiscordIds('D')]).toEqual(['D']);
    expect((await _householdDiscordIds('')).size).toBe(0);
  });
});

describe('the routes check the owner', () => {
  const list = stripJs(sliceBlock(src, 'async function _handleAgentUiLayoutList(req, res) {', '\nasync function _handleAgentUiLayoutDownload'));
  const download = stripJs(sliceBlock(src, 'async function _handleAgentUiLayoutDownload(req, res, snapshotId) {', "error: 'decryption failed'"));
  const pending = stripJs(sliceBlock(src, 'async function _uiPendingEditsFor(characters, discordId) {', '\n}'));
  const result = stripJs(sliceBlock(src, 'async function _handleAgentUiEditResult(req, res) {', '\n}\n'));

  it('backup list and download compare the owner with the caller', () => {
    expect(list).toMatch(/_householdDiscordIds\(identity\.discord_id\)\)\.has\(String\(ownerDiscord\)\)/);
    expect(download).toMatch(/_householdDiscordIds\(identity\.discord_id\)\)\.has\(String\(ownerDiscord\)\)/);
  });

  it('staged edits are read and settled for the owner only', () => {
    expect(pending).toMatch(/owner_discord_id=in\.\(\$\{owners\}\)/);
    expect(src).not.toMatch(/_uiPendingEditsFor\(chars\)/);
    expect(result).toMatch(/status=eq\.pending&owner_discord_id=in\.\(\$\{owners\}\)/);
  });
});
