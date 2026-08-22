// commands/lockoutcheck.js — pre-raid lockout briefing to officer chat.
//
// Hitya 2026-08-21: "put it into a post in officer chat about characters
// currently locked out for the upcoming night's raid by zone from the raid
// planner's event."
//
// A lockout is an ENGAGE lock (CLAUDE.md domain policies): the character can't
// fight the mob at all and is teleported out of the zone on engage. So this is
// a BEFORE-the-pull check — a locked raider who engages is a body that vanishes
// mid-fight — and it is answered against the planner's target list for tonight.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const { buildLockoutBriefing } = require('../utils/lockoutBriefing');
const { discordRelativeTime } = require('../utils/timer');

// Shared by the slash command and the automatic pre-raid post.
async function buildBriefingEmbed(client) {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');
  const { findBossFromName } = require('./parse');
  const { loadTonightsTargets } = require('../utils/raidhelper');

  const planned = await loadTonightsTargets(client, bosses, findBossFromName).catch(() => null);
  if (!planned || !Array.isArray(planned.bossIds) || planned.bossIds.length === 0) {
    return { embed: null, reason: 'No targets found on tonight\'s raid-planner event.' };
  }

  const supabase = require('../utils/supabase');
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const nowIso = new Date().toISOString();
  // Paginated, not .limit() — a limit at/over 1000 silently truncates at
  // PostgREST's cap (test/db-read-discipline.test.js ratchets on this), and a
  // truncated briefing would quietly omit blocked raiders, which is the exact
  // failure this feature exists to prevent.
  const rows = await supabase.selectAllPaged('character_lockouts',
    `guild_id=eq.${encodeURIComponent(guildId)}&expires_at=gt.${encodeURIComponent(nowIso)}` +
    `&select=character,boss_key,expires_at,ours`, 'character').catch(() => null);
  const lockouts = Array.isArray(rows) ? rows : [];

  // main vs alt — a MAIN locked to tonight's target is the surprising case.
  const chars = await supabase.selectAllPaged('characters',
    `guild_id=eq.${encodeURIComponent(guildId)}&select=name,main_name`, 'name').catch(() => null);
  const kindByName = new Map();
  for (const c of (Array.isArray(chars) ? chars : [])) {
    if (!c || !c.name) continue;
    kindByName.set(String(c.name).toLowerCase(),
      (!c.main_name || String(c.main_name).toLowerCase() === String(c.name).toLowerCase()) ? 'main' : 'alt');
  }
  const kindOf = n => kindByName.get(String(n || '').toLowerCase()) || 'unknown';

  const b = buildLockoutBriefing({ targetBossIds: planned.bossIds, bosses, lockouts, kindOf });

  const embed = new EmbedBuilder()
    .setColor(b.total > 0 ? 0xf0883e : 0x1a7f37)
    .setTitle('🔒 Lockout check — tonight\'s targets')
    .setTimestamp();

  const header = [
    planned.eventTitle ? `**${planned.eventTitle}**` : null,
    b.total === 0
      ? '✅ Nobody is locked out of anything on tonight\'s list.'
      : `⚠️ **${b.total}** character${b.total === 1 ? '' : 's'} cannot engage tonight` +
        (b.mains ? ` — **${b.mains}** of them ${b.mains === 1 ? 'is a main' : 'are mains'}` : ''),
    'A lockout stops them **fighting** it, not just looting — they get teleported out of the zone on engage.',
  ].filter(Boolean).join('\n');
  embed.setDescription(header);

  for (const z of b.zones.slice(0, 12)) {
    const lines = z.bosses.map(bs => {
      const who = bs.chars.map(c =>
        c.kind === 'main' ? `**${c.name}** (main)` : c.name).join(', ');
      return `${bs.emoji ? bs.emoji + ' ' : ''}**${bs.bossName}** — ${who}`;
    });
    embed.addFields({
      name: `📍 ${z.zone} · ${z.count} blocked`,
      value: lines.join('\n').slice(0, 1024),
      inline: false,
    });
  }
  if (b.targetsWithNone.length) {
    embed.addFields({
      name: '✓ Clear',
      value: b.targetsWithNone.join(', ').slice(0, 1024),
      inline: false,
    });
  }
  if (planned.eventUrl) embed.addFields({ name: 'Planner', value: planned.eventUrl, inline: false });
  return { embed, reason: null, total: b.total };
}

async function postLockoutBriefing(client) {
  const supabase = require('../utils/supabase');
  const { getOfficerChannelId } = require('../utils/officerChannel');
  const chId = await getOfficerChannelId(supabase);
  if (!chId) {
    return { ok: false, reason: 'no officer channel configured — run `/preraid here:true` in the officer channel once' };
  }
  const { embed, reason } = await buildBriefingEmbed(client);
  if (!embed) return { ok: false, reason };
  const ch = await client.channels.fetch(chId).catch(() => null);
  if (!ch) return { ok: false, reason: 'officer channel not reachable' };
  await ch.send({ embeds: [embed] });
  return { ok: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockoutcheck')
    .setDescription('Post tonight\'s lockout briefing (by zone) to officer chat.'),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral,
        content: `❌ Officers only. Roles: ${officerRolesList()}` });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await postLockoutBriefing(interaction.client);
    return interaction.editReply(res.ok
      ? '✅ Posted the lockout briefing to officer chat.'
      : `❌ ${res.reason || 'could not post'}`);
  },

  buildBriefingEmbed,
  postLockoutBriefing,
};
