// commands/announce.js
// Creates a raid announcement with:
//   1. A new thread at the bottom of #raid-mobs named "<Boss> — <time>"
//   2. The thread contains full PQDI boss info (drops, spells, resists, abilities)
//   3. Wherever /announce was used, posts a compact announcement linking to the thread
//   4. Creates a Discord scheduled event linking to the thread
//   5. Kill + Cancel/Archive buttons on the announcement

const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags,
} = require('discord.js');
const https = require('https');
const { addAnnounceMessageId } = require('../utils/state');
const { hasAllowedRole, allowedRolesList, getAllowedRoles } = require('../utils/roles');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'QuarmRaidBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/** Scrape a PQDI NPC page and extract boss detail fields */
function scrapePqdiDetails(html, boss) {
  const fields = [];

  // HP
  const hpMatch = html.match(/hp[\"'\s]*[=:]\s*(\d+)/i) || html.match(/Max HP[^<]*<[^>]+>(\d[\d,]+)/i);
  if (hpMatch) fields.push({ name: '❤️ HP', value: parseInt(hpMatch[1]).toLocaleString(), inline: true });

  // Hit range
  const minHitMatch = html.match(/min_dmg[\"'\s]*[=:]\s*(\d+)/i);
  const maxHitMatch = html.match(/max_dmg[\"'\s]*[=:]\s*(\d+)/i);
  if (minHitMatch && maxHitMatch) fields.push({ name: '⚔️ Hit Range', value: `${minHitMatch[1]}–${maxHitMatch[1]}`, inline: true });

  // AC
  const acMatch = html.match(/ac[\"'\s]*[=:]\s*(\d+)/i);
  if (acMatch) fields.push({ name: '🛡️ AC', value: acMatch[1], inline: true });

  // See Invis / IVU
  const seesInvis = /see_invis[\"'\s]*[=:]\s*1/i.test(html) || /Sees Invisible/i.test(html);
  const seesIVU   = /see_hide[\"'\s]*[=:]\s*1/i.test(html) || /Sees IVU/i.test(html);
  const seeStr    = [seesInvis && 'See Invis', seesIVU && 'See IVU'].filter(Boolean).join(', ') || 'No';
  fields.push({ name: '👁️ Detection', value: seeStr, inline: true });

  // Resists
  const resists = [];
  const resistFields = [
    ['mr', 'Magic'], ['fr', 'Fire'], ['cr', 'Cold'], ['pr', 'Poison'], ['dr', 'Disease'],
  ];
  for (const [key, label] of resistFields) {
    const m = html.match(new RegExp(`${key}[\"'\\s]*[=:]\\s*(-?\\d+)`, 'i'));
    if (m && m[1] !== '0') resists.push(`${label}: ${m[1]}`);
  }
  if (resists.length > 0) fields.push({ name: '🧪 Resists', value: resists.join(' | '), inline: false });

  // Special abilities
  const specials = [];
  if (/Rampage/i.test(html))   specials.push('Rampage');
  if (/Flurry/i.test(html))    specials.push('Flurry');
  if (/Enrage/i.test(html))    specials.push('Enrage');
  if (/Summon/i.test(html) && !/Cannot Summon/i.test(html)) specials.push('Summons');
  if (/Uncharmable/i.test(html)) specials.push('Uncharmable');
  if (/Unmezable/i.test(html) || /Unmezzable/i.test(html)) specials.push('Unmezzable');
  if (/Unstunable/i.test(html) || /Unstunable/i.test(html)) specials.push('Unstunable');
  if (specials.length > 0) fields.push({ name: '⚡ Abilities', value: specials.join(', '), inline: false });

  // Spells
  const spellMatches = [...html.matchAll(/href="\/spell\/(\d+)"[^>]*>([^<]+)</gi)];
  if (spellMatches.length > 0) {
    const spellList = spellMatches.slice(0, 10)
      .map((m) => `[${m[2].trim()}](https://www.pqdi.cc/spell/${m[1]})`)
      .join('\n');
    fields.push({ name: `🔮 Spells (${spellMatches.length})`, value: spellList.slice(0, 1020), inline: false });
  }

  // Drops
  const itemMatches = [...html.matchAll(/href="\/item\/(\d+)"[^>]*>([^<]+)<\/a>\s*([\d.]+)%/gi)];
  if (itemMatches.length > 0) {
    const dropList = itemMatches.slice(0, 15)
      .map((m) => `[${m[2].trim()}](https://www.pqdi.cc/item/${m[1]}) — ${m[3]}%`)
      .join('\n');
    fields.push({ name: `📦 Drops (${itemMatches.length} items)`, value: dropList.slice(0, 1020), inline: false });
  }

  return fields;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Announce a planned raid. Creates a thread in #raid-mobs with full boss info.')
    .addStringOption((opt) => opt.setName('boss').setDescription('Which boss?').setRequired(true).setAutocomplete(true))
    .addStringOption((opt) => opt.setName('time').setDescription('When? (e.g. "9:00 PM EST")').setRequired(true))
    .addStringOption((opt) => opt.setName('note').setDescription('Optional extra info').setRequired(false)),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const choices = bosses.map((b) => ({
      name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`, value: b.id,
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
    const time   = interaction.options.getString('time');
    const note   = interaction.options.getString('note');
    const boss   = bosses.find((b) => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ── 1. Create thread in #raid-mobs ────────────────────────────────────
    const mainChannelId = process.env.TIMER_CHANNEL_ID;
    let raidThread      = null;
    let threadUrl       = null;

    if (mainChannelId) {
      try {
        const mainChannel = await interaction.client.channels.fetch(mainChannelId);
        raidThread = await mainChannel.threads.create({
          name: `${boss.name} — ${time}`,
          autoArchiveDuration: 1440, // 24h
          reason: `Raid announcement: ${boss.name}`,
        });
        threadUrl = `https://discord.com/channels/${interaction.guildId}/${raidThread.id}`;
      } catch (err) {
        console.warn('Could not create raid thread:', err?.message);
      }
    }

    // ── 2. Scrape PQDI and post full boss info in thread ──────────────────
    if (raidThread && boss.pqdiUrl) {
      try {
        const html      = await fetchUrl(boss.pqdiUrl);
        const details   = scrapePqdiDetails(html, boss);
        const infoEmbed = new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle(`${boss.emoji || '⚔️'} ${boss.name}`)
          .setURL(boss.pqdiUrl)
          .setDescription(
            `**Zone:** ${boss.zone}\n**Planned time:** ${time}` +
            (note ? `\n**Note:** ${note}` : '') +
            `\n\n[Full PQDI listing](${boss.pqdiUrl})`
          )
          .setTimestamp();
        if (details.length > 0) infoEmbed.addFields(details.slice(0, 25));
        await raidThread.send({ embeds: [infoEmbed] });
      } catch (err) {
        console.warn('Could not fetch PQDI details:', err?.message);
        await raidThread.send({ content: `PQDI info unavailable — [View on PQDI](${boss.pqdiUrl})` });
      }
    }

    // ── 3. Create Discord scheduled event ─────────────────────────────────
    let eventUrl = null;
    try {
      // Parse time string to a Date (rough approximation for today/tomorrow)
      const timeStr  = time.replace(/\s*(AM|PM)\s*(EST|EDT|ET|PST|PT|UTC)?/gi, ' $1').trim();
      let   eventStart = new Date();
      const tMatch   = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
      if (tMatch) {
        let h = parseInt(tMatch[1]);
        const mins = parseInt(tMatch[2] || '0');
        const ampm = tMatch[3].toUpperCase();
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        eventStart = new Date();
        eventStart.setHours(h, mins, 0, 0);
        // If the time has already passed today, set for tomorrow
        if (eventStart < new Date()) eventStart.setDate(eventStart.getDate() + 1);
      } else {
        // Couldn't parse — default to 1 hour from now
        eventStart = new Date(Date.now() + 3600000);
      }
      const eventEnd = new Date(eventStart.getTime() + 2 * 3600000); // 2h duration

      const event = await interaction.guild.scheduledEvents.create({
        name: `Pack Takedown: ${boss.name}`,
        scheduledStartTime: eventStart,
        scheduledEndTime:   eventEnd,
        privacyLevel: 2, // GUILD_ONLY
        entityType:   3, // EXTERNAL
        entityMetadata: { location: threadUrl || boss.pqdiUrl || boss.zone },
        description: `${boss.zone}\nPlanned by ${interaction.user.username}${note ? '\n' + note : ''}`,
      });
      eventUrl = `https://discord.com/events/${interaction.guildId}/${event.id}`;
    } catch (err) {
      console.warn('Could not create Discord event:', err?.message);
    }

    // ── 4. Post compact announcement wherever /announce was called ─────────
    const allowedRoleNames = getAllowedRoles();
    const roleMentions = allowedRoleNames
      .map((name) => { const r = interaction.guild.roles.cache.find((r) => r.name === name); return r ? `<@&${r.id}>` : null; })
      .filter(Boolean).join(' ');

    const descLines = [
      `<@${interaction.user.id}> is planning a pack takedown on **[${boss.name}](${boss.pqdiUrl})** at **${time}**.`,
      `**Zone:** ${boss.zone}`,
    ];
    if (note) descLines.push(`**Note:** ${note}`);
    if (raidThread) descLines.push(`\n📋 **Raid thread:** <#${raidThread.id}>`);
    if (eventUrl)   descLines.push(`📅 **Event:** [Click Interested!](${eventUrl})`);
    descLines.push('\nUse the button below to record the kill when it happens.');

    const announceEmbed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle(`📣 Pack Takedown: ${boss.name}`)
      .setDescription(descLines.join('\n'))
      .setTimestamp()
      .setFooter({ text: 'Archived to Historic Kills at midnight • Use Cancel to archive early' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kill:${boss.id}`).setLabel(`${boss.emoji || '⚔️'} Kill ${boss.name}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel_announce').setLabel('❌ Cancel / Archive').setStyle(ButtonStyle.Secondary),
    );

    // Post announcement in the channel where /announce was used
    const announceChannel = interaction.channel;
    const annMsg = await announceChannel.send({
      content: roleMentions || undefined,
      embeds: [announceEmbed],
      components: [row],
    });
    addAnnounceMessageId(annMsg.id);

    await interaction.editReply(
      `✅ Announcement posted!` +
      (raidThread ? `\n📋 Raid thread: <#${raidThread.id}>` : '') +
      (eventUrl ? `\n📅 Event: ${eventUrl}` : '')
    );
  },
};
