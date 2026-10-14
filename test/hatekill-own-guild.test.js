// test/hatekill-own-guild.test.js — a Plane of Hate kill by our own guild is not a "Foreign kill".
//
// The agent only learns its own guild after seeing a Druzzil broadcast that session, so it sent
// isOwnGuild:false for members' kills and the bot posted them as "🩸 Foreign kill" (the guild lead,
// 2026-10-10: "these are not foreign kills"). The bot now also checks the killer's guild itself, and an
// own-guild instance kill is recorded and posted as ours instead of being dropped.
//
// Run: npx vitest run test/hatekill-own-guild.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const helper = sliceBlock(src, 'function _hateKillIsOwnGuild(k) {', '\n}');
const { _hateKillIsOwnGuild } = evalBlock(`const WP_GUILD_NAME = 'Wolf Pack';\n${helper}`, ['_hateKillIsOwnGuild']);

describe('_hateKillIsOwnGuild', () => {
  it('our guild in the broadcast is ours, even when the agent says it is not', () => {
    expect(_hateKillIsOwnGuild({ killerGuild: 'Wolf Pack', isOwnGuild: false })).toBe(true);
    expect(_hateKillIsOwnGuild({ killerGuild: ' wolf pack ' })).toBe(true);
  });

  it("another guild, or no guild, is foreign unless the agent says it is ours", () => {
    expect(_hateKillIsOwnGuild({ killerGuild: 'Dungeons and Dragons', isOwnGuild: false })).toBe(false);
    expect(_hateKillIsOwnGuild({ killerGuild: null })).toBe(false);
    expect(_hateKillIsOwnGuild({})).toBe(false);
    expect(_hateKillIsOwnGuild({ killerGuild: 'Mayhem', isOwnGuild: true })).toBe(true);
  });
});

describe('the hatekill handler', () => {
  const handler = stripJs(sliceBlock(src, 'async function _handleAgentHateKill(req, res) {', '\n// ── /sll lockout relay'));

  it('decides "ours" with the helper', () => {
    expect(handler).toMatch(/const isOwnGuild = _hateKillIsOwnGuild\(k\);/);
  });

  it('no longer drops our own instance kills', () => {
    expect(handler).not.toMatch(/if \(isOwnGuild && instanced\) continue;/);
  });

  it('gives an own-guild instance kill neither the spot picker nor the assign-later link', () => {
    expect(handler).toMatch(/if \(isOwnGuild && !instanced\) \{/);
    expect(handler).toMatch(/if \(!isOwnGuild\) \{/);
  });
});
