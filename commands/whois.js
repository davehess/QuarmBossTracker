// commands/whois.js — Look up what we know about a character.
//
// Combines two data sources:
//   1. OpenDKP roster (curated guild data)              ← getCharacter()
//   2. /who observations uploaded by wolfpack-logsync   ← getWhoEntry()
//
// Shows class, level, race, guild, Zek flag, and first/last-seen timestamps.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getWhoEntry } = require('../utils/state');
const { getCharacter } = require('../utils/roster');

function fmtIso(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `<t:${Math.floor(d.getTime() / 1000)}:R>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Show class, level, guild, and Zek flag for any character we have data on')
    .addStringOption(opt =>
      opt.setName('character').setDescription('Character name').setRequired(true)
    ),

  async execute(interaction) {
    const name = interaction.options.getString('character', true).trim();
    const who  = getWhoEntry(name);
    const char = getCharacter(name);

    if (!who && !char) {
      return interaction.reply({
        flags:   MessageFlags.Ephemeral,
        content: `❓ No data on **${name}** yet. They'll show up here after someone runs \`/who\` while the parser is active.`,
      });
    }

    const cls   = char?.class || who?.class || null;
    const level = char?.level || who?.level || null;
    const race  = who?.race   || null;
    const guild = char?.guild || who?.guild || null;
    const rank  = who?.guildRank || null;   // Member / Officer / Leader (from /guildstatus)
    const isZek = !!who?.is_zek;

    const lines = [];
    if (cls)   lines.push(`**Class:** ${cls}${level ? ` (level ${level})` : ''}`);
    if (race)  lines.push(`**Race:** ${race}`);
    if (guild) {
      // Surface the in-game guild rank when we've seen it. Leader gets a crown
      // + emphasis — "X is the leader of <Guild>" is the line that feeds this.
      if (rank === 'Leader')       lines.push(`👑 **Guild Leader** of \`<${guild}>\``);
      else if (rank === 'Officer') lines.push(`**Guild Officer** of \`<${guild}>\``);
      else                         lines.push(`**Guild:** \`<${guild}>\`${rank ? ` (${rank})` : ''}`);
    }
    if (isZek) lines.push(`⚠️ **Zek member** — flagged as PVP guild affiliated`);
    if (who?.anonymous) lines.push(`*(anonymous in last /who)*`);
    if (who?.gm)        lines.push(`👑 **GM**`);
    if (char) lines.push(`📋 In OpenDKP roster${char.isAlt ? ` (alt of ${char.mainName})` : ''}`);
    if (who?.firstSeen) lines.push(`First seen: ${fmtIso(who.firstSeen)}`);
    if (who?.lastSeen)  lines.push(`Last seen: ${fmtIso(who.lastSeen)}`);

    const embed = new EmbedBuilder()
      .setColor(isZek ? 0xcc0000 : (char ? 0x57f287 : 0x5865F2))
      .setTitle(`👤 ${who?.name || char?.name || name}`)
      .setDescription(lines.join('\n') || '*(no class/guild data yet)*')
      .setFooter({ text: 'Class data comes from OpenDKP roster + /who observations uploaded by the parser.' });

    return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
  },
};
