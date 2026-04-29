// commands/parsenight.js — End-of-night DPS summary using all parses stored tonight.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getTonightParses } = require('./raidnight');
const { groupKillsBySession, mergeKillGroup } = require('./parsestats');

function fmt(n) { return n.toLocaleString('en-US'); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parsenight')
    .setDescription('Show a full end-of-night DPS summary for tonight\'s raid.')
    .addBooleanOption(opt =>
      opt.setName('public')
        .setDescription('Post publicly (default: ephemeral)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('public') ?? false;

    if (!isPublic) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');

    const { getRaidSession } = require('../utils/state');
    const session = getRaidSession();
    const label   = session?.label || new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    const tonightParses = getTonightParses();
    const bossIds = Object.keys(tonightParses);

    if (bossIds.length === 0) {
      return interaction.editReply('❌ No parses recorded tonight. Use `/parse` after each kill.');
    }

    // Build per-boss sections and overall player totals
    const overallPlayerMap = new Map();
    let totalNightDamage = 0;
    let totalNightDuration = 0;
    const bossSections = [];

    for (const bossId of bossIds) {
      if (bossId === 'aoe_parse') continue; // AOE is separate
      const rawKills = tonightParses[bossId];
      if (!rawKills || rawKills.length === 0) continue;

      // Group and merge sessions for this boss
      const killList = groupKillsBySession(rawKills, 10 * 60 * 1000).map(mergeKillGroup);
      const merged   = killList[killList.length - 1]; // use most recent merged kill

      const boss = bosses.find(b => b.id === bossId);
      const bossName  = boss?.name || bossId;
      const bossEmoji = boss?.emoji || '⚔️';
      const bossRaidDps = merged.duration > 0 ? Math.round(merged.totalDamage / merged.duration) : 0;

      bossSections.push({
        bossName,
        bossEmoji,
        duration: merged.duration,
        totalDamage: merged.totalDamage,
        raidDps: bossRaidDps,
      });

      totalNightDamage   += merged.totalDamage;
      totalNightDuration += merged.duration;

      // Aggregate per player
      for (const p of (merged.players || [])) {
        const key = p.name.toLowerCase();
        if (!overallPlayerMap.has(key)) {
          overallPlayerMap.set(key, { name: p.name, hasPets: p.hasPets, totalDmg: 0, bosses: 0 });
        }
        const agg = overallPlayerMap.get(key);
        agg.totalDmg += p.damage;
        agg.bosses++;
        agg.hasPets = agg.hasPets || p.hasPets;
      }
    }

    const overallDps = totalNightDuration > 0 ? Math.round(totalNightDamage / totalNightDuration) : 0;

    // Build boss section string (up to 8)
    const bossLines = bossSections.slice(0, 8).map(b =>
      `${b.bossEmoji} **${b.bossName}** — Raid DPS: ${fmt(b.raidDps)}/s · ${b.duration}s`
    );

    // Build player rankings sorted by total damage
    const sortedPlayers = [...overallPlayerMap.values()]
      .sort((a, b) => b.totalDmg - a.totalDmg);

    const stars = ['🌟', '🌟', '🌟'];
    const playerRows = sortedPlayers.slice(0, 15).map((p, i) => {
      const prefix = i < 3 ? stars[i] + ' ' : `${String(i + 1).padStart(2)}. `;
      const name   = (p.name + (p.hasPets ? ' +P' : '')).padEnd(20);
      const dmg    = fmt(p.totalDmg).padStart(10);
      const bossCt = `${p.bosses}b`;
      return `${prefix}${name} ${dmg}  ${bossCt}`;
    });

    const hdr     = `${'  '}  ${'Player'.padEnd(20)} ${'Total Dmg'.padStart(10)}  Bosses`;
    const divider = '─'.repeat(hdr.length);
    const table   = [hdr, divider, ...playerRows].join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`⚔️ Full Night — ${label}`)
      .setDescription(
        `**${bossSections.length}** bosses · Total: **${fmt(totalNightDamage)}** dmg · Overall Raid DPS: **${fmt(overallDps)}/s**`
      );

    if (bossLines.length > 0) {
      embed.addFields({
        name: 'Bosses Parsed',
        value: bossLines.join('\n'),
        inline: false,
      });
    }

    if (sortedPlayers.length > 0) {
      embed.addFields({
        name: 'Overall Player Rankings (🌟 = top 3)',
        value: '```\n' + table + '\n```',
        inline: false,
      });
    }

    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
