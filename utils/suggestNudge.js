// utils/suggestNudge.js — tap-through event requests from the forum nudge card
// (Hitya 2026-08-17, from Fungalfist's Trakanon thread: the card told members
// to type `/suggest boss:… time:…` — "which is more effort than people put
// together. fungal would have hit '1' if he could have").
//
// The nudge card now carries the flow instead of describing it:
//   1. tap a DETECTED boss button (or "Different boss…" → expansion select →
//      boss select, PoP hidden while locked);
//   2. tap when — "Any time, any night" first (that is what people actually
//      mean), tonight/tomorrow/next raid night, or ✏️ Exact time via a modal;
//   3. the SAME Event Request card /suggest posts goes to the officers,
//      attributed to the tapper, with a link back to the forum thread.
//
// All state rides in customIds (`sugnudge_*`) — no storage, safe across
// deploys. Every handler role-gates exactly like /suggest.

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('./roles');
const { isPopLocked } = require('./config');

function _bosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

// ── Pure builders (unit-tested in test/suggest-nudge.test.js) ────────────────

const TIME_CHOICES = [
  { key: 'any',      emoji: '🕐', short: 'Any time, any night', label: 'any time, any night' },
  { key: 'tonight',  emoji: '🌙', short: 'Tonight 8pm',         label: 'tonight 8pm ET' },
  { key: 'tomorrow', emoji: '📅', short: 'Tomorrow 8pm',        label: 'tomorrow 8pm ET' },
  { key: 'nextraid', emoji: '🗓', short: 'Next raid night',     label: 'next raid night (Sun/Wed/Thu 8pm ET)' },
];

function timeChoiceLabel(key) {
  return TIME_CHOICES.find(c => c.key === key)?.label || null;
}

// Options for the expansion select. PoP stays hidden while the era lock is on —
// suggesting a locked boss only creates an officer "no" (popLocked injectable
// for tests; defaults to the real lock).
function expansionOptions(bosses, popLocked = isPopLocked()) {
  const seen = [];
  for (const b of bosses) {
    const exp = b.expansion || 'Other';
    if (popLocked && exp === 'PoP') continue;
    if (!seen.includes(exp)) seen.push(exp);
  }
  return seen.map(e => ({ label: e, value: e }));
}

// Up to 25 bosses of one expansion, alphabetical (a Discord select's hard cap).
// `truncated` tells the caller to say "not listed → /suggest".
function bossOptionsForExpansion(bosses, expansion) {
  const all = bosses
    .filter(b => (b.expansion || 'Other') === expansion)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    truncated: all.length > 25,
    options: all.slice(0, 25).map(b => ({
      label: `${b.name} (${b.zone})`.slice(0, 100),
      value: b.id,
      emoji: b.emoji || undefined,
    })),
  };
}

// Components for the nudge card itself: one button per detected boss (max 4)
// + the picker fallback. With no detections, just the picker.
function buildNudgeComponents(matchedBosses) {
  const row = new ActionRowBuilder();
  for (const b of (matchedBosses || []).slice(0, 4)) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`sugnudge_boss:${b.id}`)
      .setLabel(`${b.emoji ? b.emoji + ' ' : ''}${b.name}`.slice(0, 80))
      .setStyle(ButtonStyle.Primary));
  }
  row.addComponents(new ButtonBuilder()
    .setCustomId('sugnudge_other')
    .setLabel(matchedBosses?.length ? '🔎 Different boss…' : '🔎 Who / Where?')
    .setStyle(ButtonStyle.Secondary));
  return [row];
}

function timeStepComponents(bossId) {
  const r1 = new ActionRowBuilder().addComponents(
    ...TIME_CHOICES.map(c => new ButtonBuilder()
      .setCustomId(`sugnudge_time:${bossId}:${c.key}`)
      .setLabel(`${c.emoji} ${c.short}`)
      .setStyle(c.key === 'any' ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  );
  const r2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sugnudge_exact:${bossId}`)
      .setLabel('✏️ Exact time…').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sugnudge_other')
      .setLabel('↩ Different boss').setStyle(ButtonStyle.Secondary),
  );
  return [r1, r2];
}

// ── Interaction handlers ─────────────────────────────────────────────────────

function _gate(interaction) {
  if (hasAllowedRole(interaction.member)) return true;
  interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` }).catch(() => {});
  return false;
}

function _findBoss(id) {
  return _bosses().find(b => b.id === id) || null;
}

function _timeStepEmbed(boss) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📣 When do you want to run it?')
    .setDescription(`${boss.emoji ? boss.emoji + ' ' : ''}**${boss.name}** — ${boss.zone}\n\nTap a time and it goes straight to the officers.`);
}

async function handleNudgeBossPick(interaction) {
  if (!_gate(interaction)) return;
  const bossId = interaction.customId.split(':')[1];
  const boss = _findBoss(bossId);
  if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ That boss is no longer on the list — use `/suggest`.' });
  await interaction.update({ embeds: [_timeStepEmbed(boss)], components: timeStepComponents(bossId) });
}

async function handleNudgeOther(interaction) {
  if (!_gate(interaction)) return;
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('sugnudge_expsel')
      .setPlaceholder('Which era is it in?')
      .addOptions(expansionOptions(_bosses())),
  );
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📣 Who / where do you want to run?')
    .setDescription('Pick the era, then the boss. Anything not listed: `/suggest` has the full list.');
  await interaction.update({ embeds: [embed], components: [row] });
}

async function handleNudgeExpansionSelect(interaction) {
  if (!_gate(interaction)) return;
  const expansion = interaction.values[0];
  const { options, truncated } = bossOptionsForExpansion(_bosses(), expansion);
  if (!options.length) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Nothing listed for that era — use `/suggest`.' });
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('sugnudge_bosssel')
      .setPlaceholder(`${expansion} bosses…`)
      .addOptions(options),
  );
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📣 ${expansion} — pick the boss`)
    .setDescription(truncated
      ? 'Showing the first 25 alphabetically — anything missing is one `/suggest` away.'
      : 'Pick one and choose a time next.');
  await interaction.update({ embeds: [embed], components: [row] });
}

async function handleNudgeBossSelect(interaction) {
  if (!_gate(interaction)) return;
  const boss = _findBoss(interaction.values[0]);
  if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ That boss is no longer on the list — use `/suggest`.' });
  await interaction.update({ embeds: [_timeStepEmbed(boss)], components: timeStepComponents(boss.id) });
}

async function _submitRequest(interaction, boss, timeStr) {
  const { postEventRequest } = require('../commands/suggest');
  // The tap happened inside the member's own forum thread — link the request
  // back to it so officers get the post's full context (title carries intent:
  // "trakanon kill - for vp key (final piece)").
  const note = interaction.channelId ? `From forum post: <#${interaction.channelId}>` : null;
  const posted = await postEventRequest({
    client: interaction.client,
    userId: interaction.user.id,
    boss,
    timeStr,
    note,
  });
  if (!posted) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not post the request (suggestions channel unavailable) — try `/suggest`.' });
  }
  const done = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('✅ Request sent to the officers')
    .setDescription(`${boss.emoji ? boss.emoji + ' ' : ''}**${boss.name}** — ${boss.zone}\n🕐 ${timeStr}\nRequested by <@${interaction.user.id}> — you'll hear back here when someone claims it.`);
  const payload = { embeds: [done], components: [] };
  // Modal submits can't update the original message through the modal
  // interaction — edit it via the message reference instead.
  if (interaction.isModalSubmit?.()) {
    await interaction.deferUpdate().catch(() => {});
    await interaction.message?.edit(payload).catch(() => {});
  } else {
    await interaction.update(payload);
  }
}

async function handleNudgeTime(interaction) {
  if (!_gate(interaction)) return;
  const [, bossId, key] = interaction.customId.split(':');
  const boss = _findBoss(bossId);
  const timeStr = timeChoiceLabel(key);
  if (!boss || !timeStr) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ That option expired — use `/suggest`.' });
  await _submitRequest(interaction, boss, timeStr);
}

async function handleNudgeExactOpen(interaction) {
  if (!_gate(interaction)) return;
  const bossId = interaction.customId.split(':')[1];
  const modal = new ModalBuilder()
    .setCustomId(`sugnudge_modal:${bossId}`)
    .setTitle('When do you want to run it?')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('when')
        .setLabel('Time — e.g. "9pm Tuesday", "Friday after raid"')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80),
    ));
  await interaction.showModal(modal);
}

async function handleNudgeModalSubmit(interaction) {
  if (!_gate(interaction)) return;
  const bossId = interaction.customId.split(':')[1];
  const boss = _findBoss(bossId);
  const timeStr = (interaction.fields.getTextInputValue('when') || '').trim().slice(0, 80);
  if (!boss || !timeStr) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ That option expired — use `/suggest`.' });
  await _submitRequest(interaction, boss, timeStr);
}

module.exports = {
  buildNudgeComponents, timeStepComponents, timeChoiceLabel,
  expansionOptions, bossOptionsForExpansion, TIME_CHOICES,
  handleNudgeBossPick, handleNudgeOther, handleNudgeExpansionSelect,
  handleNudgeBossSelect, handleNudgeTime, handleNudgeExactOpen,
  handleNudgeModalSubmit,
};
