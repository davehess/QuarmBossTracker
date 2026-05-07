// commands/livekill.js — Record a live server boss kill (exact timer, no variance).
// Posts a kill card to LIVE_CHANNEL_ID. Persists in state.json.

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordLiveKill, getAllLiveKills, setLiveKillMessageId } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('livekill')
    .setDescription('Record a live server boss kill and start its respawn timer. (Pack Member+)')
    .addStringOption(opt =>
      opt.setName('boss').setDescription('Boss name').setRequired(true).setAutocomplete(true)
    )
    .addBooleanOption(opt =>
      opt.setName('timer_unknown')
        .setDescription('Timer unknown — mark as killed but check manually for respawn')
        .setRequired(false)
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

    const bossId       = interaction.options.getString('boss');
    const timerUnknown = interaction.options.getBoolean('timer_unknown') ?? false;
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    if (!boss)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Boss not found.' });

    const existing = getAllLiveKills()[bossId];
    if (existing && (existing.timerUnknown || existing.nextSpawn > Date.now())) {
      const status = existing.timerUnknown
        ? 'timer unknown — check manually'
        : `spawns ${discordRelativeTime(existing.nextSpawn)}`;
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${existing.name}** is already recorded — ${status}.`,
      });
    }

    recordLiveKill(bossId, boss.name, boss.timerHours, interaction.user.id, timerUnknown);
    const entry = getAllLiveKills()[bossId];

    let embed, replyText;
    if (timerUnknown) {
      embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle(`❓ Live Kill — ${boss.name} (Timer Unknown)`)
        .addFields(
          { name: 'Zone',      value: boss.zone,                   inline: true },
          { name: 'Killed by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Timer',     value: 'Unknown',                   inline: true },
          { name: 'Status',    value: 'Respawn time unknown. Check manually and click below when the mob is available.', inline: false },
        )
        .setTimestamp();
      replyText = `✅ Live kill recorded for **${boss.name}** (timer unknown).`;
    } else {
      embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`☠️ Live Kill — ${boss.name}`)
        .addFields(
          { name: 'Zone',       value: boss.zone,                   inline: true },
          { name: 'Killed by',  value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Timer',      value: `${boss.timerHours}h`,        inline: true },
          { name: 'Next Spawn', value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`, inline: false },
        )
        .setTimestamp();
      replyText = `✅ Live kill recorded for **${boss.name}** — spawns ${discordRelativeTime(entry.nextSpawn)}.`;
    }

    const channelId = process.env.LIVE_CHANNEL_ID;
    if (channelId) {
      try {
        const ch      = await interaction.client.channels.fetch(channelId);
        const payload = { embeds: [embed] };
        if (timerUnknown) {
          payload.components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`mark_avail:live:${bossId}`)
              .setLabel('✅ Mob is Available')
              .setStyle(ButtonStyle.Success)
          )];
        }
        const msg = await ch.send(payload);
        setLiveKillMessageId(bossId, msg.id);
      } catch (err) { console.warn('[livekill]', err?.message); }
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: replyText });
  },
};
