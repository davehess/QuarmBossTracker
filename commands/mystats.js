// commands/mystats.js — Per-character and per-family parse stats.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getAllNames, getCharacter, getFamily } = require('../utils/roster');
const { loadParses, groupKillsBySession, mergeKillGroup } = require('./parse');

function fmt(n) { return n.toLocaleString('en-US'); }

function gatherCharacterStats(charName, allParses, bosses) {
  const key    = charName.toLowerCase();
  const result = { kills: 0, totalDamage: 0, totalDps: 0, peakDps: 0, bossByBoss: [] };

  for (const [bossId, rawKills] of Object.entries(allParses)) {
    const boss      = bosses.find(b => b.id === bossId);
    const windowMs  = (boss?.timerHours || 24) * 3600 * 1000;
    const sorted    = [...rawKills].sort((a, b) => a.timestamp - b.timestamp);
    const killList  = groupKillsBySession(sorted, windowMs).map(mergeKillGroup);

    const bossKills = [];
    for (const kill of killList) {
      const p = kill.players.find(pl => pl.name.toLowerCase() === key);
      if (!p) continue;
      bossKills.push({ damage: p.damage, dps: p.dps, hasPets: p.hasPets });
      result.kills++;
      result.totalDamage += p.damage;
      result.totalDps    += p.dps;
      result.peakDps      = Math.max(result.peakDps, p.dps);
    }
    if (bossKills.length > 0) {
      const avgDmg = Math.round(bossKills.reduce((s, k) => s + k.damage, 0) / bossKills.length);
      const avgDps = Math.round(bossKills.reduce((s, k) => s + k.dps, 0) / bossKills.length);
      const bestDps = Math.max(...bossKills.map(k => k.dps));
      result.bossByBoss.push({
        name: boss?.name || bossId,
        emoji: boss?.emoji || '⚔️',
        kills: bossKills.length,
        avgDmg,
        avgDps,
        bestDps,
      });
    }
  }

  result.avgDps = result.kills > 0 ? Math.round(result.totalDps / result.kills) : 0;
  result.bossByBoss.sort((a, b) => b.avgDmg - a.avgDmg);
  return result;
}

function buildStatsEmbed(title, chars, allParses, bosses) {
  const charList = Array.isArray(chars) ? chars : [chars];

  // Merge stats across all chars in the family
  const merged = { kills: 0, totalDamage: 0, totalDps: 0, peakDps: 0, bossMap: new Map() };

  for (const charName of charList) {
    const s = gatherCharacterStats(charName, allParses, bosses);
    merged.kills       += s.kills;
    merged.totalDamage += s.totalDamage;
    merged.totalDps    += s.totalDps;
    merged.peakDps      = Math.max(merged.peakDps, s.peakDps);
    for (const b of s.bossByBoss) {
      if (!merged.bossMap.has(b.name)) {
        merged.bossMap.set(b.name, { ...b, allAvgDps: [], allAvgDmg: [] });
      }
      const entry = merged.bossMap.get(b.name);
      entry.kills   += b.kills;
      entry.bestDps  = Math.max(entry.bestDps, b.bestDps);
      entry.allAvgDps.push(b.avgDps);
      entry.allAvgDmg.push(b.avgDmg);
    }
  }

  if (merged.kills === 0) {
    return new EmbedBuilder()
      .setColor(0x99aab5)
      .setTitle(title)
      .setDescription('No parse data found for this character.');
  }

  const avgDps = merged.kills > 0 ? Math.round(merged.totalDps / merged.kills) : 0;

  // Build per-boss table (top 10)
  const bossLines = [...merged.bossMap.values()]
    .map(b => ({
      ...b,
      avgDps: Math.round(b.allAvgDps.reduce((s, v) => s + v, 0) / b.allAvgDps.length),
      avgDmg: Math.round(b.allAvgDmg.reduce((s, v) => s + v, 0) / b.allAvgDmg.length),
    }))
    .sort((a, b) => b.avgDmg - a.avgDmg)
    .slice(0, 10);

  const rows = bossLines.map(b => {
    const name = (b.emoji + ' ' + b.name).slice(0, 22).padEnd(22);
    const dmg  = fmt(b.avgDmg).padStart(9);
    const dps  = (fmt(b.avgDps) + '/s').padStart(8);
    const best = (fmt(b.bestDps) + '/s').padStart(8);
    const k    = String(b.kills) + 'x';
    return `${name} ${dmg} ${dps} ${best} ${k}`;
  });
  const hdr     = `${'Boss'.padEnd(22)} ${'AvgDmg'.padStart(9)} ${'AvgDPS'.padStart(8)} ${'BestDPS'.padStart(8)} Kills`;
  const divider = '─'.repeat(hdr.length);
  const table   = '```\n' + [hdr, divider, ...rows].join('\n') + '\n```';

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(title)
    .setDescription(
      `**${merged.kills}** kills tracked · Avg DPS: **${fmt(avgDps)}/s** · Peak DPS: **${fmt(merged.peakDps)}/s**`
    )
    .addFields({ name: `Top Bosses by Avg Damage (${bossLines.length})`, value: table, inline: false });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mystats')
    .setDescription('View parse stats for a single character. (Only you see the result)')
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Character name')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase();
    const names    = getAllNames();
    const matches  = names.filter(n => n.includes(focused)).sort().slice(0, 25);
    const allParses = loadParses();
    // Prioritize chars that appear in parses
    matches.sort((a, b) => {
      const aHas = Object.values(allParses).some(kills =>
        kills.some(k => k.players?.some(p => p.name.toLowerCase() === a))
      );
      const bHas = Object.values(allParses).some(kills =>
        kills.some(k => k.players?.some(p => p.name.toLowerCase() === b))
      );
      return (bHas ? 1 : 0) - (aHas ? 1 : 0);
    });
    await interaction.respond(
      matches.map(n => {
        const c = getCharacter(n);
        const label = c ? `${c.name} (${c.race} ${c.class}${c.isAlt ? ` · Alt` : ''})` : n;
        return { name: label.slice(0, 100), value: c?.name || n };
      })
    );
  },

  async execute(interaction) {
    const name = interaction.options.getString('character');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses    = require('../data/bosses.json');
    const allParses = loadParses();

    const char = getCharacter(name);
    const displayName = char?.name || name;
    const classInfo   = char ? ` (${char.race} ${char.class})` : '';

    const embed = buildStatsEmbed(`📈 ${displayName}${classInfo} — Parse Stats`, [displayName], allParses, bosses);
    await interaction.editReply({ embeds: [embed] });
  },

  // Exported for /mystatsall reuse
  buildStatsEmbed,
  gatherCharacterStats,
};
