// commands/ingestrules.js — Ingest the Discord rulebook (#rules / #raid-rules /
// #loot-rules) into the structured `guild_rules` store (officers only, #94).
//
// WHY: later features (#95 raid-kit readiness, #93 comp matcher, eligibility)
// should read ONE queryable source of rules instead of hard-coding them and
// drifting from the channels. This command reads each configured channel,
// shapes every message into a rule row via utils/rulesParser, and upserts them.
//
// Channel IDs come from env: RULES_CHANNEL_ID / RAID_RULES_CHANNEL_ID /
// LOOT_RULES_CHANNEL_ID (see .env.example). A channel with no env set is
// skipped and reported.
//
// Idempotency / edits / deletions — upsert key is
// (guild_id, channel_key, source_message_id):
//   * new message      → inserted
//   * edited message   → title/body/rule_number/source_edited_at update in place
//   * deleted message  → no longer in the fetched set → flipped active=false
// So a re-run is safe and converges the store to the current channel state.
// Nothing is silently dropped: an unparsed message still lands as a raw-body
// row with rule_number = null.

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasOfficerRole, officerRolesList } = require('../utils/roles');
const supabase = require('../utils/supabase');
const { RULE_CHANNELS, parseRuleMessage, buildRuleRow } = require('../utils/rulesParser');

function guildId() {
  return process.env.SUPABASE_GUILD_ID || 'wolfpack';
}

// Page a text channel newest→oldest and return an array of non-system messages.
// Capped so a huge channel can't burn the interaction budget (rules channels
// are small — dozens of messages).
async function fetchAllMessages(channel) {
  const out = [];
  let beforeId = null;
  for (let page = 0; page < 20; page++) {
    const opts = { limit: 100 };
    if (beforeId) opts.before = beforeId;
    const batch = await channel.messages.fetch(opts);
    if (!batch || batch.size === 0) break;
    for (const m of batch.values()) {
      if (!m.system) out.push(m);
    }
    beforeId = batch.last().id;
    if (batch.size < 100) break;
  }
  return out;
}

// Pull usable text from a message: its content, or a fallback assembled from
// embed titles/descriptions (some rulebooks are posted as rich embeds).
function messageText(m) {
  const content = (m.content || '').trim();
  if (content) return content;
  if (Array.isArray(m.embeds) && m.embeds.length) {
    return m.embeds
      .map(e => [e.title, e.description].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  return '';
}

// Ingest one channel. Returns a per-channel summary object.
async function ingestChannel(client, chan) {
  const id = process.env[chan.env];
  if (!id) return { ...chan, configured: false };

  let channel;
  try {
    channel = await client.channels.fetch(id);
  } catch (err) {
    return { ...chan, configured: true, error: `channel fetch failed: ${err?.message || err}` };
  }
  if (!channel || typeof channel.messages?.fetch !== 'function') {
    return { ...chan, configured: true, error: 'not a readable text channel' };
  }

  let messages;
  try {
    messages = await fetchAllMessages(channel);
  } catch (err) {
    return { ...chan, configured: true, error: `message fetch failed: ${err?.message || err}` };
  }

  const nowIso = new Date().toISOString();
  const rows = [];
  const seenIds = [];
  let parsed = 0, raw = 0, empty = 0;

  for (const m of messages) {
    const text = messageText(m);
    if (!text) { empty++; continue; }        // nothing to store (sticker/attachment-only)
    const { rule_number } = parseRuleMessage(text);
    if (rule_number != null) parsed++; else raw++;
    seenIds.push(m.id);
    rows.push(buildRuleRow({
      guildId:       guildId(),
      channelKey:    chan.key,
      messageId:     m.id,
      editedAtIso:   m.editedAt ? m.editedAt.toISOString() : null,
      ingestedAtIso: nowIso,
      text,
    }));
  }

  let upserted = 0;
  if (rows.length) {
    const res = await supabase.upsert('guild_rules', rows, 'guild_id,channel_key,source_message_id');
    upserted = Array.isArray(res) ? res.length : rows.length;
  }

  // Deactivate rows for messages that vanished from the channel. When we saw at
  // least one message, exclude the seen set; when the channel is now empty,
  // deactivate every active row for it.
  let deactivated = 0;
  const base = `guild_id=eq.${encodeURIComponent(guildId())}` +
    `&channel_key=eq.${encodeURIComponent(chan.key)}&active=eq.true`;
  const filter = seenIds.length
    ? `${base}&source_message_id=not.in.(${seenIds.join(',')})`
    : base;
  const del = await supabase.update('guild_rules', filter, { active: false });
  deactivated = Array.isArray(del) ? del.length : 0;

  return {
    ...chan,
    configured: true,
    total: messages.length,
    upserted, parsed, raw, empty, deactivated,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ingestrules')
    .setDescription('Ingest #rules / #raid-rules / #loot-rules into the guild-rules store (officers only)'),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Only officers can ingest rules. Required roles: ${officerRolesList()}`,
      });
    }
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Supabase is not configured on this deploy.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const results = [];
    for (const chan of RULE_CHANNELS) {
      try {
        results.push(await ingestChannel(interaction.client, chan));
      } catch (err) {
        console.error(`[ingestrules] ${chan.key}:`, err);
        results.push({ ...chan, configured: true, error: err?.message || String(err) });
      }
    }

    const anyConfigured = results.some(r => r.configured);
    if (!anyConfigured) {
      return interaction.editReply(
        '❌ No rules channels configured. Set `RULES_CHANNEL_ID`, ' +
        '`RAID_RULES_CHANNEL_ID`, and/or `LOOT_RULES_CHANNEL_ID` (see `.env.example`).'
      );
    }

    const lines = ['📖 **Rules ingest complete.**'];
    let totalRules = 0;
    for (const r of results) {
      if (!r.configured) { lines.push(`• ${r.label}: _not configured (${r.env} unset)_`); continue; }
      if (r.error)       { lines.push(`• ${r.label}: ⚠️ ${r.error}`); continue; }
      totalRules += r.upserted;
      const bits = [
        `${r.upserted} row${r.upserted === 1 ? '' : 's'}`,
        `${r.parsed} numbered`,
        `${r.raw} raw`,
      ];
      if (r.empty) bits.push(`${r.empty} skipped-empty`);
      if (r.deactivated) bits.push(`${r.deactivated} deactivated`);
      lines.push(`• ${r.label}: ${bits.join(' · ')} _(scanned ${r.total})_`);
    }
    lines.push('');
    lines.push(`Stored **${totalRules}** active rule rows. View them at wolfpack.quest/admin/rules.`);

    return interaction.editReply(lines.join('\n'));
  },

  // exported for tests
  ingestChannel,
  messageText,
  fetchAllMessages,
};
