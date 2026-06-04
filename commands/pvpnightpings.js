// commands/pvpnightpings.js — overnight PvP-ping opt-in board.
//
// During PvP quiet hours (default 1am–8am ET, see PVP_QUIET_START/END), the
// automated @PVP role pings are muted for the role at large. This board lets
// individuals opt back IN so they (and only they) still get pinged overnight:
//   🌙 tonight  — pinged until the next 8am, then auto-removed
//   📌 always   — pinged every night until they opt out
//   🔕 remove   — off both lists
//
// /pvpnightpings (officer) posts or refreshes the board in the PVP channel.
// The three buttons are usable by anyone (they add/remove only themselves).

const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags,
} = require('discord.js');
const { hasOfficerRole } = require('../utils/roles');
const {
  getPvpNight, addPvpNightTonight, addPvpNightPermanent, removePvpNight,
  getPvpNightBoardMsg, setPvpNightBoardMsg,
} = require('../utils/state');
const { nextPvpQuietEnd } = require('../utils/timezone');

function quietWindowLabel() {
  const s = parseInt(process.env.PVP_QUIET_START, 10);
  const e = parseInt(process.env.PVP_QUIET_END, 10);
  const start = Number.isInteger(s) && s >= 0 && s <= 23 ? s : 1;
  const end   = Number.isInteger(e) && e >= 0 && e <= 23 ? e : 8;
  const fmt = (h) => {
    const ap = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ap}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

function buildNightRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pvpnight_tonight').setLabel('🌙 Ping me tonight').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('pvpnight_always').setLabel('📌 Always ping me overnight').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pvpnight_remove').setLabel('🔕 Stop overnight pings').setStyle(ButtonStyle.Secondary),
  );
}

function buildNightEmbed() {
  const n = getPvpNight();
  const now = Date.now();
  const tonightIds = Object.entries(n.tonight || {})
    .filter(([, exp]) => exp && exp > now)
    .map(([uid]) => uid)
    .filter(uid => !n.permanent.includes(uid));   // permanent shown in its own field
  const permList  = n.permanent.length ? n.permanent.map(u => `<@${u}>`).join(' ') : '_nobody yet_';
  const tonyList  = tonightIds.length  ? tonightIds.map(u => `<@${u}>`).join(' ')  : '_nobody yet_';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🌙 Overnight PvP Pings')
    .setDescription(
      `Between **${quietWindowLabel()} Eastern**, automated \`@PVP\` pings (spawn-window alerts + live kill/death broadcasts) are **muted** so nobody gets woken up.\n\n` +
      'Want to stay on the hook overnight? Opt in below — during quiet hours the pings go **only** to the people on these lists. ' +
      'Manual `/pvpalert` and `/pvpspawn` rallies always ping regardless.'
    )
    .addFields(
      { name: '📌 Always on', value: permList },
      { name: '🌙 Tonight (until 8am)', value: tonyList },
    )
    .setFooter({ text: 'Use the buttons to add or remove yourself.' })
    .setTimestamp();
}

async function getPvpTarget(client) {
  const id = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  if (!id) return null;
  try { return await client.channels.fetch(id); } catch { return null; }
}

// Refresh the anchored board message in place (best-effort). Called after every
// opt-in/out so any board reflects the current lists. Button handlers also edit
// the message they're attached to directly, so this is the belt to that
// suspenders (keeps a second/older board honest if one exists).
async function refreshNightBoard(client) {
  const id = getPvpNightBoardMsg();
  if (!id) return;
  const ch = await getPvpTarget(client);
  if (!ch) return;
  try {
    const msg = await ch.messages.fetch(id);
    await msg.edit({ embeds: [buildNightEmbed()], components: [buildNightRow()] });
  } catch { /* anchor gone — next /pvpnightpings reposts */ }
}

// ── Button handlers (anyone — they only touch their own membership) ─────────
async function _ack(interaction, text) {
  // Update the board the button lives on, then ephemerally confirm.
  try { await interaction.update({ embeds: [buildNightEmbed()], components: [buildNightRow()] }); }
  catch { /* fall through to followUp below */ }
  try { await interaction.followUp({ flags: MessageFlags.Ephemeral, content: text }); }
  catch {}
}
async function handleNightTonight(interaction) {
  const exp = nextPvpQuietEnd();
  addPvpNightTonight(interaction.user.id, exp);
  await _ack(interaction, `🌙 You'll get overnight PvP pings until <t:${Math.floor(exp / 1000)}:t>. After that, pings resume for the whole role at 8am.`);
}
async function handleNightAlways(interaction) {
  addPvpNightPermanent(interaction.user.id);
  await _ack(interaction, '📌 You\'re on the **always-on** overnight ping list. Hit 🔕 anytime to come off it.');
}
async function handleNightRemove(interaction) {
  removePvpNight(interaction.user.id);
  await _ack(interaction, '🔕 Removed — you won\'t be pinged during overnight quiet hours (you still get normal daytime `@PVP` pings).');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvpnightpings')
    .setDescription('Officer: post the overnight PvP-ping opt-in board in the PVP channel.'),

  async execute(interaction) {
    if (!hasOfficerRole(interaction.member)) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Officers only.' });
    }
    const ch = await getPvpTarget(interaction.client);
    if (!ch) {
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ No PVP channel configured (set `PVP_THREAD_ID` or `PVP_CHANNEL_ID`).' });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sent = await ch.send({ embeds: [buildNightEmbed()], components: [buildNightRow()] });
    setPvpNightBoardMsg(sent.id);
    await interaction.editReply(`✅ Overnight PvP-ping board posted in ${ch}.`);
  },

  buildNightRow, buildNightEmbed, refreshNightBoard,
  handleNightTonight, handleNightAlways, handleNightRemove,
};
