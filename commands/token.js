// commands/token.js — Per-user Parser agent tokens.
//
// After the 2026-06-04 cutover, the shared WOLFPACK_AGENT_TOKEN is no longer
// accepted by /api/agent/*. Every uploader (Mimic install, standalone agent)
// needs a per-user token tied to their Discord identity. Tokens are
// mimic_sessions.session_token rows — same surface the device-link flow uses.
//
// This command:
//   • Lists the calling user's active sessions (created/last-used, agent
//     version, machine label) with a Revoke button per row.
//   • Mints a fresh token via the [+ Mint new token] button. The token value
//     is shown ONCE (subsequent /token calls only show metadata, not the
//     secret). Tokens are pasted into Mimic's settings or the standalone
//     agent's config.
//
// Identity gate: the user must have a wolfpack_members row with a non-null
// user_id (i.e. they've signed in at wolfpack.quest at least once, which
// links Discord → auth.users). If they haven't, we redirect them to sign in
// first — the user_id column is the FK we attach to every session.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const mimicLink = require('../utils/mimicLink');
const supabase  = require('../utils/supabase');

const SIGN_IN_URL = 'https://wolfpack.quest/auth/signin';

async function _lookupWolfpackMember(discordId) {
  if (!supabase.isEnabled()) return null;
  const rows = await supabase.select(
    'wolfpack_members',
    `discord_id=eq.${encodeURIComponent(discordId)}&select=user_id,nickname,global_name&limit=1`,
  ).catch(() => null);
  return Array.isArray(rows) ? rows[0] : null;
}

function _fmtRel(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'in the future';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function _fmtAbs(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

// Render the session list embed + action rows. Used by both the initial
// command response and post-revoke refreshes so the message stays in sync.
function _renderSessionListMessage(sessions) {
  const embed = new EmbedBuilder()
    .setTitle('🔑 Your Wolf Pack Parser tokens')
    .setColor(0x4caf50)
    .setDescription(sessions.length === 0
      ? 'You have no active tokens. Click **Mint new token** below to get one.\n\nPaste the token into Mimic\'s settings, or set it as the `--token` argument on the standalone agent.'
      : `${sessions.length} active session${sessions.length === 1 ? '' : 's'}. Click **Revoke** on any session that\'s no longer yours.`,
    );

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const label = s.machine_label || (s.agent_version ? `agent ${s.agent_version}` : 'unlabelled');
    embed.addFields({
      name:  `#${i + 1} — ${label}`,
      value: `Created **${_fmtAbs(s.created_at)}** · Last used **${_fmtRel(s.last_used_at)}**`,
      inline: false,
    });
  }

  // Discord caps action rows at 5; each row holds up to 5 buttons. We
  // surface revoke buttons for the first 4 sessions then a 5th row with
  // the mint button. >4 sessions: the older ones can be revoked via /token
  // again after the first batch is cleared (rare in practice).
  const rows = [];
  let currentRow = new ActionRowBuilder();
  const visible = sessions.slice(0, 4);
  for (let i = 0; i < visible.length; i++) {
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`token_revoke:${visible[i].id}`)
        .setLabel(`Revoke #${i + 1}`)
        .setStyle(ButtonStyle.Danger),
    );
  }
  if (visible.length > 0) rows.push(currentRow);
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('token_mint')
      .setLabel('+ Mint new token')
      .setStyle(ButtonStyle.Primary),
  ));

  return { embeds: [embed], components: rows };
}

async function handleTokenMint(interaction) {
  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `❌ Guild members only. Required roles: ${allowedRolesList()}`,
    });
  }
  const member = await _lookupWolfpackMember(interaction.user.id);
  if (!member || !member.user_id) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `🔗 Sign in to wolfpack.quest first to link your Discord account, then run \`/token\` again.\n\n${SIGN_IN_URL}`,
    });
  }

  const minted = await mimicLink.mintSessionForUser({
    userId:    member.user_id,
    discordId: interaction.user.id,
    // No Mimic install context here — Mimic-minted sessions go through the
    // OAuth device-link flow and stamp their own agent_version/machine_label.
    // /token-minted sessions are for standalone agents or recovery; they get
    // these fields as the user runs the agent (last_used_at bump path) or
    // we add a follow-up label edit. For now, leave NULL.
  });
  if (!minted) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: '❌ Could not mint a token — Supabase write failed. Try again, and ping an officer if it keeps happening.',
    });
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: [
      '🔑 **Your new Parser token** — copy this NOW, you can\'t view it again.',
      '',
      `\`\`\`${minted.sessionToken}\`\`\``,
      '',
      'Paste it into Mimic\'s settings or set it as `--token` on the standalone agent.',
      'Run `/token` any time to see your active sessions or revoke this one.',
    ].join('\n'),
  });
}

async function handleTokenRevoke(interaction) {
  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `❌ Guild members only. Required roles: ${allowedRolesList()}`,
    });
  }
  const sessionId = interaction.customId.split(':')[1];
  if (!sessionId) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Malformed revoke request.' });
  }
  const ok = await mimicLink.revokeSessionForUser({
    sessionId,
    discordId: interaction.user.id,
  });
  if (!ok) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: '❌ Could not revoke — session not found or not yours.',
    });
  }
  // Refresh the panel in place so the user sees the updated list.
  const sessions = await mimicLink.listSessionsForUser(interaction.user.id);
  const message = _renderSessionListMessage(sessions);
  return interaction.update(message);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('token')
    .setDescription('Manage your Wolf Pack Parser tokens (list / mint / revoke). Ephemeral.'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ Guild members only. Required roles: ${allowedRolesList()}`,
      });
    }

    const member = await _lookupWolfpackMember(interaction.user.id);
    if (!member || !member.user_id) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `🔗 Sign in to wolfpack.quest first to link your Discord account, then come back and run \`/token\`.\n\n${SIGN_IN_URL}`,
      });
    }

    const sessions = await mimicLink.listSessionsForUser(interaction.user.id);
    const message = _renderSessionListMessage(sessions);
    return interaction.reply({ flags: MessageFlags.Ephemeral, ...message });
  },

  handleTokenMint,
  handleTokenRevoke,
};
