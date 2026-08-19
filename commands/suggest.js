// commands/suggest.js — Non-officer command to request an event be hosted.
// Posts a formatted request card to SUGGEST_CHANNEL_ID so officers can claim it.

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
} = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

// Shared poster — used by /suggest below AND the forum nudge card's tap-through
// flow (utils/suggestNudge.js), so both paths produce the identical officer
// card with the same host/no-host buttons. `boss` is a bosses.json entry when
// resolved; `rawLabel` carries whatever the member typed when it isn't.
// Returns true when the card posted.
async function postEventRequest({ client, userId, boss = null, rawLabel = null, timeStr, note = null }) {
  const suggestChannelId = process.env.SUGGEST_CHANNEL_ID;
  if (!suggestChannelId) return false;
  const channel = await client.channels.fetch(suggestChannelId).catch(() => null);
  if (!channel) return false;

  const bossLabel = boss
    ? `${boss.emoji ? boss.emoji + ' ' : ''}${boss.name} — ${boss.zone}`
    : (rawLabel || 'Unknown');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📣 Event Request')
    .addFields(
      { name: 'Requested by', value: `<@${userId}>`, inline: true },
      { name: 'Boss / Zone',  value: bossLabel,      inline: true },
      { name: 'Wanted time',  value: timeStr,        inline: true },
    )
    .setTimestamp()
    .setFooter({ text: 'Use the buttons below to respond to this request' });
  if (note) embed.addFields({ name: 'Note', value: note, inline: false });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggest_host:${userId}`)
      .setLabel("I'll host it")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`suggest_nohost:${userId}`)
      .setLabel('No hosts available')
      .setStyle(ButtonStyle.Danger),
  );

  // Return the posted Message (truthy, so existing `if (!posted)` checks keep
  // working) — the nudge flow's "Change time" button needs its id to edit the
  // card later.
  return await channel.send({ embeds: [embed], components: [row] });
}

// Edit the Wanted-time field on an already-posted Event Request card — powers
// the nudge flow's 🕐 Change time (Hitya 2026-08-19: Hawkner tapped a preset,
// actually wanted 10:30pm ET after the alt raid, and "couldn't change time";
// the done card was one-shot and the officer card was already posted).
async function updateEventRequestTime({ client, messageId, timeStr }) {
  const suggestChannelId = process.env.SUGGEST_CHANNEL_ID;
  if (!suggestChannelId || !messageId || !timeStr) return false;
  const channel = await client.channels.fetch(suggestChannelId).catch(() => null);
  if (!channel) return false;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg || !msg.embeds?.length) return false;
  const eb = EmbedBuilder.from(msg.embeds[0]);
  eb.setFields((msg.embeds[0].fields || []).map(f =>
    f.name === 'Wanted time' ? { name: 'Wanted time', value: timeStr, inline: true } : f,
  ));
  return await msg.edit({ embeds: [eb] }).then(() => true).catch(() => false);
}

module.exports = {
  postEventRequest,
  updateEventRequestTime,
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Request an officer to host an event for you')
    .addStringOption(opt =>
      opt.setName('boss')
        .setDescription('Boss or zone you want to run')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('When you want to do it — e.g. "9pm Tuesday", "tonight", "now"')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('note')
        .setDescription('Any extra info for the officers')
        .setRequired(false)),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const choices = [];
    const seen    = new Set();

    for (const boss of bosses) {
      const terms = [boss.name.toLowerCase(), ...(boss.nicknames || []).map(n => n.toLowerCase())];
      if (!focused || terms.some(t => t.includes(focused)) || boss.zone.toLowerCase().includes(focused)) {
        if (!seen.has(boss.id)) {
          seen.add(boss.id);
          choices.push({ name: `${boss.emoji ? boss.emoji + ' ' : ''}${boss.name} (${boss.zone})`, value: boss.id });
        }
      }
    }

    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const suggestChannelId = process.env.SUGGEST_CHANNEL_ID;
    if (!suggestChannelId)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ `SUGGEST_CHANNEL_ID` is not configured — ask an officer to set it up.' });

    const bosses  = getBosses();
    const bossId  = interaction.options.getString('boss');
    const timeStr = interaction.options.getString('time');
    const note    = interaction.options.getString('note');

    // Resolve boss — by ID (autocomplete pick) or fuzzy name match (raw type)
    let boss = bosses.find(b => b.id === bossId);
    if (!boss) {
      const q = bossId.toLowerCase();
      boss = bosses.find(b =>
        b.name.toLowerCase().includes(q) ||
        (b.nicknames || []).some(n => n.toLowerCase().includes(q))
      );
    }

    const posted = await postEventRequest({
      client: interaction.client,
      userId: interaction.user.id,
      boss,
      rawLabel: bossId,
      timeStr,
      note,
    });
    if (!posted)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the suggestions channel.' });

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `✅ Your request for **${boss ? boss.name : bossId}** has been posted to the officers. You'll be notified when someone responds!`,
    });
  },
};
