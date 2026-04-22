// commands/unkill.js

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { clearKill, getBossState, getAllState, getZoneCard, setZoneCard, clearZoneCard } = require('../utils/state');
const { postKillUpdate } = require('../utils/killops');
const { buildZoneKillCard } = require('../utils/embeds');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { getThreadId, getBossExpansion } = require('../utils/config');

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
    await interaction.respond(
      bosses.map((b) => ({ name: `${b.name} (${b.zone})`, value: b.id }))
        .filter((c) => c.name.toLowerCase().includes(focused)).slice(0, 25)
    );
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

    // Update or remove zone card
    const now        = Date.now();
    const killState  = getAllState();
    const zoneCard   = getZoneCard(boss.zone);
    const stillKilled = bosses.filter((b) => b.zone === boss.zone && killState[b.id] && killState[b.id].nextSpawn > now);

    if (zoneCard) {
      try {
        const targetCh = await interaction.client.channels.fetch(zoneCard.threadId || interaction.channelId);
        if (stillKilled.length > 0) {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));
          const msg = await targetCh.messages.fetch(zoneCard.messageId);
          await msg.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
        } else {
          const msg = await targetCh.messages.fetch(zoneCard.messageId);
          await msg.delete();
          clearZoneCard(boss.zone);
        }
      } catch { clearZoneCard(boss.zone); }
    }

    const embed = new EmbedBuilder().setColor(0x888888)
      .setTitle('🗑️ Kill record cleared')
      .setDescription(`**${boss.name}** (${boss.zone})\nCleared by <@${interaction.user.id}>`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId);
  },
};
