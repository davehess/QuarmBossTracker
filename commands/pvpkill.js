// commands/pvpkill.js — Record a PVP mob kill using the boss's timerHours from bosses.json.
// Posts the kill card to PVP_KILLS_THREAD_ID for timer tracking.

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { recordPvpKill, getAllPvpKills, setPvpKillThreadMessageId } = require('../utils/state');
const { discordAbsoluteTime, discordRelativeTime } = require('../utils/timer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpkill')
    .setDescription('Record a PVP mob kill and start its respawn timer. (Officers only)')
    .addStringOption(opt =>
      opt.setName('mob').setDescription('Boss name').setRequired(true).setAutocomplete(true)
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

    const bossId = interaction.options.getString('mob');
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    if (!boss)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Boss not found.' });

    const timerUnknown = interaction.options.getBoolean('timer_unknown') ?? false;
    const existing = getAllPvpKills()[bossId];
    if (existing && (existing.timerUnknown || existing.nextSpawn > Date.now())) {
      const status = existing.timerUnknown
        ? 'timer unknown — check manually'
        : `spawns ${discordRelativeTime(existing.nextSpawn)}`;
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `⚠️ **${existing.name}** is already recorded — ${status}.`,
      });
    }

    const key   = recordPvpKill(boss.name, boss.timerHours, interaction.user.id, bossId, timerUnknown);
    const entry = getAllPvpKills()[key];
    // Mirror to Supabase for the wolfpack.quest/pvp boss timer board. Skipped
    // on timer_unknown — no respawn window means no useful spawn_earliest /
    // spawn_latest to compute. Non-fatal: failures only impact the web view.
    if (!timerUnknown) {
      require('../utils/supabase').mirrorPvpBossKill({
        boss_id:     boss.id,
        boss_name:   boss.name,
        zone:        boss.zone || null,
        timer_hours: boss.timerHours,
        killed_at:   new Date(entry.killedAt).toISOString(),
        recorded_by: interaction.user.id,
        killed_by:   interaction.user.username || null,
        source:      'slash_command',
      }).catch(() => {});
    }

    let embed, replyText;
    if (timerUnknown) {
      embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle(`❓ PVP Kill — ${boss.name} (Timer Unknown)`)
        .addFields(
          { name: 'Zone',      value: boss.zone,                   inline: true },
          { name: 'Killed by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Timer',     value: 'Unknown',                   inline: true },
          { name: 'Status',    value: 'Respawn time unknown. Check manually and click below when the mob is available.', inline: false },
        )
        .setTimestamp();
      replyText = `✅ PVP kill recorded for **${boss.name}** (timer unknown).`;
    } else {
      embed = new EmbedBuilder()
        .setColor(0xcc0000)
        .setTitle(`🗡️ PVP Kill — ${boss.name}`)
        .addFields(
          { name: 'Zone',      value: boss.zone,                   inline: true },
          { name: 'Killed by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Base Timer', value: `${boss.timerHours}h (±20%)`, inline: true },
          { name: '⏰ Earliest Spawn',
            value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`,
            inline: false },
          { name: '⏳ Latest Spawn',
            value: `${discordAbsoluteTime(entry.nextSpawnLatest)} (${discordRelativeTime(entry.nextSpawnLatest)}) — guaranteed by this time`,
            inline: false },
        )
        .setTimestamp();
      replyText = `✅ PVP kill recorded for **${boss.name}**.\nEarliest spawn: ${discordRelativeTime(entry.nextSpawn)} · Latest: ${discordRelativeTime(entry.nextSpawnLatest)}`;
    }

    const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
    if (killsThreadId) {
      try {
        const thread = await interaction.client.channels.fetch(killsThreadId);
        const payload = { embeds: [embed] };
        if (timerUnknown) {
          payload.components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`mark_avail:pvp:${key}`)
              .setLabel('✅ Mob is Available')
              .setStyle(ButtonStyle.Success)
          )];
        }
        const msg = await thread.send(payload);
        setPvpKillThreadMessageId(key, msg.id);
      } catch (err) {
        console.warn('[pvpkill] Could not post to PVP_KILLS_THREAD_ID:', err?.message);
      }
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: replyText });
  },
};
