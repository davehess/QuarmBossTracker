// commands/parsestats.js — Aggregate DPS scoreboard across all stored parses for a boss.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadParses } = require('./parse');

// "Eye of <Player>" mobs are Mage-summoned dummies used for AoE damage testing.
// Damage against them inflates numbers and must never appear on scoreboards.
function isEyeMob(bossId, bosses) {
  const boss = bosses.find(b => b.id === bossId);
  const name = (boss?.name || bossId).replace(/_/g, ' ').toLowerCase();
  return name.includes('eye of ');
}

/**
 * Group kill submissions by session: submissions within 30 minutes of each other
 * are treated as multiple people logging the same fight.
 */
function groupKillsBySession(killList, windowMs = 30 * 60 * 1000) {
  const sorted = [...killList].sort((a, b) => a.timestamp - b.timestamp);
  const groups = [];
  for (const kill of sorted) {
    const last = groups[groups.length - 1];
    if (last && kill.timestamp - last[0].timestamp <= windowMs) {
      last.push(kill);
    } else {
      groups.push([kill]);
    }
  }
  return groups;
}

/**
 * Merge a session group into a single canonical kill.
 * For each player, take the submission with the highest damage.
 * DPS is recalculated from damage / player's own duration.
 */
function mergeKillGroup(group) {
  const canonical = group.reduce((best, k) => k.totalDamage > best.totalDamage ? k : best, group[0]);
  const playerMap = new Map();
  for (const kill of group) {
    for (const p of kill.players) {
      const key = p.name.toLowerCase();
      const existing = playerMap.get(key);
      if (!existing || p.damage > existing.damage) playerMap.set(key, { ...p });
    }
  }
  const players = [...playerMap.values()].map(p => ({
    ...p,
    dps: p.duration > 0 ? Math.round(p.damage / p.duration) : p.dps,
  }));
  return { timestamp: canonical.timestamp, duration: canonical.duration, totalDamage: canonical.totalDamage, players };
}


function fmt(n) { return n.toLocaleString('en-US'); }

function buildScoreboardEmbed(bossName, bossEmoji, entries, killCount) {
  const isSingle = killCount === 1;

  // Single kill: rank by damage. Historical: rank by avg DPS.
  const sorted = isSingle
    ? [...entries].sort((a, b) => b.avgDamage - a.avgDamage)
    : [...entries].sort((a, b) => b.avgDps - a.avgDps);

  let rows, hdr;
  if (isSingle) {
    rows = sorted.slice(0, 15).map((p, i) => {
      const rank = String(i + 1).padStart(2);
      const name = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
      const dmg  = fmt(p.avgDamage).padStart(9);
      const dps  = (fmt(p.avgDps) + '/s').padStart(7);
      return `${rank}. ${name} ${dmg}  ${dps}`;
    });
    hdr = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Damage'.padStart(9)}  ${'DPS'.padStart(7)}`;
  } else {
    rows = sorted.slice(0, 15).map((p, i) => {
      const rank   = String(i + 1).padStart(2);
      const name   = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
      const avgDps = (fmt(p.avgDps) + '/s').padStart(7);
      const best   = (fmt(p.bestDps) + '/s').padStart(7);
      const dmg    = fmt(p.avgDamage).padStart(9);
      const seen   = String(p.appearances).padStart(2) + 'x';
      return `${rank}. ${name} ${avgDps}  ${best}  ${dmg}  ${seen}`;
    });
    hdr = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Avg DPS'.padStart(7)}  ${'Best'.padStart(7)}  ${'Avg Dmg'.padStart(9)}  Seen`;
  }

  const divider = '─'.repeat(hdr.length);
  const table   = [hdr, divider, ...rows].join('\n');

  const faTargets = sorted
    .filter(p => p.appearances >= Math.ceil(killCount / 2))
    .slice(0, 3)
    .map(p => `**${p.name}**`)
    .join(', ');

  const title = ['📈', bossEmoji, bossName, '— DPS Scoreboard'].filter(Boolean).join(' ');
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(title)
    .setDescription(`Across **${killCount}** logged kill${killCount !== 1 ? 's' : ''}`)
    .addFields({ name: 'Top DPS', value: '```\n' + table + '\n```', inline: false });

  if (faTargets && !isSingle) {
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

    await interaction.deferReply();

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');
    const boss   = bosses.find(b => b.id === bossId);

    if (isEyeMob(bossId, bosses)) {
      return interaction.editReply('❌ Eye of <Player> mobs are excluded from scoreboards.');
    }

    const allParses = loadParses();
    let rawKills = allParses[bossId] || [];

    if (rawKills.length === 0) {
      return interaction.editReply(`❌ No parses stored for **${boss?.name || bossId}** yet. Use \`/parse\` after a kill.`);
    }

    // Group submissions by session (30-min window), merge to max-damage per player
    rawKills = [...rawKills].sort((a, b) => a.timestamp - b.timestamp);
    if (last) rawKills = rawKills.slice(-last);
    const killList  = groupKillsBySession(rawKills).map(mergeKillGroup);
    const killCount = killList.length;

    // Aggregate per player across merged kills
    const players = new Map();
    for (const kill of killList) {
      for (const p of kill.players) {
        const key = p.name.toLowerCase();
        if (!players.has(key)) {
          players.set(key, { name: p.name, hasPets: p.hasPets, appearances: 0, totalDps: 0, bestDps: 0, totalDamage: 0 });
        }
        const agg = players.get(key);
        agg.appearances++;
        agg.totalDps    += p.dps;
        agg.bestDps      = Math.max(agg.bestDps, p.dps);
        agg.totalDamage += p.damage;
        agg.hasPets      = agg.hasPets || p.hasPets;
      }
    }

    const entries = [...players.values()]
      .map(p => ({
        ...p,
        avgDps:    Math.round(p.totalDps / p.appearances),
        avgDamage: Math.round(p.totalDamage / p.appearances),
      }));

    const bossName = boss?.name || bossId;
    const embed    = buildScoreboardEmbed(bossName, boss?.emoji, entries, killCount);

    if (last && allParses[bossId]?.length > last) {
      embed.setFooter({ text: `Showing last ${last} of ${allParses[bossId].length} logged kills` });
    }

    await interaction.editReply({ embeds: [embed] });
  },

  isEyeMob,
};
