// commands/parsereset.js — Wipe stale auto-parse state (officers only).
//
// Clears three things in one shot:
//   1. raidSession.sessionDamage — the running all-night per-player totals
//   2. agentTestCards            — the 10-min mob dedup windows in AUTOPARSE_TEST_THREAD_ID
//   3. agentSessionCardId        — the all-night leaderboard card pointer
//
// Also deletes the existing Discord cards from the test thread so a fresh card
// gets posted on the next agent upload. Use this to wipe stale player names that
// accumulated during testing or from a previous unended session.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const {
  getAllAgentTestCards, clearAgentTestCards,
  getAgentSessionCardId, clearAgentSessionCardId,
  getRaidSession, clearSessionDamage,
  getAgentActivity, clearAgentActivity,
  getPetOwners, clearPetOwners,
} = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsereset')
    .setDescription('Wipe stale auto-parse session damage and test thread cards (officers only)'),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can reset parse state. Required roles: ${officerRolesList()}`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Snapshot what we're about to clear so we can summarize it
    const session     = getRaidSession();
    const playerCount = Object.keys(session?.sessionDamage || {}).length;
    const agentCount  = Object.keys(getAgentActivity()).length;
    const petCount    = Object.keys(getPetOwners()).length;

    // Collect message IDs to delete from the test thread (best-effort)
    const testThreadId = process.env.AUTOPARSE_TEST_THREAD_ID;
    const messageIds   = [];
    const sessionCardId = getAgentSessionCardId();
    if (sessionCardId) messageIds.push(sessionCardId);
    const allCards = getAllAgentTestCards();
    for (const k of Object.keys(allCards)) {
      if (allCards[k]?.messageId) messageIds.push(allCards[k].messageId);
    }

    // Delete old Discord cards from the test thread
    let deleted = 0;
    if (testThreadId && messageIds.length) {
      try {
        const thread = await interaction.client.channels.fetch(testThreadId).catch(() => null);
        if (thread) {
          for (const id of messageIds) {
            try { const m = await thread.messages.fetch(id); await m.delete(); deleted++; }
            catch { /* already gone */ }
          }
        }
      } catch { /* non-fatal */ }
    }

    // Now wipe the state
    clearSessionDamage();
    clearAgentTestCards();
    clearAgentSessionCardId();
    clearAgentActivity();
    clearPetOwners();

    const lines = [
      '✅ Auto-parse state reset.',
      `• Session damage cleared (${playerCount} player${playerCount === 1 ? '' : 's'} removed).`,
      `• Agent test thread cards cleared (${messageIds.length} tracked, ${deleted} deleted from Discord).`,
      `• Agent activity cleared (${agentCount} character${agentCount === 1 ? '' : 's'} removed from /parseagents).`,
      `• Pet→owner map cleared (${petCount} pet${petCount === 1 ? '' : 's'} forgotten).`,
      session
        ? '• Raid session is still open — new uploads will rebuild the leaderboard from zero.'
        : '• No active raid session — agent uploads will continue to populate parses.json only.',
    ];
    return interaction.editReply(lines.join('\n'));
  },
};
