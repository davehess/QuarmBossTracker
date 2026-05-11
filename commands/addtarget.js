// commands/addtarget.js — Add a boss target to an existing announce event.
// Must be run inside the announce thread.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const {
  getAnnounceByThreadId, updateAnnounceTargets, getAnnounce, saveAnnounce,
} = require('../utils/state');
const {
  buildControlPanelEmbed, buildTargetButtons, buildKillRows, buildCancelRow, EASTER_EGG_CHAIN,
} = require('./announce');
const { isPopLocked } = require('../utils/config');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

async function refreshControlPanel(thread, announceData, bosses) {
  try {
    const msgs = await thread.messages.fetch({ limit: 20 });
    const cp = msgs.find(m =>
      m.author.bot && m.components.length > 0 &&
      m.embeds[0]?.title === '📋 Raid Targets'
    );
    if (!cp) return;
    const cpEmbed    = buildControlPanelEmbed(announceData.targets, bosses, announceData.zone, announceData.plannedTimeStr);
    const killRows   = buildKillRows(announceData.targets, bosses);
    const targetRows = buildTargetButtons(announceData.targets, bosses);
    const cancelRow  = buildCancelRow(announceData.messageId);
    await cp.edit({ embeds: [cpEmbed], components: [...killRows.slice(0, 2), ...targetRows.slice(0, 2), cancelRow] });
  } catch (err) { console.warn('addtarget: could not refresh panel:', err?.message); }
}

// Reconstruct announce state from the thread's control panel buttons after a state loss/restart.
async function restoreAnnounceFromThread(channel, bosses) {
  try {
    const msgs = await channel.messages.fetch({ limit: 50 });
    for (const msg of msgs.values()) {
      if (!msg.author.bot || !msg.components.length) continue;
      let announceId = null;
      const targets = [];
      for (const row of msg.components) {
        for (const btn of row.components) {
          const cid = btn.customId;
          if (cid?.startsWith('cancel_event_thread:')) announceId = cid.replace('cancel_event_thread:', '');
          if (cid?.startsWith('remove_target:')) { const t = cid.replace('remove_target:', ''); if (!targets.includes(t)) targets.push(t); }
          if (cid?.startsWith('kill:') && !cid.includes('__none__')) { const t = cid.replace('kill:', ''); if (!targets.includes(t)) targets.push(t); }
        }
      }
      if (!announceId) continue;
      const embed = msg.embeds[0];
      const plannedField = embed?.fields?.find(f => f.name.includes('Planned'));
      const plannedTimeStr = plannedField?.value || 'Unknown';
      const firstBoss = targets.map(tid => bosses.find(b => b.id === tid)).find(Boolean);
      const zone = firstBoss?.zone || 'Unknown';
      saveAnnounce(announceId, {
        targets, zone, plannedTimeStr,
        threadId: channel.id,
        channelId: null, eventId: null, organizer: null,
        plannedTimeMs: Date.now(), easterEggLevel: 0,
      });
      console.log(`[announce] Restored announce ${announceId} from thread ${channel.id} (${targets.length} targets)`);
      return { messageId: announceId, targets, zone, plannedTimeStr, threadId: channel.id, easterEggLevel: 0 };
    }
  } catch (err) { console.warn('[announce] restoreAnnounceFromThread:', err?.message); }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addtarget')
    .setDescription('Add a boss to the raid target list. Run inside the announce thread.')
    .addStringOption(opt => opt.setName('boss').setDescription('Boss to add').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      bosses
        .filter(b => !isPopLocked(b) && (b.name.toLowerCase().includes(focused) || (b.nicknames || []).some(n => n.includes(focused))))
        .slice(0, 25)
        .map(b => ({ name: `${b.emoji || ''} ${b.name} (${b.zone})`, value: b.id }))
    );
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const bosses = getBosses();
    const bossId = interaction.options.getString('boss');
    const boss   = bosses.find(b => b.id === bossId);
    if (!boss)             return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });
    if (isPopLocked(boss)) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '🔒 PoP bosses are not available until October 1, 2026.' });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let announce = getAnnounceByThreadId(interaction.channel.id);
    if (!announce) {
      announce = await restoreAnnounceFromThread(interaction.channel, bosses);
      if (!announce)
        return interaction.editReply('❌ This command must be run inside a raid announce thread. Could not find announce state for this thread.');
    }

    const targets = [...(announce.targets || [])];
    if (targets.includes(bossId))
      return interaction.editReply(`**${boss.name}** is already a target.`);

    targets.push(bossId);
    updateAnnounceTargets(announce.messageId, targets);

    const freshAnnounce = { ...getAnnounce(announce.messageId), messageId: announce.messageId };
    await refreshControlPanel(interaction.channel, freshAnnounce, bosses);

    try {
      const msgs = await interaction.channel.messages.fetch({ limit: 50 });
      const alreadyPosted = msgs.some(m => m.embeds[0]?.title?.includes(boss.name));
      if (!alreadyPosted && boss.pqdiUrl) {
        const https    = require('https');
        const fetchUrl = url => new Promise((resolve, reject) => {
          https.get(url, { headers: { 'User-Agent': 'QuarmRaidBot/1.0' } }, res => {
            let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve(d));
          }).on('error', reject);
        });
        const { EmbedBuilder } = require('discord.js');
        const html  = await fetchUrl(boss.pqdiUrl);
        const scrapeFn = require('./announce').scrapePqdiDetails || (() => []);
        const details = scrapeFn(html);
        const embed = new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle(`${boss.emoji || '⚔️'} ${boss.name}`)
          .setURL(boss.pqdiUrl)
          .setDescription(`**Zone:** ${boss.zone}\n[Full PQDI listing](${boss.pqdiUrl})`);
        if (details.length) embed.addFields(details.slice(0, 25));
        await interaction.channel.send({ embeds: [embed] });
      }
    } catch { /* non-critical */ }

    await interaction.editReply(`✅ **${boss.name}** added as a target.`);
  },
};
