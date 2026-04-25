// commands/removetarget.js — Remove a boss from an announce event's target list.
// Includes the easter-egg chain when all real targets are removed.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const {
  getAnnounceByThreadId, updateAnnounceTargets, updateAnnounceEasterEgg, getAnnounce,
} = require('../utils/state');
const {
  buildControlPanelEmbed, buildTargetButtons, buildCancelRow, EASTER_EGG_CHAIN,
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
      m.embeds[0]?.title === '📋 Raid Targets'
    );
    if (!cp) return;
    const cpEmbed    = buildControlPanelEmbed(announceData.targets, bosses, announceData.zone, announceData.plannedTimeStr);
    const targetRows = buildTargetButtons(announceData.targets, bosses);
    const cancelRow  = buildCancelRow(announceData.messageId);
    await cp.edit({ embeds: [cpEmbed], components: [...targetRows, cancelRow] });
  } catch (err) { console.warn('removetarget: could not refresh panel:', err?.message); }
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

    const announce = getAnnounceByThreadId(interaction.channel.id);
    if (!announce)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This command must be used inside a raid announce thread.' });

    const bosses    = getBosses();
    const removeId  = interaction.options.getString('boss');
    let targets     = [...(announce.targets || [])];

    if (!targets.includes(removeId))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ That boss is not in the target list.' });

    targets = targets.filter(t => t !== removeId);
    updateAnnounceTargets(announce.messageId, targets);

    let replyMsg = `✅ Target removed.`;

    // ── Easter-egg chain ─────────────────────────────────────────────────────
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
        replyMsg += ` Added **${nextEgg.name}** to the target list. 😈`;

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

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: replyMsg });
  },
};
