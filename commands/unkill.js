// commands/unkill.js

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { clearKill, getBossState, getAllState, getZoneCard, clearZoneCard } = require('../utils/state');
const { postKillUpdate } = require('../utils/killops');
const { buildZoneKillCard } = require('../utils/embeds');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { isPopLocked } = require('../utils/config');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

function parseMessageLink(link) {
  const m = (link || '').trim().match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

// Removes one boss from a daily summary embed's Killed field. Returns a new
// EmbedBuilder with the line removed, or null if the boss wasn't in the summary.
function removeBossFromDailySummary(embed, bossName) {
  const fields = embed.fields || [];
  const idx = fields.findIndex(f => f.name.startsWith('☠️ Killed'));
  if (idx === -1) return null;

  const field = fields[idx];
  const lines = field.value.split('\n').filter(l => l.trim() && l !== 'No kills recorded.');
  const newLines = lines.filter(l => !l.includes(`**${bossName}**`));
  if (newLines.length === lines.length) return null; // boss not present

  const newValue = newLines.length > 0 ? newLines.join('\n') : 'No kills recorded.';
  const count = newLines.length;
  // Preserve "☠️ Killed Today" / "☠️ Killed <date>" prefix, update or drop the (N) count
  const newName = count > 0
    ? field.name.replace(/\s*\(\d+\)$/, ` (${count})`)
    : field.name.replace(/\s*\(\d+\)$/, '');

  const updatedFields = fields.map((f, i) =>
    i === idx ? { name: newName, value: newValue, inline: f.inline ?? false }
              : { name: f.name, value: f.value, inline: f.inline ?? false }
  );

  const builder = new EmbedBuilder()
    .setTitle(embed.title)
    .setColor(embed.color ?? 0x4b0082)
    .setFields(updatedFields);
  if (embed.description) builder.setDescription(embed.description);
  if (embed.timestamp)   builder.setTimestamp(new Date(embed.timestamp));
  return builder;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unkill')
    .setDescription('Clear a boss kill record (undo a /kill)')
    .addStringOption((opt) =>
      opt.setName('boss').setDescription('Which boss kill to clear?').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt.setName('message')
        .setDescription('Discord message link to a daily summary — removes this boss from that entry in place')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      bosses.filter((b) => !isPopLocked(b)).map((b) => ({ name: `${b.name} (${b.zone})`, value: b.id }))
        .filter((c) => c.name.toLowerCase().includes(focused)).slice(0, 25)
    );
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
    }

    const bosses  = getBosses();
    const bossId  = interaction.options.getString('boss');
    const msgLink = interaction.options.getString('message')?.trim() || null;
    const boss    = bosses.find((b) => b.id === bossId);

    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });
    if (isPopLocked(boss)) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '🔒 PoP bosses are not available until October 1, 2026.' });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // ── Daily summary edit ───────────────────────────────────────────────────
    let summaryEdited = false;
    if (msgLink) {
      const parsed = parseMessageLink(msgLink);
      if (!parsed) {
        return interaction.editReply('❌ Invalid message link. Right-click the daily summary → Copy Message Link.');
      }
      let refMsg;
      try {
        const ch = await interaction.client.channels.fetch(parsed.channelId);
        refMsg   = await ch.messages.fetch(parsed.messageId);
      } catch (err) {
        return interaction.editReply(`❌ Could not fetch that message: ${err?.message}`);
      }
      const embed = refMsg.embeds[0];
      if (!embed || embed.title !== '📅 Daily Raid Summary') {
        return interaction.editReply('❌ That message is not a Daily Raid Summary embed.');
      }
      const newEmbed = removeBossFromDailySummary(embed, boss.name);
      if (!newEmbed) {
        return interaction.editReply(`❌ **${boss.name}** was not found in that daily summary.`);
      }
      await refMsg.edit({ embeds: [newEmbed] });
      summaryEdited = true;
    }

    // ── Live kill state ──────────────────────────────────────────────────────
    const existing = getBossState(bossId);

    if (!existing && !summaryEdited) {
      return interaction.editReply(`⬜ **${boss.name}** has no recorded kill.`);
    }

    if (existing) {
      clearKill(bossId);

      const now         = Date.now();
      const killState   = getAllState();
      const zoneCard    = getZoneCard(boss.zone);
      const stillKilled = bosses.filter((b) => b.zone === boss.zone && killState[b.id]?.nextSpawn > now);

      if (zoneCard) {
        try {
          const targetCh = await interaction.client.channels.fetch(zoneCard.threadId || interaction.channelId);
          if (stillKilled.length > 0) {
            const killedInZone = stillKilled.map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));
            const msg = await targetCh.messages.fetch(zoneCard.messageId);
            await msg.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
          } else {
            const msg = await targetCh.messages.fetch(zoneCard.messageId);
            await msg.delete();
            clearZoneCard(boss.zone);
          }
        } catch { clearZoneCard(boss.zone); }
      }

      await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId);
    }

    // ── Reply ────────────────────────────────────────────────────────────────
    const parts = [];
    if (existing)      parts.push(`🗑️ Kill record cleared for **${boss.name}**.`);
    if (summaryEdited) parts.push(`📝 Removed **${boss.name}** from the daily summary.`);
    await interaction.editReply(parts.join('\n'));

    // ── Audit ────────────────────────────────────────────────────────────────
    const { postAuditEntry } = require('../utils/audit');
    postAuditEntry(interaction.client, {
      action:       msgLink ? 'unkill_summary' : 'unkill',
      userId:       interaction.user.id,
      userName:     interaction.user.username,
      bossId,
      bossName:     boss.name,
      prevState:    existing || null,
      newNextSpawn: null,
      msgLink,
    }).catch(() => {});
  },
};
