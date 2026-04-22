// commands/kill.js
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const bosses = require('../data/bosses.json');
const { recordKill, setKillMessageId, getBoardMessages, getAllState } = require('../utils/state');
const { buildKillEmbed } = require('../utils/embeds');
const { buildBoardPanels } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const bossChoices = bosses.map((b) => ({
  name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`,
  value: b.id,
  terms: [b.name.toLowerCase(), ...(b.nicknames || []).map((n) => n.toLowerCase())],
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kill')
    .setDescription('Record a raid boss kill and start the respawn timer')
    .addStringOption((opt) =>
      opt.setName('boss').setDescription('Boss name or nickname (e.g. "naggy", "emp", "ahr")').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt.setName('note').setDescription('Optional note').setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase().trim();
    const filtered = bossChoices
      .filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles to record kills: ${allowedRolesList()}`,
      });
    }

    const bossId = interaction.options.getString('boss');
    const note   = interaction.options.getString('note');
    const boss   = bosses.find((b) => b.id === bossId);

    if (!boss) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });
    }

    const stateEntry = recordKill(bossId, boss.timerHours, interaction.user.id, null);
    const embed      = buildKillEmbed(boss, stateEntry, interaction.user.id);
    if (note) embed.addFields({ name: 'Note', value: note, inline: false });

    const { resource } = await interaction.reply({ embeds: [embed], withResponse: true });
    setKillMessageId(bossId, resource.message.id);

    await refreshBoard(interaction.channel);
  },
};

async function refreshBoard(channel) {
  try {
    const boardMsgIds = getBoardMessages();
    if (!boardMsgIds.length) return;
    const killState = getAllState();
    const freshBosses = require('../data/bosses.json');
    const allPanels = buildBoardPanels(freshBosses, killState);
    if (allPanels.length !== boardMsgIds.length) return;
    for (let i = 0; i < boardMsgIds.length; i++) {
      const panel = allPanels[i];
      if (panel.type !== 'expansion') continue;
      try {
        const msg = await channel.messages.fetch(boardMsgIds[i].messageId);
        await msg.edit(panel.payload);
      } catch (_) {}
    }
  } catch (err) {
    console.warn('refreshBoard error:', err?.message);
  }
}
