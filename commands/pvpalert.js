// commands/pvpalert.js — Ping the @PVP role and howl for the pack in a zone.
// Re-alerting within 1 hour updates the existing message (no re-ping) instead of posting fresh.
const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');

const ALERT_WINDOW_MS = 60 * 60 * 1000;

// In-memory per-user alert state — intentionally not persisted (1h window is short)
// userId → { messageId, channelId, currentZone, prevZones: [], displayName, mention, expiresAt }
const userAlerts = new Map();

async function getPvpTarget(client) {
  const id = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  if (!id) return null;
  return client.channels.fetch(id).catch(() => null);
}

function buildHowlRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pvpalert_howl:${messageId}`)
      .setLabel('🐺 Howl!')
      .setStyle(ButtonStyle.Danger),
  );
}

// EQ Atlas uses EQ short zone names; derive a best-effort slug from the display name.
// e.g. "Nagafen's Lair" → "nagafenslair", "Field of Bone" → "fieldofbone"
function zoneLinks(zoneName) {
  const slug = zoneName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `[PQDI](https://www.pqdi.cc/zones) · [Map](https://www.eqatlas.com/zones/${slug}.html)`;
}

function buildBaseContent(mention, displayName, currentZone, prevZones) {
  const lines = [];
  if (mention) lines.push(mention);
  lines.push(`The Bloodthirsty **${displayName}** howls for the pack in **${currentZone}**!`);
  if (prevZones.length > 0) {
    const prevList = prevZones.map(z => `**${z}** (${zoneLinks(z)})`).join(', ');
    lines.push(`*(prev ${prevList})*`);
  }
  return lines.join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpalert')
    .setDescription('Ping the @PVP role and howl for the pack in a zone.')
    .addStringOption(opt =>
      opt.setName('zone').setDescription('Zone where you need the pack').setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    delete require.cache[require.resolve('../data/zones.json')];
    const zones = require('../data/zones.json').map(z => z.name).sort();
    const matches = zones.filter(z => z.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(matches.map(z => ({ name: z, value: z })));
  },

  async execute(interaction) {
    const zone   = interaction.options.getString('zone');
    const member = interaction.member;
    const userId = interaction.user.id;
    const now    = Date.now();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const pvpRoleName = process.env.PVP_ROLE || 'PVP';
    const pvpRole     = interaction.guild.roles.cache.find(r => r.name === pvpRoleName);
    const mention     = pvpRole ? `<@&${pvpRole.id}>` : '';

    const existing = userAlerts.get(userId);
    if (existing && existing.expiresAt > now) {
      // ── Update existing alert (no new ping — Discord only pings on initial send) ──
      const newPrevZones = [...existing.prevZones, existing.currentZone];

      userAlerts.set(userId, {
        ...existing,
        currentZone: zone,
        prevZones:   newPrevZones,
        expiresAt:   now + ALERT_WINDOW_MS, // rolling window
      });

      try {
        const ch  = await interaction.client.channels.fetch(existing.channelId);
        const msg = await ch.messages.fetch(existing.messageId);

        const baseContent = buildBaseContent(existing.mention, existing.displayName, zone, newPrevZones);
        const howlersLine = msg.content.split('\n').find(l => l.includes('howls back!')) || '';
        const newContent  = howlersLine ? `${baseContent}\n${howlersLine}` : baseContent;

        await msg.edit({ content: newContent, components: msg.components });
      } catch (err) {
        console.warn('pvpalert update: could not edit message:', err?.message);
      }

      await interaction.editReply(`✅ Alert updated to **${zone}**!`);
      return;
    }

    // ── New alert (first howl in window — pings @PVP) ──────────────────────
    const ch          = (await getPvpTarget(interaction.client)) || interaction.channel;
    const baseContent = buildBaseContent(mention, member.displayName, zone, []);

    const sent = await ch.send({ content: baseContent });
    await sent.edit({ content: baseContent, components: [buildHowlRow(sent.id)] });

    userAlerts.set(userId, {
      messageId:   sent.id,
      channelId:   ch.id,
      currentZone: zone,
      prevZones:   [],
      displayName: member.displayName,
      mention,
      expiresAt:   now + ALERT_WINDOW_MS,
    });

    await interaction.editReply(`✅ Howl posted!`);
  },

  buildHowlRow,
};
