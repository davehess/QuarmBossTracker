// commands/rosterimport.js — Import the OpenDKP roster JSON export.
// Accepts a file attachment (.json). Strips all fields except name/race/class,
// groups alts under their main, and saves to the roster threads.

const https = require('https');
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole } = require('../utils/roles');
const {
  processOpenDkpExport, saveRosterToThread, loadRosterFromDiscord,
  ACTIVE_TITLE, INACTIVE_TITLE, ACTIVE_DATA_TITLE, INACTIVE_DATA_TITLE,
} = require('../utils/roster');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'QuarmRaidBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rosterimport')
    .setDescription('Import the OpenDKP roster JSON export to update the character database. (Officers only)')
    .addAttachmentOption(opt =>
      opt.setName('file')
        .setDescription('Upload the OpenDKP JSON export file (.json)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Officers only.' });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const attachment = interaction.options.getAttachment('file');
    if (!attachment.contentType?.includes('json') && !attachment.name?.endsWith('.json')) {
      return interaction.editReply('❌ Please upload a `.json` file exported from OpenDKP.');
    }

    let rawText;
    try {
      rawText = await fetchUrl(attachment.url);
    } catch (err) {
      return interaction.editReply(`❌ Could not download the file: ${err?.message}`);
    }

    let rawArray;
    try {
      rawArray = JSON.parse(rawText);
      if (!Array.isArray(rawArray)) rawArray = [rawArray];
    } catch {
      return interaction.editReply('❌ Could not parse the file as JSON. Make sure it is the raw OpenDKP character export.');
    }

    const { active, inactive } = processOpenDkpExport(rawArray);

    if (active.length === 0 && inactive.length === 0) {
      return interaction.editReply('❌ No characters found in the export. Verify the file is the OpenDKP character list.');
    }

    const activeId   = process.env.ROSTER_ACTIVE_THREAD_ID;
    const inactiveId = process.env.ROSTER_INACTIVE_THREAD_ID;

    if (!activeId && !inactiveId) {
      return interaction.editReply('❌ `ROSTER_ACTIVE_THREAD_ID` and/or `ROSTER_INACTIVE_THREAD_ID` are not set in environment variables.');
    }

    const importerName = interaction.member?.displayName || interaction.user.username;
    const importedAt   = new Date();

    await saveRosterToThread(interaction.client, active,   activeId,   ACTIVE_TITLE,   ACTIVE_DATA_TITLE,   importerName, importedAt);
    await saveRosterToThread(interaction.client, inactive, inactiveId, INACTIVE_TITLE, INACTIVE_DATA_TITLE, importerName, importedAt);

    // Reload in-memory lookup
    await loadRosterFromDiscord(interaction.client);

    const activeAlts   = active.reduce((s, m) => s + (m.a?.length || 0), 0);
    const inactiveAlts = inactive.reduce((s, m) => s + (m.a?.length || 0), 0);

    await interaction.editReply(
      `✅ Roster imported from \`${attachment.name}\`\n` +
      `**Active:** ${active.length} mains · ${activeAlts} alts\n` +
      `**Inactive:** ${inactive.length} mains · ${inactiveAlts} alts`
    );
  },
};
