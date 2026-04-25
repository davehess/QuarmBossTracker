// commands/addtarget.js — Add a boss target to an existing announce event.
// Must be run inside the announce thread.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const {
  getAnnounceByThreadId, updateAnnounceTargets, getAnnounce,
} = require('../utils/state');
const {
  buildControlPanelEmbed, buildTargetButtons, buildCancelRow, EASTER_EGG_CHAIN,
} = require('./announce');

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
    const targetRows = buildTargetButtons(announceData.targets, bosses);
    const cancelRow  = buildCancelRow(announceData.messageId);
    await cp.edit({ embeds: [cpEmbed], components: [...targetRows, cancelRow] });
  } catch (err) { console.warn('addtarget: could not refresh panel:', err?.message); }
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
        .filter(b => b.name.toLowerCase().includes(focused) || (b.nicknames || []).some(n => n.includes(focused)))
        .slice(0, 25)
        .map(b => ({ name: `${b.emoji || ''} ${b.name} (${b.zone})`, value: b.id }))
    );
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const announce = getAnnounceByThreadId(interaction.channel.id);
    if (!announce)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This command must be used inside a raid announce thread.' });

    const bosses = getBosses();
    const bossId = interaction.options.getString('boss');
    const boss   = bosses.find(b => b.id === bossId);
    if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

    const targets = [...(announce.targets || [])];
    if (targets.includes(bossId))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `**${boss.name}** is already a target.` });

    targets.push(bossId);
    updateAnnounceTargets(announce.messageId, targets);

    const freshAnnounce = { ...getAnnounce(announce.messageId), messageId: announce.messageId };
    await refreshControlPanel(interaction.channel, freshAnnounce, bosses);

    // Post boss info card if not already present
    try {
      const msgs = await interaction.channel.messages.fetch({ limit: 50 });
      const alreadyPosted = msgs.some(m => m.embeds[0]?.title?.includes(boss.name));
      if (!alreadyPosted && boss.pqdiUrl) {
        const https   = require('https');
        const fetchUrl = url => new Promise((resolve, reject) => {
          https.get(url, { headers: { 'User-Agent': 'QuarmRaidBot/1.0' } }, res => {
            let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve(d));
          }).on('error', reject);
        });
        const { EmbedBuilder } = require('discord.js');
        const html    = await fetchUrl(boss.pqdiUrl);
        const { buildControlPanelEmbed: _unused, ...announceModule } = require('./announce');
        const scrapeFn = require('./announce').scrapePqdiDetails || (() => []);
        const embed   = new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle(`${boss.emoji || '⚔️'} ${boss.name}`)
          .setURL(boss.pqdiUrl)
          .setDescription(`**Zone:** ${boss.zone}\n[Full PQDI listing](${boss.pqdiUrl})`);
        await interaction.channel.send({ embeds: [embed] });
      }
    } catch { /* non-critical */ }

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ **${boss.name}** added as a target.` });
  },
};
