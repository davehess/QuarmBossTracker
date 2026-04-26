// commands/raidstats.js — Full-night aggregate DPS scoreboard across all kills in a session.
// Excludes Eye of <Player> mobs — those are AoE test dummies and inflate numbers.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadParses } = require('./parse');
const { isEyeMob } = require('./parsestats');
const { getTonightParses, todayLabel, isRaidNight } = require('./raidnight');
const { msUntilMidnightInTz, getDefaultTz } = require('../utils/timezone');

function fmt(n) { return n.toLocaleString('en-US'); }

function sinceLastMidnightMs() {
  const msUntilMidnight = msUntilMidnightInTz(getDefaultTz());
  return Date.now() - (24 * 60 * 60 * 1000 - msUntilMidnight);
}

function buildNightScoreboardEmbed(label, raidNight, playerMap, mobCount, totalDmg) {
  const entries = [...playerMap.values()]
    .map(p => ({ ...p, avgDps: p.totalDuration > 0 ? Math.round(p.totalDamage / p.totalDuration) : 0 }))
    .sort((a, b) => b.totalDamage - a.totalDamage);

  if (entries.length === 0) {
    return new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle((raidNight ? '🗡️ ' : '⚔️ ') + label + ' — Full Night DPS')
      .setDescription('*No parses logged yet.*');
  }

  const rows = entries.slice(0, 20).map((p, i) => {
    const rank   = String(i + 1).padStart(2);
    const name   = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
    const dmg    = fmt(p.totalDamage).padStart(8);
    const dps    = (p.avgDps + '/s').padStart(7);
    const mobs   = String(p.mobCount).padStart(2) + ' mobs';
    return `${rank}. ${name} ${dmg}  ${dps}  ${mobs}`;
  });

  const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Damage'.padStart(8)}  ${'Avg DPS'.padStart(7)}  Fights`;
  const divider = '─'.repeat(hdr.length);
  const table   = [hdr, divider, ...rows].join('\n');

  const title = (raidNight ? '🗡️ ' : '⚔️ ') + label + ' — Full Night DPS';
  return new EmbedBuilder()
    .setColor(raidNight ? 0xe74c3c : 0x95a5a6)
    .setTitle(title)
    .setDescription(`**${mobCount}** boss${mobCount !== 1 ? 'es' : ''} parsed · **${fmt(totalDmg)}** total damage`)
    .addFields({ name: 'Rankings', value: '```\n' + table + '\n```', inline: false })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidstats')
    .setDescription('Full-night DPS scoreboard across all kills logged tonight.')
    .addBooleanOption(opt =>
      opt.setName('public').setDescription('Post visibly to channel instead of ephemeral (default: ephemeral)').setRequired(false)
    ),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('public') ?? false;
    await interaction.deferReply({ flags: isPublic ? undefined : 0x40 });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');

    const tonightParses = getTonightParses();
    const label         = todayLabel();
    const raidNight     = isRaidNight();

    // Aggregate damage per player across all non-Eye bosses parsed tonight
    const playerMap = new Map();
    let mobCount  = 0;
    let totalDmg  = 0;

    for (const [bossId, kills] of Object.entries(tonightParses)) {
      if (isEyeMob(bossId, bosses)) continue;
      mobCount++;

      // Use the most recent parse for this boss tonight
      const kill = kills[kills.length - 1];
      totalDmg += kill.totalDamage;

      for (const p of kill.players) {
        const key = p.name.toLowerCase();
        if (!playerMap.has(key)) {
          playerMap.set(key, { name: p.name, hasPets: p.hasPets, totalDamage: 0, totalDuration: 0, mobCount: 0, bestDps: 0 });
        }
        const agg = playerMap.get(key);
        agg.totalDamage  += p.damage;
        agg.totalDuration += p.duration;
        agg.mobCount++;
        agg.hasPets = agg.hasPets || p.hasPets;
        agg.bestDps  = Math.max(agg.bestDps, p.dps);
      }
    }

    const embed = buildNightScoreboardEmbed(label, raidNight, playerMap, mobCount, totalDmg);

    if (isPublic) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.editReply({ embeds: [embed], flags: 0x40 });
    }
  },

  buildNightScoreboardEmbed,
};
