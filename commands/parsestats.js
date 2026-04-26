// commands/parsestats.js — Aggregate DPS scoreboard across all stored parses for a boss.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadParses } = require('./parse');

function fmt(n) { return n.toLocaleString('en-US'); }

function buildScoreboardEmbed(bossName, bossEmoji, entries, parseCount) {
  // entries: sorted array of { name, hasPets, appearances, avgDps, avgDamage, bestDps, survivalRate }
  const rows = entries.slice(0, 15).map((p, i) => {
    const rank     = String(i + 1).padStart(2);
    const name     = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
    const avgDps   = (fmt(p.avgDps) + '/s').padStart(8);
    const best     = (fmt(p.bestDps) + '/s').padStart(8);
    const seen     = String(p.appearances).padStart(2) + 'x';
    return `${rank}. ${name} ${avgDps}  best ${best}  ${seen}`;
  });

  const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Avg DPS'.padStart(8)}  ${'Best'.padStart(13)}  Seen`;
  const divider = '─'.repeat(hdr.length);
  const table   = [hdr, divider, ...rows].join('\n');

  // Flag top 3 consistent performers as Feral Avatar candidates
  const faTargets = entries
    .filter(p => p.appearances >= Math.ceil(parseCount / 2))
    .slice(0, 3)
    .map(p => `**${p.name}**`)
    .join(', ');

  const title = ['📈', bossEmoji, bossName, '— DPS Scoreboard'].filter(Boolean).join(' ');
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(title)
    .setDescription(`Across **${parseCount}** logged kill${parseCount !== 1 ? 's' : ''}`)
    .addFields({ name: 'Top DPS', value: '```\n' + table + '\n```', inline: false });

  if (faTargets) {
    embed.addFields({
      name: '🐾 Feral Avatar Candidates',
      value: `${faTargets} — consistent top performers present in ≥50% of kills`,
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsestats')
    .setDescription('Show aggregate DPS scoreboard for a boss across all logged parses.')
    .addStringOption(opt =>
      opt.setName('boss').setDescription('Boss to show stats for').setRequired(true).setAutocomplete(true)
    )
    .addIntegerOption(opt =>
      opt.setName('last').setDescription('Only include the N most recent kills (default: all)').setRequired(false).setMinValue(1).setMaxValue(50)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');

    // Only show bosses that have at least one parse stored
    const parses = loadParses();
    const hasParse = new Set(Object.keys(parses));

    const matches = bosses
      .filter(b =>
        hasParse.has(b.id) &&
        (b.name.toLowerCase().includes(focused) ||
         (b.nicknames || []).some(n => n.toLowerCase().includes(focused)))
      )
      .slice(0, 25)
      .map(b => ({ name: b.name, value: b.id }));

    // Fall back to all bosses if no parses exist yet
    if (matches.length === 0) {
      const all = bosses
        .filter(b =>
          b.name.toLowerCase().includes(focused) ||
          (b.nicknames || []).some(n => n.toLowerCase().includes(focused))
        )
        .slice(0, 25)
        .map(b => ({ name: b.name, value: b.id }));
      return interaction.respond(all);
    }

    await interaction.respond(matches);
  },

  async execute(interaction) {
    const bossId = interaction.options.getString('boss');
    const last   = interaction.options.getInteger('last') || null;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    const allParses = loadParses();
    let killList    = allParses[bossId] || [];

    if (killList.length === 0) {
      return interaction.editReply(`❌ No parses stored for **${boss?.name || bossId}** yet. Use \`/parse\` after a kill.`);
    }

    // Sort by timestamp, optionally slice to last N
    killList = [...killList].sort((a, b) => a.timestamp - b.timestamp);
    if (last) killList = killList.slice(-last);

    const parseCount = killList.length;

    // Aggregate per player
    const players = new Map(); // name → { appearances, totalDps, bestDps, hasPets, totalDamage, totalDuration, fightDurations }
    for (const kill of killList) {
      for (const p of kill.players) {
        const key = p.name.toLowerCase();
        if (!players.has(key)) {
          players.set(key, {
            name: p.name, hasPets: p.hasPets,
            appearances: 0, totalDps: 0, bestDps: 0,
            totalDamage: 0, totalDuration: 0,
            fightDurations: [],
          });
        }
        const agg = players.get(key);
        agg.appearances++;
        agg.totalDps    += p.dps;
        agg.bestDps      = Math.max(agg.bestDps, p.dps);
        agg.totalDamage += p.damage;
        agg.totalDuration += p.duration;
        agg.hasPets      = agg.hasPets || p.hasPets;
        agg.fightDurations.push({ playerDur: p.duration, fightDur: kill.duration });
      }
    }

    const entries = [...players.values()]
      .map(p => ({
        ...p,
        avgDps:    Math.round(p.totalDps / p.appearances),
        avgDamage: Math.round(p.totalDamage / p.appearances),
      }))
      .sort((a, b) => b.avgDps - a.avgDps);

    const bossName = boss?.name || bossId;
    const embed    = buildScoreboardEmbed(bossName, boss?.emoji, entries, parseCount);

    // Note if filtered
    if (last && allParses[bossId]?.length > last) {
      embed.setFooter({ text: `Showing last ${last} of ${allParses[bossId].length} logged kills` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
