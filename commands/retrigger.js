// commands/retrigger.js — re-run the bot's automatic reaction for a place,
// from recent context (Hitya 2026-08-18: "retrigger the last discord command
// in the thread or channel that it thinks it should have based on recent
// context"). The driving case: suggestion-forum threads that got the old
// text-only nudge card — /retrigger re-reads the thread and posts (or edits
// in place to) the current tap-through card.
//
// Two optional inputs:
//   window — how much recent context to read: "10m", "5h", "2d" (default 30m;
//            a forum thread's STARTER message always counts regardless of age,
//            it IS the post).
//   target — a thread/channel/message id or link to retrigger somewhere other
//            than where the command ran; a message link anchors the context
//            window at that message.
//
// Deliberately a dispatch table, not one hardcoded behavior: future passive
// automations register here with a `matches(channel)` + `run(...)` pair, and
// the command picks the one that applies — that's the "what it thinks it
// should have" half.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

// "10m" / "5h" / "2d" → ms. Null for anything else (caller falls back).
function parseWindowMs(str) {
  const m = /^\s*(\d{1,4})\s*([mhd])\s*$/i.exec(String(str || ''));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase()];
  return n > 0 ? n * unit : null;
}

// A discord message/channel link or a bare snowflake → { channelId, messageId }.
// Links: https://discord.com/channels/<guild>/<channel>[/<message>]
function parseTargetRef(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const link = /discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/(\d+))?/.exec(s);
  if (link) return { channelId: link[1], messageId: link[2] || null };
  if (/^\d{15,21}$/.test(s)) return { channelId: s, messageId: null };
  return null;
}

const DEFAULT_WINDOW_MS = 30 * 60_000;

// ── The suggestion-forum nudge automation ────────────────────────────────────

async function _gatherThreadContext(thread, windowMs, anchorMs) {
  // Starter message is the post itself — always in, whatever its age.
  let starter = '';
  try {
    const s = await thread.fetchStarterMessage();
    starter = s?.content || '';
  } catch {}
  // Recent human messages inside the window (anchored at the target message's
  // time when a message link was given, else now).
  const anchor = anchorMs || Date.now();
  const lo = anchor - windowMs;
  let recent = [];
  try {
    const msgs = await thread.messages.fetch({ limit: 50 });
    recent = [...msgs.values()]
      .filter(m => !m.author?.bot && m.createdTimestamp >= lo && m.createdTimestamp <= anchor)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(m => m.content)
      .filter(Boolean);
  } catch {}
  return { combined: [thread.name, starter, ...recent].join(' '), recentCount: recent.length };
}

const AUTOMATIONS = [
  {
    name: 'suggestion nudge',
    matches(channel) {
      const forumChannelId = process.env.FORUM_CHANNEL_ID || '1242116105326166057';
      return !!channel?.isThread?.() && channel.parentId === forumChannelId;
    },
    async run(channel, { windowMs, anchorMs }) {
      const { buildNudgeCard } = require('../utils/suggestNudge');
      const { combined, recentCount } = await _gatherThreadContext(channel, windowMs, anchorMs);
      const { embeds, components } = buildNudgeCard(combined, getBosses());

      // Edit the bot's existing in-flow card when there is one, so retrigger
      // upgrades the card instead of stacking a second. Only cards still IN
      // the flow (📣 titles) — a completed "✅ Request sent" stays as the
      // record and a fresh card posts below it.
      let edited = false;
      try {
        const msgs = await channel.messages.fetch({ limit: 50 });
        const mine = [...msgs.values()]
          .filter(m => m.author?.id === channel.client.user?.id
                    && m.embeds?.[0]?.title?.startsWith('📣'))
          .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
        if (mine) { await mine.edit({ embeds, components }); edited = true; }
      } catch {}
      if (!edited) await channel.send({ embeds, components });
      return `${edited ? 'Updated the card' : 'Posted a fresh card'} in <#${channel.id}> — context: post title + starter + ${recentCount} recent message${recentCount === 1 ? '' : 's'}.`;
    },
  },
];

module.exports = {
  parseWindowMs, parseTargetRef,

  data: new SlashCommandBuilder()
    .setName('retrigger')
    .setDescription("Re-run the bot's automatic reaction here (or somewhere) from recent context")
    .addStringOption(opt =>
      opt.setName('window')
        .setDescription('How much recent context to read — e.g. "10m", "5h", "2d" (default 30m)')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('target')
        .setDescription('Thread/channel/message id or link to retrigger there instead of here')
        .setRequired(false)),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const windowRaw = interaction.options.getString('window');
    const windowMs = windowRaw ? parseWindowMs(windowRaw) : DEFAULT_WINDOW_MS;
    if (!windowMs)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Couldn't read \`${windowRaw}\` as a window — use forms like \`10m\`, \`5h\`, \`2d\`.` });

    // Resolve where to act: the target option, else right here.
    const targetRaw = interaction.options.getString('target');
    let channel = interaction.channel;
    let anchorMs = null;
    if (targetRaw) {
      const ref = parseTargetRef(targetRaw);
      if (!ref)
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Couldn\'t read the target — paste a channel/thread/message link or a bare id.' });
      channel = await interaction.client.channels.fetch(ref.channelId).catch(() => null);
      if (!channel)
        return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Couldn\'t reach that channel/thread — check the link and my access.' });
      if (ref.messageId) {
        const msg = await channel.messages?.fetch(ref.messageId).catch(() => null);
        if (msg) anchorMs = msg.createdTimestamp;
      }
    }

    const automation = AUTOMATIONS.find(a => a.matches(channel));
    if (!automation) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Nothing to retrigger for <#${channel?.id || '?'}> — I currently know how to re-run: ${AUTOMATIONS.map(a => `**${a.name}**`).join(', ')} (suggestion-forum threads).`,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const summary = await automation.run(channel, { windowMs, anchorMs });
      await interaction.editReply({ content: `🔁 ${summary}` });
    } catch (err) {
      console.warn('[retrigger] failed:', err?.message);
      await interaction.editReply({ content: `❌ Retrigger failed: ${err?.message || 'unknown error'}` });
    }
  },
};
