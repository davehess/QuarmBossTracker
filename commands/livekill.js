// commands/livekill.js — Record a live server boss kill (exact timer, no variance).
// Posts a kill card to LIVE_CHANNEL_ID. Persists in state.json.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordLiveKill, getAllLiveKills, setLiveKillMessageId } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livekill')
    .setDescription('Record a live server boss kill and start its respawn timer. (Pack Member+)')
    .addStringOption(opt =>
      opt.setName('boss').setDescription('Boss name').setRequired(true).setAutocomplete(true)
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

    const bossId = interaction.options.getString('boss');
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    if (!boss)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Boss not found.' });

    const existing = getAllLiveKills()[bossId];
    if (existing && existing.nextSpawn > Date.now()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${existing.name}** is already on timer — spawns ${discordRelativeTime(existing.nextSpawn)}.`,
      });
    }

    recordLiveKill(bossId, boss.name, boss.timerHours, interaction.user.id);
    const entry = getAllLiveKills()[bossId];

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`☠️ Live Kill — ${boss.name}`)
      .addFields(
        { name: 'Zone',       value: boss.zone,                   inline: true },
        { name: 'Killed by',  value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Timer',      value: `${boss.timerHours}h`,        inline: true },
        { name: 'Next Spawn', value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`, inline: false },
      )
      .setTimestamp();

    const channelId = process.env.LIVE_CHANNEL_ID;
    if (channelId) {
      try {
        const ch  = await interaction.client.channels.fetch(channelId);
        const msg = await ch.send({ embeds: [embed] });
        setLiveKillMessageId(bossId, msg.id);
      } catch (err) { console.warn('[livekill]', err?.message); }
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `✅ Live kill recorded for **${boss.name}** — spawns ${discordRelativeTime(entry.nextSpawn)}.`,
    });
  },
};
