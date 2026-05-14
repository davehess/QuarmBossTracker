// utils/audit.js — Audit trail for kill/unkill/timer commands and board buttons.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const {
  addAuditEntry, updateAuditEntryMsgId, markAuditEntryUndone, findLatestActiveAuditEntry,
} = require('./state');

function _genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function _undoRow(entryId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`audit_undo:${entryId}`)
      .setLabel('↩️ Undo')
      .setStyle(ButtonStyle.Danger)
  );
}

function _actionLabel(action) {
  const map = {
    kill:            '☠️ Kill recorded',
    unkill:          '↩️ Kill cleared',
    kill_board:      '☠️ Kill recorded (board)',
    unkill_board:    '↩️ Kill cleared (board)',
    updatetimer:     '⏱️ Timer updated',
    unkill_summary:  '📝 Kill removed from daily summary',
  };
  return map[action] || action;
}

/**
 * Post an audit entry to the audit trail thread.
 * Returns the entry id (call later with updateAuditEntryMsgId once the Discord message is posted).
 */
async function postAuditEntry(client, { action, userId, userName, bossId, bossName, prevState, newNextSpawn, msgLink }) {
  const threadId = process.env.AUDIT_TRAIL_THREAD_ID;
  if (!threadId) return null;

  const id = _genId();
  const entry = {
    id, timestamp: Date.now(), userId, userName,
    action, bossId, bossName, prevState: prevState || null,
    newNextSpawn: newNextSpawn || null, msgLink: msgLink || null,
    auditMsgId: null, undone: false,
  };
  addAuditEntry(entry);

  // Determine if this action cancels the most recent opposite action
  const oppositeAction = action.includes('unkill') ? (action === 'unkill_board' ? 'kill_board' : 'kill')
    : action.includes('kill') ? null : null;
  // More precisely: any kill cancels any recent unkill and vice versa
  const killActions   = ['kill', 'kill_board'];
  const unkillActions = ['unkill', 'unkill_board', 'unkill_summary'];
  // unkill_summary cannot be auto-undone (reversing a message edit requires the original text)
  const noUndo = action === 'unkill_summary';

  try {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread) return id;

    const ts       = `<t:${Math.floor(Date.now() / 1000)}:F>`;
    const linkText = msgLink ? ` · [Jump to message](<${msgLink}>)` : '';
    const content  = `${_actionLabel(action)} — **${bossName}** by <@${userId}>${linkText}\n${ts}`;

    const msg = await thread.send({ content, components: noUndo ? [] : [_undoRow(id)] });
    updateAuditEntryMsgId(id, msg.id);

    // Remove undo from the most recent opposing action for this boss
    const opposites = killActions.includes(action) ? unkillActions : unkillActions.includes(action) ? killActions : [];
    for (const opp of opposites) {
      const prev = findLatestActiveAuditEntry(bossId, opp);
      if (prev?.auditMsgId) {
        try {
          const prevMsg = await thread.messages.fetch(prev.auditMsgId);
          await prevMsg.edit({ components: [] });
        } catch {}
        markAuditEntryUndone(prev.id);
      }
    }
  } catch (err) {
    console.warn('[audit] postAuditEntry error:', err?.message);
  }

  return id;
}

/**
 * Remove the undo button from an audit message (called after undo completes).
 */
async function removeUndoButton(client, auditMsgId) {
  const threadId = process.env.AUDIT_TRAIL_THREAD_ID;
  if (!threadId || !auditMsgId) return;
  try {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread) return;
    const msg = await thread.messages.fetch(auditMsgId);
    await msg.edit({ components: [] });
  } catch (err) {
    console.warn('[audit] removeUndoButton error:', err?.message);
  }
}

module.exports = { postAuditEntry, removeUndoButton };
