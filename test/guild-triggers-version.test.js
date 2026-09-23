// The guild-triggers version is the agent's no-change gate: an agent recompiles
// its trigger set only when this string changes (packages/wolfpack-logsync
// `_applyGuildTriggersResponse`, and the #106 /poll `unchanged` reply).
//
// It used to be max(updated_at) over the ENABLED rows served. Disabling or
// deleting a trigger removes its row from that set — timestamp and all — so the
// max never moved and running agents kept firing a trigger officers had
// switched off (2026-09-23: five duplicate callouts disabled in the table went
// on firing). These tests run the real functions sliced from the bot.
//
// Run: npx vitest run test/guild-triggers-version.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _guildTriggersVersion } = evalBlock(
  sliceBlock(src, 'function _pollTuningVersion(payload) {', '\n  return h.toString(36);\n}') + '\n' +
  sliceBlock(src, 'function _guildTriggersVersion(rows) {', '\n}'),
  ['_guildTriggersVersion'],
);

// The served set is enabled rows only — exactly what _guildTriggersFor hands in.
const A = { id: 'a1', updated_at: '2026-06-09T02:09:58Z' };
const B = { id: 'b2', updated_at: '2026-08-16T10:00:00Z' };
const C = { id: 'c3', updated_at: '2026-09-23T14:41:45Z' };   // the newest row

describe('guild-triggers version moves on every change an agent must see', () => {
  it('DISABLING a trigger that is not the newest changes it (the bug)', () => {
    // B leaves the served set. Under max(updated_at) the version stayed C's.
    expect(_guildTriggersVersion([A, C])).not.toBe(_guildTriggersVersion([A, B, C]));
  });
  it('DELETING a trigger changes it', () => {
    expect(_guildTriggersVersion([B, C])).not.toBe(_guildTriggersVersion([A, B, C]));
  });
  it('ENABLING an old trigger changes it', () => {
    expect(_guildTriggersVersion([A, B, C])).not.toBe(_guildTriggersVersion([B, C]));
  });
  it('EDITING a trigger changes it', () => {
    const B2 = { ...B, updated_at: '2026-09-23T15:00:00Z' };
    expect(_guildTriggersVersion([A, B2, C])).not.toBe(_guildTriggersVersion([A, B, C]));
  });
});

describe('guild-triggers version stays put when nothing changed', () => {
  it('the same set gives the same version, whatever order the rows arrive in', () => {
    expect(_guildTriggersVersion([C, A, B])).toBe(_guildTriggersVersion([A, B, C]));
  });
  it('an empty set is "0", as before', () => {
    expect(_guildTriggersVersion([])).toBe('0');
  });
});
