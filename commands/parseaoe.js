// commands/parseaoe.js — Submit an EQLogParser AOE parse (boss name ignored).
// Contributes to a 5-minute rolling window, merged by max damage per player.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { parseEQLog, buildParseEmbed, postParseToAnnounceThreads } = require('./parse');

const AOE_WINDOW_MS = 5 * 60 * 1000;
let aoeWindow = []; // { timestamp, players }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parseaoe')
    .setDescription('Submit an AOE phase DPS parse (boss name ignored, merged into a 5-min rolling window).')
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the EQLogParser "Send to EQ" output')
        .setRequired(true)
        .setMaxLength(6000)
    ),

  async execute(interaction) {
    const rawData = interaction.options.getString('data');

    await interaction.deferReply();

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.editReply('❌ Could not parse that input. Paste the EQLogParser "Send to EQ" or "Combined (N):" output (e.g. "Combined (55): Boss in 162s, 737.8K Damage @4.55K, 1. Player = 231.20K@5.78K in 40s | ...")');
    }

    const now = Date.now();

    // Add to window and prune entries older than 5 minutes
    aoeWindow.push({ timestamp: now, players: parsed.players });
    aoeWindow = aoeWindow.filter(e => now - e.timestamp <= AOE_WINDOW_MS);

    // Merge by max damage per player across all entries in window
    const playerMap = new Map();
    for (const entry of aoeWindow) {
      for (const p of entry.players) {
        const key = p.name.toLowerCase();
        const existing = playerMap.get(key);
        if (!existing || p.damage > existing.damage) {
          playerMap.set(key, { ...p });
        }
      }
    }

    const mergedPlayers = [...playerMap.values()].sort((a, b) => b.damage - a.damage);

    // Build a merged parsed object for the embed
    const totalDamage = mergedPlayers.reduce((s, p) => s + p.damage, 0);
    const totalDps    = parsed.duration > 0 ? Math.round(totalDamage / parsed.duration) : parsed.totalDps;
    const mergedParsed = {
      bossName:    'AOE Phase',
      duration:    parsed.duration,
      totalDamage,
      totalDps,
      players:     mergedPlayers.map((p, i) => ({ ...p, rank: i + 1 })),
    };

    const embed = buildParseEmbed('AOE Phase', mergedParsed, '💥');
    embed.setFooter({ text: `Rolling 5-min window · ${aoeWindow.length} submission(s) merged` });

    await interaction.editReply({ embeds: [embed] });

    // Post to raid night thread if active
    try {
      const { appendParseToSession } = require('./raidnight');
      await appendParseToSession(interaction.client, 'aoe_parse', mergedParsed, 'AOE Phase', '💥');
    } catch {}

    // Post to any active announce/event threads (fire-and-forget)
    postParseToAnnounceThreads(interaction.client, embed).catch(() => {});
  },
};
