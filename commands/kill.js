// commands/kill.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { recordKill, getAllState, getZoneCard, setZoneCard } = require('../utils/state');
const { postKillUpdate } = require('../utils/killops');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { getThreadId, getBossExpansion } = require('../utils/config');
const { buildZoneKillCard } = require('../utils/embeds');

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
    await interaction.respond(
      choices.filter((c) => !focused || c.terms.some((t) => t.includes(focused)) || c.name.toLowerCase().includes(focused))
        .slice(0, 25).map(({ name, value }) => ({ name, value }))
    );
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

    // Determine which thread this boss belongs in
    const expansion = getBossExpansion(boss);
    const threadId  = getThreadId(expansion);

    // Build zone kill card content
    const killState    = getAllState();
    const now          = Date.now();
    const zoneBosses   = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses
      .filter((b) => killState[b.id] && killState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));

    const embed = buildZoneKillCard(boss.zone, killedInZone);
    if (note) embed.addFields({ name: 'Note', value: note, inline: false });

    // Post/update zone card in thread (or main channel if no thread configured)
    const targetChannelId = threadId || process.env.TIMER_CHANNEL_ID;
    const existing = getZoneCard(boss.zone);

    if (existing && existing.messageId) {
      try {
        const targetCh = await interaction.client.channels.fetch(existing.threadId || targetChannelId);
        const msg = await targetCh.messages.fetch(existing.messageId);
        await msg.edit({ embeds: [embed] });
        // Acknowledge kill silently if in a thread; publicly if in main channel
        const inThread = interaction.channelId !== process.env.TIMER_CHANNEL_ID;
        await interaction.reply({
          flags: inThread ? undefined : MessageFlags.Ephemeral,
          content: `✅ **${boss.name}** kill recorded — zone card updated${threadId ? ' in thread' : ''}.`,
          flags: MessageFlags.Ephemeral,
        });
        // Run board + summary updates
        await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId);
        return;
      } catch { /* card gone — post new */ }
    }

    // Post new zone card
    if (threadId) {
      const thread = await interaction.client.channels.fetch(threadId);
      const sent   = await thread.send({ embeds: [embed] });
      setZoneCard(boss.zone, sent.id, threadId);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ **${boss.name}** kill recorded in <#${threadId}>.` });
    } else {
      const { resource } = await interaction.reply({ embeds: [embed], withResponse: true });
      setZoneCard(boss.zone, resource.message.id, null);
    }

    await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId);
  },
};
