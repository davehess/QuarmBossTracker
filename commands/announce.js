// commands/announce.js
// Creates a raid announcement with:
//   1. A new thread in #raid-mobs named "<Boss/Zone> — <time>"
//   2. Thread contains full PQDI boss info + target buttons + cancel button
//   3. Posts a compact announcement (with kill + cancel buttons) wherever /announce was used
//   4. Creates a Discord scheduled event
//   5. Persists full announce state for /adjusttime, /adjustdate, /addtarget, /removetarget

const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags,
} = require('discord.js');
const https = require('https');
const { addAnnounceMessageId, saveAnnounce } = require('../utils/state');
const { hasAllowedRole, allowedRolesList, getAllowedRoles } = require('../utils/roles');
const { parseUserTime, getDefaultTz, formatInDefaultTz } = require('../utils/timezone');

// ── Easter-egg boss chain ─────────────────────────────────────────────────────
const EASTER_EGG_CHAIN = [
  {
    id: '_fippy_darkpaw', name: 'Fippy Darkpaw', zone: 'Crushbone', emoji: '🐾',
    pqdiUrl: 'https://www.pqdi.cc/npc/2174',
    quote: "Fippy Darkpaw shouts, '<BBBBBAAAARRRKKKK!> You wolves will pay for ruining our homeland! GRRRRRRRR! Family Darkpaw of the Sabertooth Clan will slay you all! <BARK!>'",
  },
  {
    id: '_nillipuss', name: 'Nillipuss', zone: 'Plane of Mischief', emoji: '🧌',
    pqdiUrl: 'https://www.pqdi.cc/npc/19015',
    quote: "Nillipuss, Nillipuss is my name. Stealing jumjum is my game. Think you can catch me? Let's see if you can! I'll always run faster than you ever ran.",
  },
  {
    id: '_emperor_crush', name: 'Emperor Crush', zone: 'Crushbone', emoji: '👑',
    pqdiUrl: 'https://www.pqdi.cc/npc/58032',
    quote: null,
  },
];

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

function decodeHtml(str) {
  return str.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function scrapePqdiDetails(html) {
  const fields = [];

  // Try multiple regex patterns for a stat — handles **field:** value (markdown bold),
  // "field": value (JSON), and plain field: value formats.
  function tryStat(...patterns) {
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) return m[1];
    }
    return null;
  }

  const hp = tryStat(
    /\*\*hp:\*\*\s*(\d[\d,]*)/i,
    /\*\*hp:\s*(\d[\d,]*)\*\*/i,
    /"hp"\s*:\s*(\d+)/i,
    /Max HP[^<]*<[^>]+>(\d[\d,]+)/i,
    /\bhp["'\s]*[=:]\s*(\d+)/i,
  );
  if (hp) fields.push({ name: '❤️ HP', value: parseInt(hp.replace(/,/g, '')).toLocaleString(), inline: true });

  const minHit = tryStat(/\*\*min_dmg:\*\*\s*(\d+)/i, /\*\*min_dmg:\s*(\d+)\*\*/i, /"min_dmg"\s*:\s*(\d+)/i, /min_dmg["'\s]*[=:]\s*(\d+)/i);
  const maxHit = tryStat(/\*\*max_dmg:\*\*\s*(\d+)/i, /\*\*max_dmg:\s*(\d+)\*\*/i, /"max_dmg"\s*:\s*(\d+)/i, /max_dmg["'\s]*[=:]\s*(\d+)/i);
  if (minHit && maxHit) fields.push({ name: '⚔️ Hit Range', value: `${minHit}–${maxHit}`, inline: true });

  const ac = tryStat(/\*\*ac:\*\*\s*(\d+)/i, /\*\*ac:\s*(\d+)\*\*/i, /"ac"\s*:\s*(\d+)/i, /\bac["'\s]*[=:]\s*(\d+)/i);
  if (ac) fields.push({ name: '🛡️ AC', value: ac, inline: true });

  const seesInvis = /see_invis["'\s]*[=:]\s*1/i.test(html) || /Sees Invisible/i.test(html);
  const seesIVU   = /see_hide["'\s]*[=:]\s*1/i.test(html)  || /Sees IVU/i.test(html);
  const detectionVal = [seesInvis && 'See Invis', seesIVU && 'See IVU'].filter(Boolean).join(', ') || '⚠️ Not confirmed — verify before pull';
  fields.push({ name: '👁️ Detection', value: detectionVal, inline: true });

  // Always show all resist values — zero is as strategically important as high ones
  const resistParts = [];
  for (const [aliases, label] of [
    [['MR', 'mr', 'magic_resist'],   'MR'],
    [['FR', 'fr', 'fire_resist'],    'FR'],
    [['CR', 'cr', 'cold_resist'],    'CR'],
    [['PR', 'pr', 'poison_resist'],  'PR'],
    [['DR', 'dr', 'disease_resist'], 'DR'],
  ]) {
    let val = null;
    for (const alias of aliases) {
      val = tryStat(
        new RegExp(`\\*\\*${alias}:\\*\\*\\s*(-?\\d+)`, 'i'),
        new RegExp(`\\*\\*${alias}:\\s*(-?\\d+)\\*\\*`, 'i'),
        new RegExp(`"${alias}"\\s*:\\s*(-?\\d+)`, 'i'),
        new RegExp(`(?<![a-zA-Z_])${alias}["'\\s]*[=:]\\s*(-?\\d+)`, 'i'),
      );
      if (val !== null) break;
    }
    resistParts.push(`${label}: **${val ?? '?'}**`);
  }
  fields.push({ name: '🧪 Resists', value: resistParts.join('  '), inline: false });
  const specials = [];
  if (/Rampage/i.test(html))    specials.push('Rampage');
  if (/Flurry/i.test(html))     specials.push('Flurry');
  if (/Enrage/i.test(html))     specials.push('Enrage');
  if (/Summon/i.test(html) && !/Cannot Summon/i.test(html)) specials.push('Summons');
  if (/Uncharmable/i.test(html)) specials.push('Uncharmable');
  if (/Unmez(?:z)?able/i.test(html)) specials.push('Unmezzable');
  if (/Unstun(?:n)?able/i.test(html)) specials.push('Unstunable');
  if (specials.length) fields.push({ name: '⚡ Abilities', value: specials.join(', '), inline: false });
  const spells = [...html.matchAll(/href="\/spell\/(\d+)"[^>]*>([^<]+)</gi)];
  if (spells.length) {
    fields.push({ name: `🔮 Spells (${spells.length})`, value: spells.slice(0,10).map(m => `[${m[2].trim()}](https://www.pqdi.cc/spell/${m[1]})`).join('\n').slice(0,1020), inline: false });
  }
  const items = [...html.matchAll(/href="\/item\/(\d+)"[^>]*>([^<]+)<\/a>\s*([\d.]+)%/gi)];
  if (items.length) {
    fields.push({ name: `📦 Drops (${items.length} items)`, value: items.slice(0,15).map(m => `[${decodeHtml(m[2].trim())}](https://www.pqdi.cc/item/${m[1]}) — ${m[3]}%`).join('\n').slice(0,1020), inline: false });
  }
  return fields;
}

/** Build the thread control-panel embed showing current targets */
function buildControlPanelEmbed(targets, bosses, zone, plannedTimeStr) {
  const targetNames = targets.map(tid => {
    const ee = EASTER_EGG_CHAIN.find(e => e.id === tid);
    if (ee) return `${ee.emoji} ${ee.name} (${ee.zone})`;
    const b = bosses.find(b => b.id === tid);
    return b ? `${b.emoji || '⚔️'} ${b.name} (${b.zone})` : tid;
  });
  return new EmbedBuilder()
    .setColor(0xf5a623)
    .setTitle('📋 Raid Targets')
    .addFields(
      { name: '🕐 Planned Time', value: plannedTimeStr || 'Unknown', inline: false },
      { name: '🎯 Current Targets', value: targetNames.length ? targetNames.join('\n') : '*No targets set — use `/addtarget <boss>`*', inline: false },
      { name: '⚙️ Commands', value: '`/addtarget <boss>` · `/removetarget <boss>` · `/adjusttime <time>` · `/adjustdate <date>`', inline: false },
    )
    .setFooter({ text: 'Use the Cancel button below to remove the event' });
}

/** Build ActionRows of Remove-target buttons (max 5 per row, max 4 rows to leave room for cancel) */
function buildTargetButtons(targets, bosses) {
  const rows = [];
  const chunks = [];
  for (let i = 0; i < targets.length; i += 5) chunks.push(targets.slice(i, i + 5));
  for (const chunk of chunks.slice(0, 4)) {
    const row = new ActionRowBuilder();
    for (const tid of chunk) {
      const ee = EASTER_EGG_CHAIN.find(e => e.id === tid);
      const label = ee ? ee.name : (bosses.find(b => b.id === tid)?.name || tid);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`remove_target:${tid}`)
          .setLabel(`Remove ${label}`)
          .setStyle(ButtonStyle.Danger)
      );
    }
    rows.push(row);
  }
  return rows;
}

/** Cancel event button row for the thread control panel */
function buildCancelRow(announceMessageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cancel_event_thread:${announceMessageId}`)
      .setLabel('❌ Cancel Event')
      .setStyle(ButtonStyle.Danger)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Announce a planned raid with a thread, event, and target tracking.')
    .addStringOption(opt => opt.setName('boss').setDescription('Specific boss target').setRequired(false).setAutocomplete(true))
    .addStringOption(opt => opt.setName('time').setDescription('When? e.g. "8:30 PM", "Thursday 8:30pm", "tomorrow 9pm"').setRequired(false))
    .addStringOption(opt => opt.setName('zone').setDescription('Zone/area for a multi-target announcement').setRequired(false).setAutocomplete(true))
    .addStringOption(opt => opt.setName('note').setDescription('Optional extra info').setRequired(false)),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const option  = interaction.options.getFocused(true);

    if (option.name === 'boss') {
      const choices = bosses.map(b => ({
        name: `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`,
        value: b.id,
        terms: [b.name.toLowerCase(), ...(b.nicknames || []).map(n => n.toLowerCase())],
      }));
      await interaction.respond(
        choices.filter(c => !focused || c.terms.some(t => t.includes(focused)) || c.name.toLowerCase().includes(focused))
          .slice(0, 25).map(({ name, value }) => ({ name, value }))
      );
    } else if (option.name === 'zone') {
      delete require.cache[require.resolve('../data/zones.json')];
      const allZones = require('../data/zones.json').map(z => z.name).sort();
      await interaction.respond(
        allZones.filter(z => !focused || z.toLowerCase().includes(focused))
          .slice(0, 25).map(z => ({ name: z, value: z }))
      );
    }
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const bosses  = getBosses();
    const bossId  = interaction.options.getString('boss');
    const zone    = interaction.options.getString('zone');
    const timeStr = interaction.options.getString('time');
    const note    = interaction.options.getString('note');

    if (!bossId && !zone)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Provide a `boss` or `zone`.' });
    if (!timeStr)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ `time` is required — e.g. `"8:30 PM"`, `"Thursday 9pm"`, `"tomorrow 8pm"`.' });

    const boss = bossId ? bosses.find(b => b.id === bossId) : null;
    if (bossId && !boss)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    // Zone-level announce: find all bosses in the zone
    const zoneBosses = zone ? bosses.filter(b => b.zone === zone) : (boss ? [boss] : []);
    const announceName = boss ? boss.name : zone;
    const announceZone = boss ? boss.zone : zone;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ── Parse time (timezone-aware) ───────────────────────────────────────
    let eventStart = parseUserTime(timeStr);
    if (!eventStart || isNaN(eventStart.getTime())) {
      eventStart = new Date(Date.now() + 3600000); // fallback: 1h from now
    }
    const eventEnd = new Date(eventStart.getTime() + 2 * 3600000);
    const plannedTimeStr = formatInDefaultTz(eventStart);

    // ── Create thread in #raid-mobs ────────────────────────────────────────
    const mainChannelId = process.env.TIMER_CHANNEL_ID;
    let raidThread = null, threadUrl = null;
    if (mainChannelId) {
      try {
        const mainChannel = await interaction.client.channels.fetch(mainChannelId);
        raidThread = await mainChannel.threads.create({
          name: `${announceName} — ${plannedTimeStr}`,
          autoArchiveDuration: 1440,
          reason: `Raid announcement: ${announceName}`,
        });
        threadUrl = `https://discord.com/channels/${interaction.guildId}/${raidThread.id}`;
      } catch (err) { console.warn('Could not create raid thread:', err?.message); }
    }

    // ── Post boss info card(s) in thread ──────────────────────────────────
    const targets = boss ? [boss.id] : [];

    if (raidThread) {
      const bossesToPost = zoneBosses.length ? zoneBosses : (boss ? [boss] : []);
      for (const b of bossesToPost) {
        if (b.pqdiUrl) {
          try {
            const html    = await fetchUrl(b.pqdiUrl);
            const details = scrapePqdiDetails(html);
            const embed   = new EmbedBuilder()
              .setColor(0xf5a623)
              .setTitle(`${b.emoji || '⚔️'} ${b.name}`)
              .setURL(b.pqdiUrl)
              .setDescription(
                `**Zone:** ${b.zone}\n**Planned time:** ${plannedTimeStr}` +
                (note ? `\n**Note:** ${note}` : '') +
                `\n\n[Full PQDI listing](${b.pqdiUrl})`
              )
              .setTimestamp();
            if (details.length) embed.addFields(details.slice(0, 25));
            await raidThread.send({ embeds: [embed] });
          } catch { await raidThread.send({ content: `PQDI info unavailable — [View on PQDI](${b.pqdiUrl})` }); }
        }
      }

      // If zone-level, show target-picker message so users know what to add
      if (zone && !bossId) {
        const pickerLines = zoneBosses.map(b => `• ${b.emoji || '⚔️'} **${b.name}** — use \`/addtarget\` to add`);
        if (pickerLines.length) {
          await raidThread.send({
            content: `**Available targets in ${zone}:**\n${pickerLines.join('\n')}\n\nUse \`/addtarget <boss>\` to add targets to this event.`,
          });
        }
      }
    }

    // ── Create Discord event ───────────────────────────────────────────────
    let eventUrl = null, eventId = null;
    try {
      const event = await interaction.guild.scheduledEvents.create({
        name: `Pack Takedown: ${announceName}`,
        scheduledStartTime: eventStart,
        scheduledEndTime:   eventEnd,
        privacyLevel: 2,
        entityType:   3,
        entityMetadata: { location: threadUrl || announceZone },
        description: `${announceZone}\nPlanned by ${interaction.member?.displayName || interaction.user.username}${note ? '\n' + note : ''}`,
      });
      eventId  = event.id;
      eventUrl = `https://discord.com/events/${interaction.guildId}/${event.id}`;
    } catch (err) { console.warn('Could not create Discord event:', err?.message); }

    // ── Post compact announcement in calling channel ───────────────────────
    const allowedRoleNames = getAllowedRoles();
    const roleMentions = allowedRoleNames
      .map(name => { const r = interaction.guild.roles.cache.find(r => r.name === name); return r ? `<@&${r.id}>` : null; })
      .filter(Boolean).join(' ');

    const descLines = [
      `<@${interaction.user.id}> is planning a pack takedown on **${announceName}** at **${plannedTimeStr}**.`,
      `**Zone:** ${announceZone}`,
    ];
    if (note) descLines.push(`**Note:** ${note}`);
    if (raidThread) descLines.push(`\n📋 **Raid thread:** <#${raidThread.id}>`);
    if (eventUrl)   descLines.push(`📅 **Event:** [Click Interested!](${eventUrl})`);
    descLines.push('\nUse the button below to record the kill when it happens.');

    const announceEmbed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle(`📣 Pack Takedown: ${announceName}`)
      .setDescription(descLines.join('\n'))
      .setTimestamp()
      .setFooter({ text: 'Archived at midnight • Use Cancel to archive early' });

    const firstTargetId = targets[0] || (zoneBosses[0]?.id);
    const killBtnId     = firstTargetId ? `kill:${firstTargetId}` : 'kill:__none__';
    const announceRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(killBtnId).setLabel(`${boss?.emoji || '⚔️'} Kill ${announceName}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel_announce').setLabel('❌ Cancel / Archive').setStyle(ButtonStyle.Secondary),
    );

    const annMsg = await interaction.channel.send({
      content: roleMentions || undefined,
      embeds: [announceEmbed],
      components: [announceRow],
    });
    addAnnounceMessageId(annMsg.id);

    // ── Post control panel in thread ───────────────────────────────────────
    if (raidThread) {
      const cpEmbed = buildControlPanelEmbed(targets, bosses, announceZone, plannedTimeStr);
      const targetRows = buildTargetButtons(targets, bosses);
      const cancelRow  = buildCancelRow(annMsg.id);

      // Kill button — mirrors the one on the announce message so the thread is self-contained
      const firstTargetId = targets[0] || zoneBosses[0]?.id;
      const killRow = firstTargetId
        ? new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`kill:${firstTargetId}`)
              .setLabel(`${boss?.emoji || '⚔️'} Kill ${announceName}`)
              .setStyle(ButtonStyle.Danger)
          )
        : null;

      await raidThread.send({
        embeds: [cpEmbed],
        components: [...(killRow ? [killRow] : []), ...targetRows, cancelRow],
      });
    }

    // ── Persist full announce state ────────────────────────────────────────
    saveAnnounce(annMsg.id, {
      eventId,
      threadId:      raidThread?.id || null,
      channelId:     interaction.channel.id,
      targets,
      zone:          announceZone,
      plannedTimeMs: eventStart.getTime(),
      plannedTimeStr,
      organizer:     interaction.user.id,
      easterEggLevel: 0,
    });

    await interaction.editReply(
      `✅ Announcement posted!` +
      (raidThread ? `\n📋 Raid thread: <#${raidThread.id}>` : '') +
      (eventUrl   ? `\n📅 Event: ${eventUrl}` : '')
    );
  },

  // Export helpers for use by addtarget/removetarget/adjusttime/adjustdate
  buildControlPanelEmbed,
  buildTargetButtons,
  buildCancelRow,
  EASTER_EGG_CHAIN,
};
