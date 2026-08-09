// Board kill buttons must ASK before they record.
//
// Why (Hitya 2026-08-09): a phone left within reach of the dog recorded a
// "Thall Va Xakra (North)" kill via the board button. The audit trail proved it
// was a real Discord click — the agent relay never writes audit rows — so the
// only fix is a confirmation step. /announce messages already had one; the
// board buttons recorded on the first tap.
//
// A stray tap is expensive out of proportion to the tap: it starts a respawn
// timer that the spawn alerts, the 24h board and the daily summary all read
// from, and only an officer Undo unpicks it.
//
// These assertions are SOURCE-level on purpose. handleBoardButton needs a live
// discord.js interaction to run, but the properties that matter are structural:
//   1. the board handler must not record — no recordKill/postAuditEntry in it;
//   2. both confirm prefixes must route to the recording handler;
//   3. the audit trail must still say which surface the click came from.
//
// Run: npx vitest run test/kill-button-confirm.test.js

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROOT, sliceBlock } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const boardFn = sliceBlock(src, 'async function handleBoardButton(interaction) {', '\n}');

describe('handleBoardButton — asks, never records', () => {
  it('does not record a kill itself', () => {
    // The whole point: recording moved to the confirm handler.
    expect(boardFn).not.toMatch(/recordKill/);
    expect(boardFn).not.toMatch(/clearKill/);
    expect(boardFn).not.toMatch(/postAuditEntry/);
  });

  it('always returns a confirmation prompt', () => {
    expect(boardFn).toMatch(/Record a kill for/);
    expect(boardFn).toMatch(/cancel_kill_confirm/);
    // No branch may skip the prompt — the old code only confirmed for announce
    // messages, and that `if (isAnnounceMsg) {` gate is what let board taps
    // through. isAnnounceMsg may still be READ (it picks the confirm id), but
    // it must never gate the prompt.
    expect(boardFn).not.toMatch(/if\s*\(\s*isAnnounceMsg\s*\)/);
  });

  it('routes board clicks and announce clicks to different confirm ids', () => {
    expect(boardFn).toMatch(/confirm_kill_board/);
    expect(boardFn).toMatch(/confirm_kill_announce/);
  });
});

describe('confirm routing + audit provenance', () => {
  it('both confirm prefixes reach the recording handler', () => {
    const router = sliceBlock(src, "if (interaction.customId.startsWith('confirm_kill_announce:')", ';');
    expect(router).toMatch(/confirm_kill_board:/);
    expect(router).toMatch(/handleConfirmKillAnnounce/);
  });

  it('the recording handler labels the audit row by origin', () => {
    const confirmFn = sliceBlock(src, 'async function handleConfirmKillAnnounce(interaction) {', '\n}');
    expect(confirmFn).toMatch(/fromBoard/);
    expect(confirmFn).toMatch(/board button \(confirmed\)/);
    expect(confirmFn).toMatch(/announce confirm button/);
    // Both the kill and the unkill branch must stamp the resolved source, so an
    // audit row can never claim the wrong surface.
    const stamped = confirmFn.match(/source: auditSource/g) || [];
    expect(stamped.length).toBe(2);
  });

  it('strips either prefix to recover the boss id', () => {
    const strip = (id) => id.replace(/^confirm_kill_(announce|board):/, '');
    expect(strip('confirm_kill_board:thall_va_xakra_north')).toBe('thall_va_xakra_north');
    expect(strip('confirm_kill_announce:lord_nagafen')).toBe('lord_nagafen');
  });
});
