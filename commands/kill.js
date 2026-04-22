// commands/kill.js — Record a kill and update/create the zone kill card

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { recordKill, getAllState, getZoneCard, setZoneCard, getBoardMessages } = require('../utils/state');
const { buildZoneKillCard } = require('../utils/embeds');
const { buildBoardPanels } = require('../utils/board');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kill')
    .setDescription('Record a raid boss kill and start the respawn timer')
    .addStringOption((opt) =>
      opt.setName('boss').setDescription('Boss name or nickname').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt.setName('note').setDescription('Optional note').setRequired(false)
    ),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const choices = bosses.map((b) => ({
      name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`,
      value: b.id,
      terms: [b.name.toLowerCase(), ...(b.nicknames || []).map((n) => n.toLowerCase())],
    }));
    const filtered = choices
      .filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    const bosses = getBosses();
    const bossId = interaction.options.getString('boss');
    const note   = interaction.options.getString('note');
    const boss   = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    // Record kill in state
    recordKill(bossId, boss.timerHours, interaction.user.id);

    // Gather all currently-killed bosses in the same zone (for the zone card)
    await updateZoneCard(interaction, boss, bosses, note);

    // Refresh board buttons in background
    refreshBoard(interaction.client, interaction.channelId).catch(() => {});
  },
};

/**
 * Create or edit-in-place the zone kill card for this boss's zone.
 * The card shows ALL currently killed bosses in the zone in one embed.
 */
async function updateZoneCard(interaction, triggeredBoss, bosses, note) {
  const killState   = getAllState();
  const now         = Date.now();
  const zoneBosses  = bosses.filter((b) => b.zone === triggeredBoss.zone);

  const killedInZone = zoneBosses
    .filter((b) => killState[b.id] && killState[b.id].nextSpawn > now)
    .map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));

  const embed = buildZoneKillCard(triggeredBoss.zone, killedInZone);
  if (note) embed.addFields({ name: 'Note', value: note, inline: false });

  const existing = getZoneCard(triggeredBoss.zone);

  if (existing) {
    // Try to edit the existing zone card
    try {
      const msg = await interaction.channel.messages.fetch(existing.messageId);
      await msg.edit({ embeds: [embed] });
      // Acknowledge kill silently (no new message spam)
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `✅ **${triggeredBoss.name}** kill recorded — zone card updated.`,
      });
      return;
    } catch {
      // Message was deleted — fall through to post a new card
    }
  }

  // Post new zone card
  const { resource } = await interaction.reply({ embeds: [embed], withResponse: true });
  setZoneCard(triggeredBoss.zone, resource.message.id);
}

async function refreshBoard(discordClient, channelId) {
  const boardIds = getBoardMessages();
  if (!boardIds.length) return;
  const channel   = await discordClient.channels.fetch(channelId);
  const bosses    = getBosses();
  const killState = getAllState();
  const panels    = buildBoardPanels(bosses, killState);
  if (panels.length !== boardIds.length) return;
  for (let i = 0; i < boardIds.length; i++) {
    try {
      const msg = await channel.messages.fetch(boardIds[i].messageId);
      await msg.edit(panels[i].payload);
    } catch (_) {}
  }
}
