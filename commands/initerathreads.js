// commands/initerathreads.js — Bootstrap the per-era chat threads.
//
// Creates five threads inside each of GUILD_CHAT_CHANNEL_ID and RAID_CHAT_CHANNEL_ID
// (one per Quarm era), then replies with a copy-paste env-var snippet for Railway.
//
// Idempotent-ish: scans for an existing thread by exact name before creating a new one.
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

const ERAS = [
  { key: 'CLASSIC', name: 'Classic Era',           startedAt: 'Oct 1, 2023' },
  { key: 'KUNARK',  name: 'Kunark Era',            startedAt: 'Jul 1, 2024' },
  { key: 'VELIOUS', name: 'Velious Era',           startedAt: 'Apr 1, 2025' },
  { key: 'LUCLIN',  name: 'Luclin Era',            startedAt: 'Oct 1, 2025' },
  { key: 'POP',     name: 'Planes of Power Era',   startedAt: 'Oct 1, 2026' },
];

async function ensureEraThread(channel, era) {
  // Look for an existing thread by name (active + archived)
  const active = await channel.threads.fetchActive().catch(() => null);
  if (active?.threads) {
    for (const [, t] of active.threads) if (t.name === era.name) return { thread: t, created: false };
  }
  const archived = await channel.threads.fetchArchived().catch(() => null);
  if (archived?.threads) {
    for (const [, t] of archived.threads) if (t.name === era.name) return { thread: t, created: false };
  }
  // Create a new one — public thread, 1-week auto-archive (re-activated by future posts)
  const thread = await channel.threads.create({
    name: era.name,
    autoArchiveDuration: 10080,
    reason: `Bootstrap per-era chat thread for ${era.name}`,
  });
  await thread.send(`📜 **${era.name}** — chat from ${era.startedAt} onward will land here.`).catch(() => {});
  return { thread, created: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('initerathreads')
    .setDescription('Create the per-era chat threads in #in-game-guild-chat and #in-game-raid-chat')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targets = [
      { envPrefix: 'GUILD_CHAT', channelId: process.env.GUILD_CHAT_CHANNEL_ID, label: '#in-game-guild-chat' },
      { envPrefix: 'RAID_CHAT',  channelId: process.env.RAID_CHAT_CHANNEL_ID,  label: '#in-game-raid-chat'  },
    ];

    const envLines = [];
    const summary  = [];

    for (const t of targets) {
      if (!t.channelId) {
        summary.push(`❌ ${t.label} — ${t.envPrefix}_CHANNEL_ID env var is unset, skipping`);
        continue;
      }
      let channel;
      try { channel = await interaction.client.channels.fetch(t.channelId); }
      catch { summary.push(`❌ ${t.label} — could not fetch channel ${t.channelId}`); continue; }

      summary.push(`**${t.label}** (${channel.name}):`);
      for (const era of ERAS) {
        try {
          const { thread, created } = await ensureEraThread(channel, era);
          envLines.push(`${t.envPrefix}_${era.key}_THREAD_ID=${thread.id}`);
          summary.push(`  ${created ? '➕ created' : '✓ existing'} **${era.name}** → \`${thread.id}\``);
        } catch (err) {
          summary.push(`  ❌ **${era.name}** — ${err.message}`);
        }
      }
    }

    const env = envLines.length > 0
      ? `\n\n**Paste into Railway env vars:**\n\`\`\`\n${envLines.join('\n')}\n\`\`\``
      : '';

    await interaction.editReply({
      content: `🧵 **Era thread setup**\n${summary.join('\n')}${env}`.slice(0, 1900),
    });
  },
};
