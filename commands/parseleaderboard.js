// commands/parseleaderboard.js — Post/update a pinned leaderboard in the parse log thread.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadParses } = require('./parse');
const { getParseLeaderboardMsgId, setParseLeaderboardMsgId } = require('../utils/state');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

function fmt(n) { return n.toLocaleString('en-US'); }

function buildLeaderboardEmbed(allParses) {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');

  // Count unique parses submitted per user (by submittedBy userId)
  const submitters = new Map(); // userId → { name, count, bosses: Set }
  let totalParses = 0;
  let totalKills  = 0;
  const bossKillCount = new Map(); // bossId → kill count

  for (const [bossId, kills] of Object.entries(allParses)) {
    totalParses += kills.length;
    const { groupKillsBySession } = require('./parse');
    const boss     = bosses.find(b => b.id === bossId);
    const windowMs = (boss?.timerHours || 24) * 3600 * 1000;
    const sorted   = [...kills].sort((a, b) => a.timestamp - b.timestamp);
    const groups   = groupKillsBySession(sorted, windowMs);
    totalKills += groups.length;
    bossKillCount.set(bossId, groups.length);

    for (const k of kills) {
      if (!k.submittedBy) continue;
      if (!submitters.has(k.submittedBy)) {
        submitters.set(k.submittedBy, { name: k.submittedByName || 'Unknown', count: 0, bossSet: new Set() });
      }
      const sub = submitters.get(k.submittedBy);
      sub.count++;
      sub.bossSet.add(bossId);
      if (k.submittedByName) sub.name = k.submittedByName;
    }
  }

  const sorted = [...submitters.entries()]
    .map(([uid, s]) => ({ uid, name: s.name, count: s.count, bosses: s.bossSet.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  let table = '*No parse submissions yet.*';
  if (sorted.length > 0) {
    const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Parses'.padStart(7)}  ${'Bosses'.padStart(7)}`;
    const divider = '─'.repeat(hdr.length);
    const rows = sorted.map((s, i) => {
      const rank = String(i + 1).padStart(2);
      const name = s.name.padEnd(20).slice(0, 20);
      const ct   = String(s.count).padStart(7);
      const bc   = String(s.bosses).padStart(7);
      return `${rank}. ${name} ${ct}  ${bc}`;
    });
    table = '```\n' + [hdr, divider, ...rows].join('\n') + '\n```';
  }

  // Boss coverage block
  const bossCoverage = [...bossKillCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, ct]) => {
      const b = bosses.find(b => b.id === id);
      return `${b?.emoji || '⚔️'} **${b?.name || id}** — ${ct} kill${ct !== 1 ? 's' : ''}`;
    })
    .join('\n') || '*No data*';

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🏆 Parse Leaderboard')
    .setDescription(`**${totalParses}** parse submissions · **${totalKills}** tracked kills · **${submitters.size}** contributors`)
    .addFields(
      { name: 'Top Submitters', value: table, inline: false },
      { name: 'Most Killed Bosses', value: bossCoverage, inline: false },
    )
    .setTimestamp()
    .setFooter({ text: 'Updated each time /parseleaderboard is run' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parseleaderboard')
    .setDescription('Post or update the pinned parse leaderboard in the parse log thread.'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const logThreadId = process.env.PARSES_LOG_THREAD_ID;
    if (!logThreadId) {
      return interaction.editReply('❌ `PARSES_LOG_THREAD_ID` env var not set.');
    }

    const allParses = loadParses();
    const embed     = buildLeaderboardEmbed(allParses);

    const thread = await interaction.client.channels.fetch(logThreadId).catch(() => null);
    if (!thread) {
      return interaction.editReply('❌ Could not fetch parse log thread.');
    }

    const existingId = getParseLeaderboardMsgId();
    let msg;
    if (existingId) {
      try {
        msg = await thread.messages.fetch(existingId);
        await msg.edit({ embeds: [embed] });
        return interaction.editReply('✅ Parse leaderboard updated.');
      } catch {
        // Message gone — post fresh
      }
    }

    msg = await thread.send({ embeds: [embed] });
    setParseLeaderboardMsgId(msg.id);
    try { await msg.pin(); } catch { /* non-critical */ }
    await interaction.editReply('✅ Parse leaderboard posted and pinned.');
  },

  buildLeaderboardEmbed,
};
