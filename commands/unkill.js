// commands/unkill.js

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { clearKill, getBossState, getAllState, getZoneCard, setZoneCard, clearZoneCard, getBoardMessages } = require('../utils/state');
const { buildZoneKillCard } = require('../utils/embeds');
const { buildBoardPanels } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unkill')
    .setDescription('Clear a boss kill record (undo a /kill)')
    .addStringOption((opt) =>
      opt.setName('boss').setDescription('Which boss kill to clear?').setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = bosses.map((b) => ({ name: `${b.name} (${b.zone})`, value: b.id }));
    await interaction.respond(choices.filter((c) => c.name.toLowerCase().includes(focused)).slice(0, 25));
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    const bosses = getBosses();
    const bossId = interaction.options.getString('boss');
    const boss   = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    const existing = getBossState(bossId);
    if (!existing) return interaction.reply({ flags: MessageFlags.Ephemeral, content: `⬜ **${boss.name}** has no recorded kill.` });

    clearKill(bossId);

    // Update or remove the zone card
    const now        = Date.now();
    const killState  = getAllState();
    const zoneBosses = bosses.filter((b) => b.zone === boss.zone);
    const stillKilled = zoneBosses.filter((b) => killState[b.id] && killState[b.id].nextSpawn > now);

    const zoneCard = getZoneCard(boss.zone);

    if (zoneCard) {
      if (stillKilled.length > 0) {
        // Still other kills in this zone — update the card
        try {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));
          const embed = buildZoneKillCard(boss.zone, killedInZone);
          const msg = await interaction.channel.messages.fetch(zoneCard.messageId);
          await msg.edit({ embeds: [embed] });
        } catch (_) {}
      } else {
        // No more kills in zone — delete the card
        try {
          const msg = await interaction.channel.messages.fetch(zoneCard.messageId);
          await msg.delete();
        } catch (_) {}
        clearZoneCard(boss.zone);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x888888)
      .setTitle('🗑️ Kill record cleared')
      .setDescription(`**${boss.name}** (${boss.zone})\nCleared by <@${interaction.user.id}>`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Refresh board
    try {
      const boardIds = getBoardMessages();
      if (!boardIds.length) return;
      const channel   = await interaction.client.channels.fetch(process.env.TIMER_CHANNEL_ID);
      const panels    = buildBoardPanels(bosses, getAllState());
      if (panels.length !== boardIds.length) return;
      for (let i = 0; i < boardIds.length; i++) {
        try {
          const msg = await channel.messages.fetch(boardIds[i].messageId);
          await msg.edit(panels[i].payload);
        } catch (_) {}
      }
    } catch (err) {
      console.warn('refreshBoard error in unkill:', err?.message);
    }
  },
};
