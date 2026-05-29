// commands/removetarget.js — Remove a boss from an announce event's target list.
// Includes the easter-egg chain when all real targets are removed.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const {
  getAnnounceByThreadId, updateAnnounceTargets, updateAnnounceEasterEgg, getAnnounce, saveAnnounce,
  getRaidSession, removeRaidSessionTarget,
} = require('../utils/state');
const { refreshSessionSummary } = require('./raidnight');
const {
  buildControlPanelEmbed, buildTargetButtons, buildKillRows, buildCancelRow, EASTER_EGG_CHAIN,
} = require('./announce');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

async function refreshControlPanel(thread, announceData, bosses) {
  try {
    const msgs = await thread.messages.fetch({ limit: 20 });
    const cp = msgs.find(m =>
      m.author.bot && m.components.length > 0 &&
      m.embeds[0]?.title === '\u{1F4CB} Raid Targets'
    );
    if (!cp) return;
    const cpEmbed    = buildControlPanelEmbed(announceData.targets, bosses, announceData.zone, announceData.plannedTimeStr);
    const killRows   = buildKillRows(announceData.targets, bosses);
    const targetRows = buildTargetButtons(announceData.targets, bosses);
    const cancelRow  = buildCancelRow(announceData.messageId);
    await cp.edit({ embeds: [cpEmbed], components: [...killRows.slice(0, 2), ...targetRows.slice(0, 2), cancelRow] });
  } catch (err) { console.warn('removetarget: could not refresh panel:', err?.message); }
}

async function restoreAnnounceFromThread(channel, bosses) {
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    for (const msg of msgs.values()) {
      if (!msg.author.bot || !msg.components.length) continue;
      let announceId = null;
      const targets = [];
      for (const row of msg.components) {
        for (const btn of row.components) {
          const cid = btn.customId;
          if (cid?.startsWith('cancel_event_thread:')) announceId = cid.replace('cancel_event_thread:', '');
          if (cid?.startsWith('remove_target:')) { const t = cid.replace('remove_target:', ''); if (!targets.includes(t)) targets.push(t); }
          if (cid?.startsWith('kill:') && !cid.includes('__none__')) { const t = cid.replace('kill:', ''); if (!targets.includes(t)) targets.push(t); }
        }
      }
      if (!announceId) continue;
      const embed = msg.embeds[0];
      const plannedField = embed?.fields?.find(f => f.name.includes('Planned'));
      const plannedTimeStr = plannedField?.value || 'Unknown';
      const firstBoss = targets.map(tid => bosses.find(b => b.id === tid)).find(Boolean);
      const zone = firstBoss?.zone || 'Unknown';
      saveAnnounce(announceId, {
        targets, zone, plannedTimeStr,
        threadId: channel.id,
        channelId: null, eventId: null, organizer: null,
        plannedTimeMs: Date.now(), easterEggLevel: 0,
      });
      console.log(`[announce] Restored announce ${announceId} from thread ${channel.id} (${targets.length} targets)`);
      return { messageId: announceId, targets, zone, plannedTimeStr, threadId: channel.id, easterEggLevel: 0 };
    }
  } catch (err) { console.warn('[announce] restoreAnnounceFromThread:', err?.message); }
  return null;
}

/** Check if any remaining target is a "real" boss (not an easter-egg ID) */
function hasRealTargets(targets) {
  return targets.some(t => !t.startsWith('_'));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removetarget')
    .setDescription('Remove a boss from the raid target list. Run inside the announce thread.')
    .addStringOption(opt => opt.setName('boss').setDescription('Boss to remove').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const announce = getAnnounceByThreadId(interaction.channel.id);
    if (!announce) { await interaction.respond([]); return; }

    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = (announce.targets || [])
      .map(tid => {
        const ee = EASTER_EGG_CHAIN.find(e => e.id === tid);
        if (ee) return { name: `${ee.emoji} ${ee.name}`, value: tid };
        const b  = bosses.find(b => b.id === tid);
        return b ? { name: `${b.emoji || ''} ${b.name}`, value: tid } : null;
      })
      .filter(Boolean)
      .filter(c => !focused || c.name.toLowerCase().includes(focused));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const bosses = getBosses();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const removeId  = interaction.options.getString('boss');

    // /removetarget also works inside the /raidnight thread.
    const raidSession = getRaidSession();
    if (raidSession && raidSession.threadId === interaction.channel.id) {
      const removed = removeRaidSessionTarget(removeId);
      if (!removed) return interaction.editReply('❌ That boss is not in tonight\'s target list.');
      await refreshSessionSummary(interaction.client).catch(() => {});
      const removedBoss = bosses.find(b => b.id === removeId);
      return interaction.editReply(`✅ **${removedBoss?.name || removeId}** removed from tonight's target list.`);
    }

    let announce = getAnnounceByThreadId(interaction.channel.id);
    if (!announce) {
      announce = await restoreAnnounceFromThread(interaction.channel, bosses);
      if (!announce)
        return interaction.editReply('❌ Run this inside an /announce thread or the active /raidnight thread.');
    }

    let targets     = [...(announce.targets || [])];

    if (!targets.includes(removeId))
      return interaction.editReply('❌ That boss is not in the target list.');

    targets = targets.filter(t => t !== removeId);
    updateAnnounceTargets(announce.messageId, targets);

    let replyMsg = `✅ Target removed.`;

    // ── Easter-egg chain ─────────────────────────────────────────────────────────────────────────
    if (!hasRealTargets(targets)) {
      const currentLevel = announce.easterEggLevel || 0;
      const nextEgg      = EASTER_EGG_CHAIN[currentLevel];

      if (nextEgg) {
        targets = targets.filter(t => EASTER_EGG_CHAIN.findIndex(e => e.id === t) === -1); // clear old eggs
        targets.push(nextEgg.id);
        updateAnnounceTargets(announce.messageId, targets);
        updateAnnounceEasterEgg(announce.messageId, currentLevel + 1);

        if (nextEgg.quote) {
          await interaction.channel.send({ content: `> ${nextEgg.quote}` });
        }
        replyMsg += ` Added **${nextEgg.name}** to the target list. \u{1F608}`;

        // Update Discord event name
        if (announce.eventId) {
          try {
            const event = await interaction.guild.scheduledEvents.fetch(announce.eventId);
            await event.edit({ name: `Pack Takedown: ${nextEgg.name}` });
          } catch { /* non-critical */ }
        }
      }
    }

    const freshAnnounce = { ...getAnnounce(announce.messageId), messageId: announce.messageId };
    await refreshControlPanel(interaction.channel, freshAnnounce, bosses);

    await interaction.editReply(replyMsg);
  },
};
