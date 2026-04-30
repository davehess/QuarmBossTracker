// commands/removeboss.js
// /removeboss <boss name or PQDI URL> — Remove a boss from bosses.json and refresh the board.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const BOSSES_FILE = path.join(__dirname, '../data/bosses.json');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

// Build autocomplete list dynamically
function getBossChoices() {
  const bosses = getBosses();
  return bosses.map((b) => ({
    name: `${b.name} (${b.zone} — ${b.expansion})`,
    value: b.id,
    terms: [b.name.toLowerCase(), b.id, ...(b.nicknames || []).map(n => n.toLowerCase())],
  }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeboss')
    .setDescription('Remove a boss from the tracker and refresh the board')
    .addStringOption(opt =>
      opt.setName('boss')
        .setDescription('Boss name (autocomplete) or PQDI.cc URL')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase().trim();
    const choices  = getBossChoices();
    const filtered = choices
      .filter(c => !focused || c.terms.some(t => t.includes(focused)) || c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(({ name, value }) => ({ name, value }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const input  = interaction.options.getString('boss').trim();
    const bosses = getBosses();

    // Match by ID (from autocomplete), PQDI URL, or name
    let bossIdx = -1;
    if (input.startsWith('https://www.pqdi.cc/npc/')) {
      bossIdx = bosses.findIndex(b => b.pqdiUrl === input);
    } else {
      // Try exact ID match first (autocomplete), then name
      bossIdx = bosses.findIndex(b => b.id === input);
      if (bossIdx === -1) {
        const lower = input.toLowerCase();
        bossIdx = bosses.findIndex(b =>
          b.name.toLowerCase() === lower ||
          b.id === lower ||
          (b.nicknames || []).some(n => n.toLowerCase() === lower)
        );
      }
    }

    if (bossIdx === -1) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Could not find a boss matching \`${input}\`.\nUse the autocomplete dropdown or provide an exact PQDI URL.`,
      });
    }

    const boss = bosses[bossIdx];

    // Also clear their kill state
    try {
      const { clearKill, getBossState } = require('../utils/state');
      if (getBossState(boss.id)) clearKill(boss.id);
    } catch (_) {}

    // Remove from array
    bosses.splice(bossIdx, 1);
    fs.writeFileSync(BOSSES_FILE, JSON.stringify(bosses, null, 2), 'utf8');
    delete require.cache[require.resolve('../data/bosses.json')];

    const embed = new EmbedBuilder()
      .setColor(0x888888)
      .setTitle('🗑️ Boss removed from tracker')
      .setDescription(`**${boss.name}** (${boss.zone} — ${boss.expansion})\nRemoved by <@${interaction.user.id}>`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    // Refresh board for the boss's expansion
    try {
      const { postOrUpdateExpansionBoard } = require('../utils/killops');
      const { getThreadId } = require('../utils/config');
      const freshBosses = require('../data/bosses.json');
      const threadId = getThreadId(boss.expansion);
      if (threadId) {
        await postOrUpdateExpansionBoard(interaction.client, boss.expansion, threadId, freshBosses);
      }
    } catch (err) {
      console.warn('removeboss board refresh failed:', err?.message);
    }

    // Post bosses.json to BOSS_OUTPUT_CHANNEL_ID if configured
    if (process.env.BOSS_OUTPUT_CHANNEL_ID) {
      try {
        const freshBosses = require('../data/bosses.json');
        const outputCh = await interaction.client.channels.fetch(process.env.BOSS_OUTPUT_CHANNEL_ID);
        const buf = Buffer.from(fs.readFileSync(BOSSES_FILE, 'utf8'), 'utf8');
        const att = new AttachmentBuilder(buf, { name: 'bosses.json' });
        await outputCh.send({ content: `📋 bosses.json updated — ${freshBosses.length} bosses`, files: [att] });
      } catch {}
    }
  },
};
