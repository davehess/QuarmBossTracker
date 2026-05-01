// commands/pvpkill.js — Record a PVP mob kill using the boss's timerHours from bosses.json.
// Posts the kill card to PVP_KILLS_THREAD_ID for timer tracking.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordPvpKill, getAllPvpKills, setPvpKillThreadMessageId } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpkill')
    .setDescription('Record a PVP mob kill and start its respawn timer. (Officers only)')
    .addStringOption(opt =>
      opt.setName('mob').setDescription('Boss name').setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const matches = bosses
      .filter(b =>
        b.name.toLowerCase().includes(focused) ||
        (b.nicknames || []).some(n => n.toLowerCase().includes(focused))
      )
      .slice(0, 25)
      .map(b => ({ name: `${b.name} (${b.zone})`, value: b.id }));
    await interaction.respond(matches);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const bossId = interaction.options.getString('mob');
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    if (!boss)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Boss not found.' });

    const existing = getAllPvpKills()[bossId];
    if (existing && existing.nextSpawn > Date.now()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${existing.name}** is already on cooldown — spawns ${discordRelativeTime(existing.nextSpawn)}.`,
      });
    }

    const key   = recordPvpKill(boss.name, boss.timerHours, interaction.user.id, bossId);
    const entry = getAllPvpKills()[key];

    const embed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setTitle(`🗡️ PVP Kill — ${boss.name}`)
      .addFields(
        { name: 'Zone',       value: boss.zone,                                                                            inline: true },
        { name: 'Killed by',  value: `<@${interaction.user.id}>`,                                                          inline: true },
        { name: 'Timer',      value: `${boss.timerHours}h`,                                                                inline: true },
        { name: 'Next Spawn', value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`,   inline: false },
      )
      .setTimestamp();

    const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
    if (killsThreadId) {
      try {
        const thread = await interaction.client.channels.fetch(killsThreadId);
        const msg    = await thread.send({ embeds: [embed] });
        setPvpKillThreadMessageId(key, msg.id);
      } catch (err) {
        console.warn('[pvpkill] Could not post to PVP_KILLS_THREAD_ID:', err?.message);
      }
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `✅ PVP kill recorded for **${boss.name}** — spawns ${discordRelativeTime(entry.nextSpawn)}.`,
    });
  },
};
