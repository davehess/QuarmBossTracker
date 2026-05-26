// index.js — Quarm Raid Timer Bot

require('dotenv').config();

const {
  Client, GatewayIntentBits, Collection, Events, REST, Routes, MessageFlags,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const {
  getAllState, recordKill, clearKill,
  getZoneCard, setZoneCard, clearZoneCard,
  getDailyKills, resetDailyKills,
  getAnnounceMessageIds, removeAnnounceMessageId, clearAnnounceMessageIds,
  getSpawnAlertMessageId, setSpawnAlertMessageId, clearSpawnAlertMessageId, getAllSpawnAlertMessageIds,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getAnnounce, removeAnnounce, getAnnounceByThreadId,
  updateAnnounceTargets, updateAnnounceEasterEgg, getAllAnnounces,
  getAllPvpKills, clearPvpKill, getQuake, saveQuake, clearQuake,
  addPvpAlertHowler,
  hasSeenWelcome, markWelcomeSeen,
  getRaidSession, clearRaidSession, accumulateSessionDamage,
  clearRaidNight,
  getAllLiveKills, clearLiveKill,
  setLiveKillTimerUnknown, setPvpKillTimerUnknown,
  getHateBoardMessageId, setHateBoardMessageId,
} = require('./utils/state');
const { getDefaultTz, msUntilMidnightInTz } = require('./utils/timezone');
const {
  buildZoneKillCard, buildSpawnAlertEmbed, buildSpawnedEmbed,
  buildDailySummaryEmbed,
} = require('./utils/embeds');
const {
  postKillUpdate, postOrUpdateExpansionBoard,
} = require('./utils/killops');
const { hasAllowedRole, allowedRolesList, hasOfficerRole, officerRolesList } = require('./utils/roles');
const { EXPANSION_ORDER, getThreadId, getBossExpansion, isPopLocked } = require('./utils/config');
const { discordAbsoluteTime, discordRelativeTime } = require('./utils/timer');

function getBosses() {
  delete require.cache[require.resolve('./data/bosses.json')];
  return require('./data/bosses.json');
}

// ── Client ─────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

// ── Load commands ──────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js')).forEach((file) => {
  try {
    const cmd = require(path.join(commandsPath, file));
    if (cmd.data && cmd.execute) {
      client.commands.set(cmd.data.name, cmd);
      console.log(`Loaded: /${cmd.data.name}`);
    } else {
      console.warn(`Skipped ${file} — missing data or execute`);
    }
  } catch (err) {
    console.error(`Failed to load ${file}:`, err.message);
  }
});

// ── Ready ──────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ ${readyClient.user.tag} | ${getBosses().length} bosses`);
  await registerCommands();
  startSpawnChecker(readyClient);
  scheduleMidnightSummary(readyClient);
  runStartupSequence(readyClient).catch(err => console.error('[startup] Error:', err?.message));
});

async function runStartupSequence(readyClient) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const { loadOnboardingData, postOrUpdateInstructions } = require('./utils/onboarding');
  const { loadParsesFromDiscord }    = require('./commands/parse');
  const { loadRosterFromDiscord }    = require('./utils/roster');
  const { runAutoRestore }           = require('./commands/restore');
  const { runBoard }                 = require('./commands/board');
  const { runCleanup }               = require('./commands/cleanup');
  const { loadHateStateFromDiscord } = require('./utils/hateBoard');

  await loadOnboardingData(readyClient).catch(err => console.warn('[startup] loadOnboardingData:', err?.message));
  await postOrUpdateInstructions(readyClient).catch(err => console.warn('[startup] postOrUpdateInstructions:', err?.message));
  await loadParsesFromDiscord(readyClient).catch(err => console.warn('[startup] loadParsesFromDiscord:', err?.message));
  await loadRosterFromDiscord(readyClient).catch(err => console.warn('[startup] loadRosterFromDiscord:', err?.message));
  await loadHateStateFromDiscord(readyClient).catch(err => console.warn('[startup] loadHateStateFromDiscord:', err?.message));
  await runAutoRestore(readyClient).catch(err => console.warn('[startup] runAutoRestore:', err?.message));
  await delay(60_000);
  await runBoard(readyClient).catch(err => console.warn('[startup] runBoard:', err?.message));
  await delay(60_000);
  await runCleanup(readyClient).catch(err => console.warn('[startup] runCleanup:', err?.message));
}

async function registerCommands() {
  const guildId = process.env.DISCORD_GUILD_ID, clientId = process.env.DISCORD_CLIENT_ID;
  if (!guildId || !clientId) { console.warn('⚠️ Missing DISCORD_GUILD_ID or DISCORD_CLIENT_ID'); return; }
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    const data = [...client.commands.values()].map((c) => c.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: data });
    console.log(`✅ Registered ${data.length} commands`);
  } catch (err) { console.error('❌ Command registration failed:', err?.message); }
}

// ── Interactions ───────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) { try { await cmd.autocomplete(interaction); } catch (e) { console.error(e); } }
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'parseConfirm') {
    const { handleParseConfirm } = require('./commands/parse');
    await handleParseConfirm(interaction).catch(console.error);
    return;
  }
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('kill:'))               { await handleBoardButton(interaction); return; }
    if (interaction.customId.startsWith('confirm_kill_announce:')) { await handleConfirmKillAnnounce(interaction); return; }
    if (interaction.customId === 'cancel_kill_confirm')          { await interaction.update({ content: '↩️ Cancelled.', components: [] }); return; }
    if (interaction.customId === 'cancel_announce')             { await handleCancelAnnounce(interaction); return; }
    if (interaction.customId.startsWith('cancel_event_thread:')){ await handleCancelEventThread(interaction); return; }
    if (interaction.customId.startsWith('remove_target:'))      { await handleRemoveTargetButton(interaction); return; }
    if (interaction.customId.startsWith('add_zone_bosses:'))    { await handleAddZoneBosses(interaction); return; }
    if (interaction.customId === 'pvprole_toggle')              { await handlePvpRoleToggle(interaction, false); return; }
    if (interaction.customId === 'pvprole_toggle_silent')       { await handlePvpRoleToggle(interaction, true); return; }
    if (interaction.customId.startsWith('pvpalert_howl:'))      { await handlePvpAlertHowl(interaction); return; }
    if (interaction.customId.startsWith('pvp_spawn_alert:'))    { await handlePvpSpawnAlert(interaction); return; }
    if (interaction.customId === 'fb_recv')                      { await handleFeedbackRecv(interaction); return; }
    if (interaction.customId === 'fb_impl')                      { await handleFeedbackClose(interaction, true); return; }
    if (interaction.customId === 'fb_nope')                      { await handleFeedbackClose(interaction, false); return; }
    if (interaction.customId === 'onb_pvp')                      { await handleOnbPvp(interaction); return; }
    if (interaction.customId === 'onb_organizer')               { await handleOnbOrganizer(interaction); return; }
    if (interaction.customId === 'onb_attend')                  { await handleOnbAttend(interaction); return; }
    if (interaction.customId === 'onb_deeps')                   { await handleOnbDeeps(interaction); return; }
    if (interaction.customId.startsWith('onb_ignore:'))         { await handleOnbIgnore(interaction); return; }
    if (interaction.customId === 'onb_show_again')              { await handleOnbShowAgain(interaction); return; }
    if (interaction.customId.startsWith('mark_avail:'))           { await handleMarkAvail(interaction); return; }
    if (interaction.customId.startsWith('pvp_window_spawned:')) { await handlePvpWindowSpawned(interaction); return; }
    if (interaction.customId.startsWith('hate_kill:'))          { await handleHateKillButton(interaction); return; }
    if (interaction.customId.startsWith('hate_confirm_unkill:')){ await handleHateConfirmUnkill(interaction); return; }
    if (interaction.customId.startsWith('hate_unknown:'))       { await handleHateUnknownButton(interaction); return; }
    if (interaction.customId.startsWith('suggest_host:'))        { await handleSuggestHost(interaction); return; }
    if (interaction.customId.startsWith('suggest_nohost:'))     { await handleSuggestNoHost(interaction); return; }
    if (interaction.customId.startsWith('suggest_confirm:'))    { await handleSuggestConfirm(interaction); return; }
    if (interaction.customId.startsWith('suggest_cancel_host:')){ await handleSuggestCancelHost(interaction); return; }
    if (interaction.customId.startsWith('parse_breakdown:')) {
      const { handleParseBreakdown } = require('./commands/parse');
      await handleParseBreakdown(interaction).catch(console.error);
      return;
    }
    if (interaction.customId.startsWith('who_family:'))         { await handleWhoFamily(interaction); return; }
    if (interaction.customId.startsWith('audit_undo:'))         { await handleAuditUndo(interaction); return; }
    if (interaction.customId.startsWith('sll_confirm:'))        { const { handleSllConfirm } = require('./commands/sll'); await handleSllConfirm(interaction); return; }
    if (interaction.customId === 'sll_cancel')                  { const { handleSllCancel }  = require('./commands/sll'); await handleSllCancel(interaction);  return; }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
    await maybeShowWelcome(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} error:`, err);
    try {
      const msg = { flags: MessageFlags.Ephemeral, content: '❌ An error occurred.' };
      interaction.replied || interaction.deferred
        ? await interaction.followUp(msg)
        : await interaction.reply(msg);
    } catch {} // Swallow — interaction token may have expired (10062)
  }
});

// ── Board button handler ────────────────────────────────────────────────────
async function handleBoardButton(interaction) {
  const bossId = interaction.customId.replace('kill:', '');
  const bosses = getBosses();
  const boss   = bosses.find((b) => b.id === bossId);

  // Synchronous checks first — still within the 3-second window
  if (!boss)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });
  if (isPopLocked(boss))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '🔒 PoP bosses are not available until October 1, 2026.' });
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  // If the kill button is on an /announce message, require an ephemeral confirmation
  // before recording the kill — prevents accidental clicks on event announcements.
  // Detect announce messages by the presence of the cancel_announce button — reliable
  // even after a redeploy that clears state.json's announceMessageIds list.
  const isAnnounceMsg = interaction.message.components?.some(row =>
    row.components?.some(c => c.customId === 'cancel_announce')
  );
  if (isAnnounceMsg) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const killState = getAllState();
    const existing  = killState[bossId];
    const isKilled  = existing && existing.nextSpawn > Date.now();
    const label     = isKilled ? `↩️ Confirm: Clear kill for ${boss.name}` : `☠️ Confirm kill: ${boss.name}`;
    const style     = isKilled ? ButtonStyle.Secondary : ButtonStyle.Danger;
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: isKilled
        ? `⚠️ **${boss.name}** is currently on cooldown. Confirm you want to clear the kill record?`
        : `⚠️ Record a kill for **${boss.name}**? This will start the respawn timer.`,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_kill_announce:${bossId}`).setLabel(label).setStyle(style),
        new ButtonBuilder().setCustomId('cancel_kill_confirm').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )],
    });
  }

  // Defer immediately so Discord doesn't time out while we do async work
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const killState  = getAllState();
  const existing   = killState[bossId];
  const now        = Date.now();
  const expansion  = getBossExpansion(boss);
  const threadId   = getThreadId(expansion);

  if (existing && existing.nextSpawn > now) {
    // Unkill
    const prevState = { ...existing };
    clearKill(bossId);
    const newState    = getAllState();
    const stillKilled = bosses.filter((b) => b.zone === boss.zone && newState[b.id] && newState[b.id].nextSpawn > now);
    const zoneCard    = getZoneCard(boss.zone);
    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        if (stillKilled.length > 0) {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
          const m = await ch.messages.fetch(zoneCard.messageId);
          await m.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
        } else {
          const m = await ch.messages.fetch(zoneCard.messageId); await m.delete(); clearZoneCard(boss.zone);
        }
      } catch { clearZoneCard(boss.zone); }
    }
    await interaction.editReply(`↩️ Kill record cleared for **${boss.name}**.`);
    const { postAuditEntry } = require('./utils/audit');
    postAuditEntry(interaction.client, {
      action: 'unkill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState, newNextSpawn: null, msgLink: null,
      source: `board button — ${interaction.customId}`,
    }).catch(() => {});
  } else {
    // Kill
    recordKill(bossId, boss.timerHours, interaction.user.id);
    const newState     = getAllState();
    const zoneBosses   = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses.filter((b) => newState[b.id] && newState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
    const embed    = buildZoneKillCard(boss.zone, killedInZone);
    const zoneCard = getZoneCard(boss.zone);

    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        const m  = await ch.messages.fetch(zoneCard.messageId);
        await m.edit({ embeds: [embed] });
      } catch {
        if (threadId) { const t = await interaction.client.channels.fetch(threadId); const s = await t.send({ embeds: [embed] }); setZoneCard(boss.zone, s.id, threadId); }
      }
    } else if (threadId) {
      const t = await interaction.client.channels.fetch(threadId);
      const s = await t.send({ embeds: [embed] });
      setZoneCard(boss.zone, s.id, threadId);
    }
    await interaction.editReply(`✅ **${boss.name}** kill recorded.`);
    const { postAuditEntry } = require('./utils/audit');
    postAuditEntry(interaction.client, {
      action: 'kill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState: null, newNextSpawn: null, msgLink: null,
      source: `board button — ${interaction.customId}`,
    }).catch(() => {});
  }
  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
}

// ── Confirm kill from /announce message ────────────────────────────────────
// Fires after user confirms the ephemeral prompt shown by handleBoardButton
// when the kill button was on an /announce message.
async function handleConfirmKillAnnounce(interaction) {
  const bossId = interaction.customId.replace('confirm_kill_announce:', '');
  const bosses = getBosses();
  const boss   = bosses.find((b) => b.id === bossId);

  if (!boss)
    return interaction.update({ content: '❌ Unknown boss.', components: [] });
  if (!hasAllowedRole(interaction.member))
    return interaction.update({ content: `❌ You need one of these roles: ${allowedRolesList()}`, components: [] });

  await interaction.deferUpdate();

  const killState  = getAllState();
  const existing   = killState[bossId];
  const now        = Date.now();
  const expansion  = getBossExpansion(boss);
  const threadId   = getThreadId(expansion);

  const { postAuditEntry } = require('./utils/audit');

  if (existing && existing.nextSpawn > now) {
    // Unkill
    const prevState = { ...existing };
    clearKill(bossId);
    const newState    = getAllState();
    const stillKilled = bosses.filter((b) => b.zone === boss.zone && newState[b.id] && newState[b.id].nextSpawn > now);
    const zoneCard    = getZoneCard(boss.zone);
    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        if (stillKilled.length > 0) {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
          const m = await ch.messages.fetch(zoneCard.messageId);
          await m.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
        } else {
          const m = await ch.messages.fetch(zoneCard.messageId); await m.delete(); clearZoneCard(boss.zone);
        }
      } catch { clearZoneCard(boss.zone); }
    }
    await interaction.editReply({ content: `↩️ Kill record cleared for **${boss.name}**.`, components: [] });
    postAuditEntry(interaction.client, {
      action: 'unkill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState, newNextSpawn: null, msgLink: null,
      source: `announce confirm button`,
    }).catch(() => {});
  } else {
    // Kill
    recordKill(bossId, boss.timerHours, interaction.user.id);
    const newState     = getAllState();
    const zoneBosses   = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses.filter((b) => newState[b.id] && newState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: newState[b.id], killedBy: newState[b.id].killedBy }));
    const embed    = buildZoneKillCard(boss.zone, killedInZone);
    const zoneCard = getZoneCard(boss.zone);
    if (zoneCard) {
      try {
        const ch = await interaction.client.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
        const m  = await ch.messages.fetch(zoneCard.messageId);
        await m.edit({ embeds: [embed] });
      } catch {
        if (threadId) { const t = await interaction.client.channels.fetch(threadId); const s = await t.send({ embeds: [embed] }); setZoneCard(boss.zone, s.id, threadId); }
      }
    } else if (threadId) {
      const t = await interaction.client.channels.fetch(threadId);
      const s = await t.send({ embeds: [embed] });
      setZoneCard(boss.zone, s.id, threadId);
    }
    await interaction.editReply({ content: `✅ **${boss.name}** kill recorded.`, components: [] });
    postAuditEntry(interaction.client, {
      action: 'kill_board', userId: interaction.user.id, userName: interaction.user.username,
      bossId, bossName: boss.name, prevState: null, newNextSpawn: null, msgLink: null,
      source: `announce confirm button`,
    }).catch(() => {});
  }
  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
}

// ── Audit undo button ──────────────────────────────────────────────────────
async function handleAuditUndo(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can undo audit actions. Roles required: ${officerRolesList()}` });

  const entryId = interaction.customId.replace('audit_undo:', '');
  const { getAuditEntry, markAuditEntryUndone, restoreBossState } = require('./utils/state');
  const { removeUndoButton } = require('./utils/audit');

  const entry = getAuditEntry(entryId);
  if (!entry) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Audit entry not found.' });
  if (entry.undone) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ This action has already been undone.' });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const killActions   = ['kill', 'kill_board'];
  const unkillActions = ['unkill', 'unkill_board'];

  if (killActions.includes(entry.action)) {
    clearKill(entry.bossId);
  } else if (unkillActions.includes(entry.action) || entry.action === 'updatetimer') {
    if (entry.prevState) restoreBossState(entry.bossId, entry.prevState);
  }

  markAuditEntryUndone(entryId);
  await removeUndoButton(interaction.client, entry.auditMsgId);
  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, entry.bossId).catch(console.warn);
  await interaction.editReply(`✅ Undone: **${entry.bossName}** ${entry.action} (originally by <@${entry.userId}>)`);
}

// ── Cancel announce button ─────────────────────────────────────────────────
async function handleCancelAnnounce(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can cancel events. Roles required: ${officerRolesList()}` });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const origMsg         = interaction.message;
  try {
    if (historyThreadId) {
      const thread = await interaction.client.channels.fetch(historyThreadId);
      await thread.send({ content: `📋 **Cancelled announcement** (by <@${interaction.user.id}>)`, embeds: origMsg.embeds });
    }
    await origMsg.delete();
    removeAnnounceMessageId(origMsg.id);
    await interaction.editReply('✅ Announcement cancelled and archived.');
  } catch (err) {
    await interaction.editReply('❌ Could not archive.');
  }
}

// ── Feedback button handlers ──────────────────────────────────────────────
const { EmbedBuilder: _EB2, ActionRowBuilder: _ARB2, ButtonBuilder: _BB2, ButtonStyle: _BS2 } = require('discord.js');

function _feedbackAckRow() {
  return new _ARB2().addComponents(
    new _BB2().setCustomId('fb_impl').setLabel('✅ Implemented').setStyle(_BS2.Success),
    new _BB2().setCustomId('fb_nope').setLabel('❌ Not Implementing').setStyle(_BS2.Danger),
  );
}

async function handleFeedbackRecv(interaction) {
  const { hasOfficerRole, officerRolesList: orl } = require('./utils/roles');
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Officers only. Roles required: ${orl()}` });

  await interaction.deferUpdate();
  const msg   = interaction.message;
  const embed = msg.embeds[0];
  if (!embed) return;

  // Extract submitter user ID from footer (stored as "uid:<id>")
  const footerText = embed.footer?.text || '';
  const uidMatch   = footerText.match(/uid:(\d+)/);
  const userId     = uidMatch?.[1];

  // DM the submitter
  if (userId) {
    try {
      const user = await interaction.client.users.fetch(userId);
      await user.send(`📬 Your feedback (**${embed.title?.replace('📬 Feedback — ', '') || 'General'}**) has been received by leadership. Thank you!`);
    } catch { /* DMs may be closed */ }
  }

  const reviewer = interaction.member?.displayName || interaction.user.username;
  const updated  = _EB2.from(embed)
    .setFields(...(embed.fields || []).filter(f => f.name !== 'Status'), { name: 'Status', value: `📬 Acknowledged by ${reviewer}`, inline: false });

  await msg.edit({ embeds: [updated], components: [_feedbackAckRow()] });
}

async function handleFeedbackClose(interaction, implemented) {
  const { hasOfficerRole, officerRolesList: orl } = require('./utils/roles');
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Officers only. Roles required: ${orl()}` });

  await interaction.deferUpdate();
  const msg    = interaction.message;
  const embed  = msg.embeds[0];
  if (!embed) return;

  const reviewer = interaction.member?.displayName || interaction.user.username;
  const statusVal = implemented
    ? `✅ Implemented by ${reviewer}`
    : `❌ Not implementing (${reviewer})`;

  const updated = _EB2.from(embed)
    .setFields(...(embed.fields || []).filter(f => f.name !== 'Status'), { name: 'Status', value: statusVal, inline: false });

  await msg.edit({ embeds: [updated], components: [] });
}

// ── Cancel event from announce thread button ───────────────────────────────
async function handleCancelEventThread(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const announceMessageId = interaction.customId.replace('cancel_event_thread:', '');
  const announce          = getAnnounce(announceMessageId);
  if (!announce)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the announce record for this event.' });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Delete Discord event
  if (announce.eventId) {
    try {
      const event = await interaction.guild.scheduledEvents.fetch(announce.eventId);
      await event.delete();
    } catch (err) { console.warn('cancel_event_thread: could not delete event:', err?.message); }
  }

  // Check for meaningful conversation in the thread (more than bot messages)
  const thread = interaction.channel;
  let hasConversation = false;
  try {
    const msgs = await thread.messages.fetch({ limit: 50 });
    hasConversation = msgs.some(m => !m.author.bot);
  } catch { /* assume no conversation */ }

  // Archive or delete the thread
  try {
    if (hasConversation) {
      await thread.setArchived(true, 'Raid event cancelled');
    } else {
      await thread.delete('Raid event cancelled — no conversation');
    }
  } catch (err) { console.warn('cancel_event_thread: could not close thread:', err?.message); }

  // Update the original announce message to show cancelled
  try {
    const ch  = await interaction.client.channels.fetch(announce.channelId);
    const msg = await ch.messages.fetch(announceMessageId);
    const { EmbedBuilder } = require('discord.js');
    const updated = EmbedBuilder.from(msg.embeds[0])
      .setTitle(`~~${msg.embeds[0].title}~~ ❌ CANCELLED`)
      .setColor(0x555555);
    await msg.edit({ embeds: [updated], components: [] });
  } catch (err) { console.warn('cancel_event_thread: could not update announce msg:', err?.message); }

  // Archive to historic kills thread
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  if (historyThreadId) {
    try {
      const histThread = await interaction.client.channels.fetch(historyThreadId);
      await histThread.send({ content: `📋 **Cancelled raid event** (by <@${interaction.user.id}>)` });
    } catch { /* non-critical */ }
  }

  removeAnnounce(announceMessageId);
  removeAnnounceMessageId(announceMessageId);

  if (!hasConversation) {
    // Thread was deleted — can't editReply into a deleted thread
    return;
  }
  await interaction.editReply('✅ Event cancelled and thread archived.');
}

// ── Remove-target button from thread control panel ─────────────────────────
async function handleRemoveTargetButton(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const targetId = interaction.customId.replace('remove_target:', '');
  const announce = getAnnounceByThreadId(interaction.channel.id);
  if (!announce)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find announce data for this thread.' });

  // Delegate to the removetarget command logic by faking the interaction
  // (reuse the state + easter egg logic via direct state calls)
  const {
    buildControlPanelEmbed, buildTargetButtons, buildKillRows, buildCancelRow, EASTER_EGG_CHAIN,
  } = require('./commands/announce');
  const bosses = getBosses();

  let targets = [...(announce.targets || [])].filter(t => t !== targetId);
  updateAnnounceTargets(announce.messageId, targets);

  let extra = '';
  const hasRealTargets = targets.some(t => !t.startsWith('_'));
  if (!hasRealTargets) {
    const level   = announce.easterEggLevel || 0;
    const nextEgg = EASTER_EGG_CHAIN[level];
    if (nextEgg) {
      targets = targets.filter(t => EASTER_EGG_CHAIN.findIndex(e => e.id === t) === -1);
      targets.push(nextEgg.id);
      updateAnnounceTargets(announce.messageId, targets);
      updateAnnounceEasterEgg(announce.messageId, level + 1);
      if (nextEgg.quote) await interaction.channel.send({ content: `> ${nextEgg.quote}` });
      if (announce.eventId) {
        try {
          const ev = await interaction.guild.scheduledEvents.fetch(announce.eventId);
          await ev.edit({ name: `Pack Takedown: ${nextEgg.name}` });
        } catch { /* non-critical */ }
      }
      extra = ` Added **${nextEgg.name}**. 😈`;
    }
  }

  // Refresh the control panel in this message
  try {
    const freshAnnounce  = { ...getAnnounce(announce.messageId), messageId: announce.messageId };
    const cpEmbed        = buildControlPanelEmbed(freshAnnounce.targets, bosses, freshAnnounce.zone, freshAnnounce.plannedTimeStr);
    const killRows       = buildKillRows(freshAnnounce.targets, bosses);
    const targetRows     = buildTargetButtons(freshAnnounce.targets, bosses);
    const cancelRow      = buildCancelRow(announce.messageId);
    await interaction.message.edit({ embeds: [cpEmbed], components: [...killRows.slice(0, 2), ...targetRows.slice(0, 2), cancelRow] });
  } catch (err) { console.warn('remove_target button: could not refresh panel:', err?.message); }

  await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Target removed.${extra}` });
}

// ── Add all zone bosses button ─────────────────────────────────────────────
async function handleAddZoneBosses(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const announceMessageId = interaction.customId.replace('add_zone_bosses:', '');
  const announce          = getAnnounce(announceMessageId);
  if (!announce)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find announce record.' });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const bosses    = getBosses();
  const zone      = announce.zone;
  const existing  = new Set(announce.targets || []);
  const newBosses = bosses.filter(b => b.zone === zone && !existing.has(b.id) && !isPopLocked(b));

  if (!newBosses.length)
    return interaction.editReply('ℹ️ All bosses in this zone are already targets.');

  const { fetchUrl, scrapePqdiDetails, buildControlPanelEmbed, buildTargetButtons, buildKillRows, buildCancelRow } = require('./commands/announce');
  const { EmbedBuilder } = require('discord.js');
  const thread = interaction.channel;

  for (const b of newBosses) {
    if (b.pqdiUrl) {
      try {
        const html    = await fetchUrl(b.pqdiUrl);
        const details = scrapePqdiDetails(html);
        const embed   = new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle(`${b.emoji || '⚔️'} ${b.name}`)
          .setURL(b.pqdiUrl)
          .setDescription(`**Zone:** ${b.zone}\n[Full PQDI listing](${b.pqdiUrl})`)
          .setTimestamp();
        if (details.length) embed.addFields(details.slice(0, 25));
        await thread.send({ embeds: [embed] });
      } catch {
        await thread.send({ content: `PQDI info unavailable — [View on PQDI](${b.pqdiUrl})` }).catch(() => {});
      }
    }
  }

  const allTargets = [...existing, ...newBosses.map(b => b.id)];
  updateAnnounceTargets(announceMessageId, allTargets);

  // Rename thread to zone name
  try { await thread.edit({ name: `${zone} — ${announce.plannedTimeStr}` }); } catch { /* non-critical */ }

  // Rename Discord scheduled event to zone
  if (announce.eventId) {
    try {
      const ev = await interaction.guild.scheduledEvents.fetch(announce.eventId);
      await ev.edit({ name: `Pack Takedown: ${zone}` });
    } catch { /* non-critical */ }
  }

  // Update announce message title in event-chat
  try {
    const ch  = await interaction.client.channels.fetch(announce.channelId);
    const msg = await ch.messages.fetch(announceMessageId);
    if (msg?.embeds?.[0]) {
      const updated = EmbedBuilder.from(msg.embeds[0]).setTitle(`📣 Pack Takedown: ${zone}`);
      await msg.edit({ embeds: [updated] });
    }
  } catch { /* non-critical */ }

  // Refresh control panel — drop the zone button now that it's been used
  const freshAnnounce = { ...getAnnounce(announceMessageId), messageId: announceMessageId };
  const cpEmbed       = buildControlPanelEmbed(freshAnnounce.targets, bosses, zone, freshAnnounce.plannedTimeStr);
  const killRows      = buildKillRows(freshAnnounce.targets, bosses);
  const targetRows    = buildTargetButtons(freshAnnounce.targets, bosses);
  const cancelRow     = buildCancelRow(announceMessageId);
  try {
    await interaction.message.edit({ embeds: [cpEmbed], components: [...killRows.slice(0, 2), ...targetRows.slice(0, 2), cancelRow] });
  } catch { /* non-critical */ }

  await interaction.editReply(`✅ Added **${newBosses.length}** boss(es) from **${zone}**. Thread and event renamed.`);
}

// ── Welcome card ──────────────────────────────────────────────────────────
async function maybeShowWelcome(interaction) {
  if (hasSeenWelcome(interaction.user.id)) return;
  markWelcomeSeen(interaction.user.id);
  try {
    const pkg = require('./package.json');
    const { buildWelcomeEmbed, buildWelcomeComponents } = require('./utils/onboarding');
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildWelcomeEmbed()],
      components: buildWelcomeComponents(pkg.version),
    });
  } catch { /* non-critical — don't let a failed welcome break anything */ }
}

async function handleWelcomePvp(interaction) {
  const { getPvpRole, getPvpRoleName, buildAnnouncementEmbed, buildRoleRow } = require('./commands/pvprole');
  const pvpRole = await getPvpRole(interaction.guild);
  if (!pvpRole) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ No role named **${getPvpRoleName()}** found — ask an admin to create it.` });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const hasRole = interaction.member.roles.cache.has(pvpRole.id);
  if (!hasRole) {
    await interaction.member.roles.add(pvpRole);
    const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
    const ch = pvpTargetId ? await interaction.client.channels.fetch(pvpTargetId).catch(() => null) : null;
    await (ch || interaction.channel).send({
      content: `<@&${pvpRole.id}>`,
      embeds: [buildAnnouncementEmbed(interaction.member)],
      components: [buildRoleRow()],
    });
  }
  await interaction.editReply(`🐺 AWROOOOOO! You${hasRole ? ' already have' : ' now have'} the **${pvpRole.name}** role. The pack awaits.`);
}

async function handleWelcomeOrganizer(interaction) {
  const roleList = (process.env.ALLOWED_ROLE_NAMES || '').split(',').map(r => `**${r.trim()}**`).filter(Boolean).join(', ');
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: [
      `📣 **Raid organizer — here's what to know:**`,
      `Use \`/announce\` to schedule a takedown with a thread, Discord event, and role pings.`,
      `Use \`/addtarget\`, \`/adjusttime\`, and \`/adjustdate\` inside the raid thread to update the plan.`,
      `Kill tracking (board buttons + \`/kill\`) requires one of these roles: ${roleList || 'check with an officer'}.`,
      `Run \`/raidbosshelp\` for the full command reference.`,
    ].join('\n'),
  });
}

async function handleWelcomeAttendee(interaction) {
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `🎯 You're all set! Keep an eye on Discord events and announcements in raid channels. When you're ready to track kills or join PVP, just run this command again or use \`/pvprole\` anytime.`,
  });
}

// ── PVP role toggle button ─────────────────────────────────────────────────
async function handlePvpRoleToggle(interaction, silent) {
  const { buildAnnouncementEmbed, buildRoleRow, getPvpRole, getPvpRoleName } = require('./commands/pvprole');
  const member  = interaction.member;
  const pvpRole = await getPvpRole(interaction.guild);

  if (!pvpRole)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not find a role named **${getPvpRoleName()}**.` });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const hasRole = member.roles.cache.has(pvpRole.id);
  if (hasRole) {
    await member.roles.remove(pvpRole);
    await interaction.editReply(`↩️ Your **${pvpRole.name}** role has been removed. You can rejoin anytime.`);
  } else {
    await member.roles.add(pvpRole);
    if (!silent) {
      const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
      const ch = pvpTargetId
        ? await interaction.client.channels.fetch(pvpTargetId).catch(() => null)
        : null;
      await (ch || interaction.channel).send({
        content: `<@&${pvpRole.id}>`,
        embeds: [buildAnnouncementEmbed(member)],
        components: [buildRoleRow()],
      });
    }
    await interaction.editReply(`✅ You now have the **${pvpRole.name}** role! ${silent ? '(quietly added)' : 'AWROOOOOO!'}`);
  }
}

// ── PVP alert howl button ──────────────────────────────────────────────────
async function handlePvpAlertHowl(interaction) {
  const messageId = interaction.customId.replace('pvpalert_howl:', '');
  const howlers   = addPvpAlertHowler(messageId, interaction.user.id);

  // Build Oxford comma mention list
  const mentions = howlers.map(id => `<@${id}>`);
  let howlLine;
  if (mentions.length === 1) {
    howlLine = `${mentions[0]} howls back!`;
  } else if (mentions.length === 2) {
    howlLine = `${mentions[0]} and ${mentions[1]} howl back!`;
  } else {
    howlLine = `${mentions.slice(0, -1).join(', ')}, and ${mentions[mentions.length - 1]} howl back!`;
  }

  // Replace/append howlers line without touching the original alert content
  const origMsg     = interaction.message;
  const baseContent = origMsg.content.split('\n').filter(l => !l.includes('howls back!')).join('\n');
  try {
    await origMsg.edit({ content: `${baseContent}\n${howlLine}`, components: origMsg.components });
  } catch (err) { console.warn('pvpalert_howl: could not edit message:', err?.message); }

  await interaction.reply({ flags: MessageFlags.Ephemeral, content: '🐺 AWROOOOOO!' });
}

// ── PVP spawn alert button ─────────────────────────────────────────────────
async function handlePvpSpawnAlert(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const bossId = interaction.customId.replace('pvp_spawn_alert:', '');
  delete require.cache[require.resolve('./data/bosses.json')];
  const bosses = require('./data/bosses.json');
  const boss   = bosses.find(b => b.id === bossId);

  const name = boss?.name || bossId;
  const zone = boss?.zone || 'Unknown Zone';

  const pvpRoleName = process.env.PVP_ROLE || 'PVP';
  const pvpRole     = interaction.guild.roles.cache.find(r => r.name === pvpRoleName);
  const mention     = pvpRole ? `<@&${pvpRole.id}> ` : '';

  const { buildHowlRow } = require('./commands/pvpalert');
  const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  const ch = pvpTargetId
    ? await interaction.client.channels.fetch(pvpTargetId).catch(() => interaction.channel)
    : interaction.channel;

  const content = `${mention}🟢 **${name}** (${zone}) has spawned — who's going?`;
  const sent = await ch.send({ content });
  await sent.edit({ content, components: [buildHowlRow(sent.id)] });

  await interaction.editReply(`✅ PVP alert posted for **${name}**!`);
}

// ── Mark mob available (timer-unknown kills) ───────────────────────────────────
async function handleMarkAvail(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  // customId: mark_avail:live:<key>  or  mark_avail:pvp:<key>
  const [, type, ...rest] = interaction.customId.split(':');
  const key = rest.join(':');

  const { refreshHateBoard } = require('./utils/hateBoard');

  if (type === 'live') {
    const { clearLiveKill } = require('./utils/state');
    clearLiveKill(key);
  } else if (type === 'pvp') {
    clearPvpKill(key);
  }

  const { EmbedBuilder: EB } = require('discord.js');
  const availEmbed = new EB()
    .setColor(0x57f287)
    .setTitle('✅ Mob is Available')
    .setDescription(`Marked available by <@${interaction.user.id}>. Use the appropriate kill command to start a new timer.`)
    .setTimestamp();

  await interaction.update({ embeds: [availEmbed], components: [] });
  refreshHateBoard(interaction.client, type).catch(err => console.warn('[mark_avail] refreshHateBoard:', err?.message));
}

// ── PVP spawn window "Mob Spawned" button ─────────────────────────────────────
// customId: pvp_window_spawned:<key>
// Fired from the spawn-window-opens-soon alert. Clears the kill, deletes the
// kill card, refreshes the hate board, and edits the alert message in place.
async function handlePvpWindowSpawned(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const key   = interaction.customId.replace('pvp_window_spawned:', '');
  const kills = getAllPvpKills();
  const entry = kills[key];

  if (!entry) {
    // Already cleared — just remove the button so nobody clicks it again
    const { EmbedBuilder: EB } = require('discord.js');
    return interaction.update({
      embeds: [new EB().setColor(0x57f287).setTitle('🟢 Already cleared').setDescription('This timer was already removed.').setTimestamp()],
      components: [],
    });
  }

  // Delete kill card from kills thread
  const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
  if (killsThreadId && entry.threadMessageId) {
    try {
      const thread = await interaction.client.channels.fetch(killsThreadId);
      const msg    = await thread.messages.fetch(entry.threadMessageId);
      await msg.delete();
    } catch { /* already gone */ }
  }

  clearPvpKill(key);

  const { refreshHateBoard } = require('./utils/hateBoard');
  refreshHateBoard(interaction.client, 'pvp').catch(err => console.warn('[pvp_window_spawned] refreshHateBoard:', err?.message));

  const { EmbedBuilder: EB } = require('discord.js');
  await interaction.update({
    embeds: [new EB()
      .setColor(0x57f287)
      .setTitle(`🟢 Mob Spawned — ${entry.name}`)
      .setDescription(`Confirmed by <@${interaction.user.id}>. Timer cleared — use \`/pvphatekill\` after engaging.`)
      .setTimestamp(),
    ],
    components: [],
  });
}

// ── Hate board kill button ────────────────────────────────────────────────────
// customId: hate_kill:<type>:<n>   type = live | pvp, n = 1-12
// Clicking an available spot kills it. Clicking an on-cooldown spot shows a
// confirmation instead of immediately unkilling (prevents stale-cache accidents).
async function handleHateKillButton(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  const parts = interaction.customId.split(':'); // ['hate_kill', type, n]
  const type  = parts[1];
  const n     = parseInt(parts[2], 10);

  const { HATE_SPOTS } = require('./data/hate-spots');
  const { recordLiveKill, recordPvpKill } = require('./utils/state');
  const { refreshHateBoard } = require('./utils/hateBoard');
  const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');

  const spot = HATE_SPOTS[n];
  if (!spot)
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Unknown spot #${n}.` });

  const HATE_TIMER_HOURS = 72;
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';
  const key = keyPrefix + n;
  const kills = type === 'live' ? getAllLiveKills() : getAllPvpKills();
  const existing = kills[key];
  const now = Date.now();

  if (existing && (existing.timerUnknown || (existing.nextSpawn && existing.nextSpawn > now))) {
    // Spot is on cooldown — show confirmation instead of silently unkilling.
    // This prevents accidental unkills when Discord shows a user a stale board.
    const statusLine = existing.timerUnknown
      ? 'timer unknown — check manually'
      : `spawns ${discordRelativeTime(existing.nextSpawn)}`;
    const confirmRow = new ARB().addComponents(
      new BB()
        .setCustomId(`hate_confirm_unkill:${type}:${n}`)
        .setLabel(`✅ Confirm: Mark #${n} Available`)
        .setStyle(BS.Danger)
    );
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `⚠️ **${spot.label}** is currently on cooldown (${statusLine}).\nIf this mob has re-spawned, click below to mark it available.`,
      components: [confirmRow],
    });
  }

  // Kill — defer first since refreshHateBoard is async
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const spotName = `Hate Mini — ${spot.label}`;
  if (type === 'live') {
    recordLiveKill(key, spotName, HATE_TIMER_HOURS, interaction.user.id, false);
  } else {
    recordPvpKill(spotName, HATE_TIMER_HOURS, interaction.user.id, key, false);
  }
  await refreshHateBoard(interaction.client, type);

  const entry = type === 'live' ? getAllLiveKills()[key] : getAllPvpKills()[key];
  let desc;
  if (type === 'live') {
    desc = `Next spawn: ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`;
  } else {
    desc = `Earliest: ${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})\nLatest: ${discordAbsoluteTime(entry.nextSpawnLatest)} (${discordRelativeTime(entry.nextSpawnLatest)})`;
  }

  const killEmbed = new EB()
    .setColor(type === 'live' ? 0x9b59b6 : 0xcc0000)
    .setTitle(`☠️ Kill recorded — ${spot.label}`)
    .setDescription(desc)
    .setTimestamp();

  const unknownRow = new ARB().addComponents(
    new BB()
      .setCustomId(`hate_unknown:${type}:${n}`)
      .setLabel('❓ Timer Unknown')
      .setStyle(BS.Secondary)
  );

  await interaction.editReply({ embeds: [killEmbed], components: [unknownRow] });
}

// ── Hate board confirm unkill ──────────────────────────────────────────────────
// customId: hate_confirm_unkill:<type>:<n>
async function handleHateConfirmUnkill(interaction) {
  const parts = interaction.customId.split(':');
  const type  = parts[1];
  const n     = parseInt(parts[2], 10);

  const { HATE_SPOTS } = require('./data/hate-spots');
  const { refreshHateBoard } = require('./utils/hateBoard');
  const { EmbedBuilder: EB } = require('discord.js');

  const spot = HATE_SPOTS[n];
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';
  const key = keyPrefix + n;

  if (type === 'live') clearLiveKill(key);
  else clearPvpKill(key);

  await refreshHateBoard(interaction.client, type);

  const doneEmbed = new EB()
    .setColor(0x57f287)
    .setTitle(`✅ Available — ${spot?.label || `Spot #${n}`}`)
    .setDescription(`Marked available by <@${interaction.user.id}>. The board has been updated.`)
    .setTimestamp();

  await interaction.update({ embeds: [doneEmbed], components: [] });
}

// ── Hate board "Timer Unknown" button ─────────────────────────────────────────
// customId: hate_unknown:<type>:<n>
async function handleHateUnknownButton(interaction) {
  const parts = interaction.customId.split(':');
  const type  = parts[1];
  const n     = parseInt(parts[2], 10);

  const { HATE_SPOTS } = require('./data/hate-spots');
  const { refreshHateBoard } = require('./utils/hateBoard');
  const { EmbedBuilder: EB } = require('discord.js');

  const spot = HATE_SPOTS[n];
  const keyPrefix = type === 'live' ? 'hate_' : 'hate_pvp_';
  const key = keyPrefix + n;

  if (type === 'live') setLiveKillTimerUnknown(key);
  else setPvpKillTimerUnknown(key);

  await refreshHateBoard(interaction.client, type);

  const doneEmbed = new EB()
    .setColor(0x808080)
    .setTitle(`❓ Timer Unknown — ${spot?.label || `Spot #${n}`}`)
    .setDescription('Marked as killed with unknown timer. The board shows ❓ for this spot.\nClick the board button again to clear it when the mob is available.')
    .setTimestamp();

  await interaction.update({ embeds: [doneEmbed], components: [] });
}

// ── Suggest button handlers ───────────────────────────────────────────────────
// Flow: "I'll host it" → ephemeral confirmation → "Confirm" → claim + ping requester

async function handleSuggestHost(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can respond to event requests.` });

  const requesterId = interaction.customId.split(':')[1];
  const original    = interaction.message;
  const oldEmbed    = original.embeds[0];
  if (!oldEmbed) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the original request.' });

  const fields    = oldEmbed.fields || [];
  const bossField = fields.find(f => f.name === 'Boss / Zone');
  const timeField = fields.find(f => f.name === 'Wanted time');
  const reqField  = fields.find(f => f.name === 'Requested by');

  const { EmbedBuilder: EB, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');

  const confirmEmbed = new EB()
    .setColor(0xFEE75C)
    .setTitle('⚠️ Confirm — Announce this event?')
    .setDescription(
      `You're about to claim this request and notify the requester.\n\n` +
      `**Boss / Zone:** ${bossField?.value || 'Unknown'}\n` +
      `**Wanted time:** ${timeField?.value || 'Unknown'}\n` +
      `**Suggested by:** ${reqField?.value || `<@${requesterId}>`}`
    )
    .setFooter({ text: 'This will mark the request as claimed. Run /announce to post the full event.' });

  const row = new AR().addComponents(
    new BB()
      .setCustomId(`suggest_confirm:${requesterId}:${original.id}`)
      .setLabel("Yes, I'll host it")
      .setStyle(BS.Success),
    new BB()
      .setCustomId(`suggest_cancel_host:${requesterId}`)
      .setLabel('Cancel')
      .setStyle(BS.Secondary),
  );

  await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [confirmEmbed], components: [row] });
}

async function handleSuggestConfirm(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can confirm event requests.` });

  const parts       = interaction.customId.split(':');
  const requesterId = parts[1];
  const origMsgId   = parts[2];

  const { EmbedBuilder: EB, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');

  try {
    const origMsg  = await interaction.channel.messages.fetch(origMsgId);
    const oldEmbed = origMsg.embeds[0];
    if (origMsg && oldEmbed) {
      const updated = new EB(oldEmbed.data)
        .setColor(0x57F287)
        .setTitle('✅ Event Request — Claimed')
        .setFooter({ text: `Claimed by ${interaction.member.displayName || interaction.user.username}` });
      const disabled = new AR().addComponents(
        new BB().setCustomId('suggest_host_done').setLabel("I'll host it").setStyle(BS.Success).setDisabled(true),
        new BB().setCustomId('suggest_nohost_done').setLabel('No hosts available').setStyle(BS.Danger).setDisabled(true),
      );
      await origMsg.edit({ embeds: [updated], components: [disabled] });
    }
  } catch {}

  try {
    await interaction.channel.send({
      content: `<@${requesterId}> — <@${interaction.user.id}> will host your event! Keep an eye out for an \`/announce\`.`,
    });
  } catch {}

  await interaction.update({ embeds: [], components: [], content: '✅ Claimed! Remember to run `/announce` to post the full event.' });
}

async function handleSuggestCancelHost(interaction) {
  await interaction.update({ embeds: [], components: [], content: '↩️ Cancelled — no changes made.' });
}

async function handleSuggestNoHost(interaction) {
  if (!hasOfficerRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Only officers can respond to event requests.` });

  const requesterId = interaction.customId.split(':')[1];
  const original    = interaction.message;
  const oldEmbed    = original.embeds[0];
  if (!oldEmbed) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not find the original request.' });

  const { EmbedBuilder: EB, ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
  const updated = new EB(oldEmbed.data)
    .setColor(0xED4245)
    .setTitle('❌ Event Request — No Hosts Available')
    .setFooter({ text: `Closed by ${interaction.member.displayName || interaction.user.username}` });

  const disabled = new AR().addComponents(
    new BB().setCustomId('suggest_host_done').setLabel("I'll host it").setStyle(BS.Success).setDisabled(true),
    new BB().setCustomId('suggest_nohost_done').setLabel('No hosts available').setStyle(BS.Danger).setDisabled(true),
  );

  await interaction.update({ embeds: [updated], components: [disabled] });

  try {
    await interaction.channel.send({
      content: `<@${requesterId}> — Unfortunately no officers are available to host your event right now. Try again later or post in the forum!`,
    });
  } catch {}
}

// ── Onboarding button handlers ────────────────────────────────────────────────
async function handleOnbPvp(interaction) {
  const { buildAnnouncementEmbed, buildRoleRow, getPvpRole, getPvpRoleName } = require('./commands/pvprole');
  try {
    const roleName = getPvpRoleName();
    const guild    = interaction.guild || await interaction.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const role     = await getPvpRole(guild);
    const member   = await guild.members.fetch(interaction.user.id);
    if (role) {
      if (member.roles.cache.has(role.id)) {
        await member.roles.remove(role);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Removed **@${roleName}** from your roles.` });
      } else {
        await member.roles.add(role);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Added **@${roleName}** to your roles! You'll be pinged for PVP alerts and quake events.` });
      }
    } else {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not find the **@${roleName}** role. Ask an officer to set it up.` });
    }
  } catch (err) {
    console.warn('onb_pvp:', err?.message);
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not update your role.' }).catch(() => {});
  }
}

async function handleOnbOrganizer(interaction) {
  const { buildOrganizerEmbed } = require('./utils/onboarding');
  await interaction.reply({ embeds: [buildOrganizerEmbed()], flags: MessageFlags.Ephemeral });
}

async function handleOnbDeeps(interaction) {
  const { buildParseOverviewEmbed } = require('./utils/onboarding');
  await interaction.reply({ embeds: [buildParseOverviewEmbed()], flags: MessageFlags.Ephemeral });
}

async function handleOnbAttend(interaction) {
  const { buildAttendeeEmbed } = require('./utils/onboarding');
  await interaction.reply({ embeds: [buildAttendeeEmbed()], flags: MessageFlags.Ephemeral });
}

async function handleOnbIgnore(interaction) {
  const version = interaction.customId.replace('onb_ignore:', '');
  const { setOptedOut, saveOnboardingData } = require('./utils/onboarding');
  setOptedOut(interaction.user.id, version);
  await saveOnboardingData(interaction.client);
  await interaction.reply({
    flags:   MessageFlags.Ephemeral,
    content: `🔕 Got it — you won't see the welcome message on future joins.\nRun \`/onboarding\` any time to see it again or to opt back in.`,
  });
}

async function handleOnbShowAgain(interaction) {
  const pkg = require('./package.json');
  const { removeOptOut, saveOnboardingData, buildWelcomeEmbed, buildWelcomeComponents } = require('./utils/onboarding');
  removeOptOut(interaction.user.id);
  await saveOnboardingData(interaction.client);
  await interaction.reply({
    embeds:     [buildWelcomeEmbed()],
    components: buildWelcomeComponents(pkg.version),
    flags:      MessageFlags.Ephemeral,
  });
}

async function handleWhoFamily(interaction) {
  const name = interaction.customId.replace('who_family:', '');
  const { buildWhoallEmbed } = require('./commands/whoall');
  const embed = buildWhoallEmbed(name);
  if (!embed) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ Could not find family for **${name}**.` });
  }
  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
}

// ── New member onboarding ─────────────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  const pkg = require('./package.json');
  const {
    isOptedOut, getOptedOutVersion, changesSince,
    buildWelcomeEmbed, buildWelcomeComponents,
  } = require('./utils/onboarding');

  const userId  = member.user.id;
  const version = pkg.version;

  // If opted out — check whether there are new features since they last checked
  if (isOptedOut(userId)) {
    const optedAt = getOptedOutVersion(userId);
    const changes = optedAt ? changesSince(optedAt) : [];
    if (changes.length > 0) {
      try {
        await member.send(
          `👋 Welcome back! Since you last opted out of onboarding (v${optedAt}), there are new features:\n\n` +
          changes.join('\n') +
          `\n\nRun \`/onboarding\` in the server to see the full welcome or opt back in.`
        );
      } catch {}
    }
    return;
  }

  // Not opted out — send the welcome message via DM
  try {
    await member.send({
      embeds:     [buildWelcomeEmbed()],
      components: buildWelcomeComponents(version),
    });
  } catch {
    // DMs disabled — fall back to posting in the onboarding thread with a mention
    const threadId = process.env.ONBOARDING_THREAD_ID;
    if (!threadId) return;
    try {
      const thread = await member.client.channels.fetch(threadId);
      await thread.send({
        content:    `👋 Welcome, ${member}! Here's how to get started:`,
        embeds:     [buildWelcomeEmbed()],
        components: buildWelcomeComponents(version),
      });
    } catch (err) {
      console.warn('[onboarding] GuildMemberAdd fallback failed:', err?.message);
    }
  }
});

// ── Forum suggestion listener ─────────────────────────────────────────────────
// When a new post is created in the event-suggestions forum channel, reply with
// a summary of what was detected (boss, time, date) and how to use /suggest.
client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  if (!newlyCreated) return;
  const forumChannelId = process.env.FORUM_CHANNEL_ID || '1242116105326166057';
  if (thread.parentId !== forumChannelId) return;

  await new Promise(r => setTimeout(r, 1500));

  let starterContent = '';
  try {
    const starter = await thread.fetchStarterMessage();
    starterContent = starter?.content || '';
  } catch {}

  const { parseSuggestion } = require('./utils/suggestParser');
  const bosses = getBosses();
  const combined = `${thread.name} ${starterContent}`;
  const { matchedBosses, matchedZones, time, dateLabel } = parseSuggestion(combined, bosses);

  const { EmbedBuilder: EB } = require('discord.js');

  const detectedLines = [];
  if (matchedBosses.length) {
    const names = matchedBosses.slice(0, 5).map(b => `${b.emoji || '⚔️'} **${b.name}** (${b.zone})`);
    if (matchedBosses.length > 5) names.push(`…and ${matchedBosses.length - 5} more`);
    detectedLines.push(`🎯 **Boss/Zone:** ${names.join(', ')}`);
  } else if (matchedZones.length) {
    detectedLines.push(`📍 **Zone:** ${matchedZones.join(', ')}`);
  }
  if (time || dateLabel) {
    detectedLines.push(`🕐 **When:** ${[dateLabel, time].filter(Boolean).join(' ')}`);
  }

  const embed = new EB()
    .setColor(0x5865F2)
    .setTitle('📣 Want officers to host this?')
    .setDescription(
      detectedLines.length
        ? `I think I detected:\n${detectedLines.join('\n')}\n\nIf that looks right, use **\`/suggest\`** to send a formal request to officers!`
        : `Use **\`/suggest\`** to send a formal request to the officers — they'll be notified and can claim your event.`
    )
    .addFields({
      name: 'How to request',
      value: '1. Run `/suggest` in any channel\n2. Pick the boss from the list\n3. Enter when you want to do it\n4. Officers will see it and respond',
      inline: false,
    })
    .setFooter({ text: 'Officers can click \'I\'ll host it\' to claim your request' });

  try {
    await thread.send({ embeds: [embed] });
  } catch (err) {
    console.warn('[forum] Could not reply to new forum thread:', err?.message);
  }
});

// ── Spawn checker ──────────────────────────────────────────────────────────
const alertedSoon = new Set(), alertedSpawned = new Set();
const pvpAlertedSoon = new Set(), pvpAlertedSpawned = new Set();
const pvpAlertedWindow = new Set();      // entries whose "soon" alert has been edited to "possibly spawned"
const pvpAlertMessages = new Map();      // key → Discord message object, for in-place edits
const liveAlertedSoon = new Set(), liveAlertedSpawned = new Set();
const PVP_SOON_MS  = 30 * 60 * 1000;
const SOON_WARN_MS = 30 * 60 * 1000;

function startSpawnChecker(readyClient) {
  const channelId = process.env.TIMER_CHANNEL_ID;
  if (!channelId) { console.warn('⚠️ TIMER_CHANNEL_ID not set'); return; }

  setInterval(async () => {
    try {
      const bosses        = getBosses();
      const histThreadId  = process.env.HISTORIC_KILLS_THREAD_ID;
      const historyThread = histThreadId ? await readyClient.channels.fetch(histThreadId).catch(() => null) : null;
      const state = getAllState(), now = Date.now();

      for (const boss of bosses) {
        const entry = state[boss.id];
        if (!entry) continue;
        const remaining = entry.nextSpawn - now;
        const expansion = getBossExpansion(boss);
        const threadId  = getThreadId(expansion);

        // ── Boss has spawned ───────────────────────────────────────────────
        if (remaining <= 0 && !alertedSpawned.has(boss.id)) {
          alertedSpawned.add(boss.id);
          alertedSoon.delete(boss.id);

          // Archive zone card
          await archiveZoneCardEntry(readyClient, boss, bosses, state, historyThread);

          // Update the "soon" alert message in place to "spawned", or post new spawned msg
          const alertMsgId = getSpawnAlertMessageId(boss.id);
          const target     = threadId ? await readyClient.channels.fetch(threadId).catch(async () => await readyClient.channels.fetch(channelId)) : await readyClient.channels.fetch(channelId);
          const spawnedEmbed = buildSpawnedEmbed(boss);
          if (alertMsgId) {
            try {
              const alertMsg = await target.messages.fetch(alertMsgId);
              await alertMsg.edit({ embeds: [spawnedEmbed] });
            } catch {
              await target.send({ embeds: [spawnedEmbed] });
            }
            clearSpawnAlertMessageId(boss.id);
          } else {
            await target.send({ embeds: [spawnedEmbed] });
          }

          clearKill(boss.id);
          await postKillUpdate(readyClient, channelId, boss.id).catch(console.warn);
          console.log(`🟢 Spawned: ${boss.name}`);
          continue;
        }

        // Reset alert tracking when timer resets (new kill recorded)
        if (remaining > 30 * 60 * 1000) { alertedSpawned.delete(boss.id); alertedSoon.delete(boss.id); }

        // ── 30 min warning ─────────────────────────────────────────────────
        if (remaining > 0 && remaining <= 30 * 60 * 1000 && !alertedSoon.has(boss.id)) {
          alertedSoon.add(boss.id);
          const target = threadId ? await readyClient.channels.fetch(threadId).catch(async () => await readyClient.channels.fetch(channelId)) : await readyClient.channels.fetch(channelId);
          const sent = await target.send({ embeds: [buildSpawnAlertEmbed(boss)] });
          setSpawnAlertMessageId(boss.id, sent.id);
          console.log(`⚠️ 30min warning: ${boss.name}`);
        }
      }
      await checkQuakeAlert(readyClient).catch(console.warn);
      await checkPvpSpawns(readyClient, now).catch(console.warn);
      await checkLiveSpawns(readyClient, now).catch(console.warn);
    } catch (err) { console.error('Spawn checker error:', err); }
  }, 5 * 60 * 1000);
  console.log('Spawn checker started');
}

async function archiveZoneCardEntry(readyClient, spawnedBoss, bosses, state, historyThread) {
  const zoneCard = getZoneCard(spawnedBoss.zone);
  if (!zoneCard) return;
  try {
    const ch      = await readyClient.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
    const cardMsg = await ch.messages.fetch(zoneCard.messageId);
    if (historyThread) {
      const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: getDefaultTz() });
      await historyThread.send({ content: `📦 **${spawnedBoss.name}** (${spawnedBoss.zone}) respawned at ${ts}`, embeds: cardMsg.embeds });
    }
    const now          = Date.now();
    const stillOnTimer = bosses.filter((b) => b.zone === spawnedBoss.zone && b.id !== spawnedBoss.id && state[b.id] && state[b.id].nextSpawn > now + 5000);
    if (stillOnTimer.length > 0) {
      const killedInZone = stillOnTimer.map((b) => ({ boss: b, entry: state[b.id], killedBy: state[b.id].killedBy }));
      await cardMsg.edit({ embeds: [buildZoneKillCard(spawnedBoss.zone, killedInZone)] });
    } else {
      await cardMsg.delete(); clearZoneCard(spawnedBoss.zone);
    }
  } catch (err) { console.warn(`archiveZoneCardEntry (${spawnedBoss.name}):`, err?.message); }
}

// ── PVP spawn checker ──────────────────────────────────────────────────────
async function checkPvpSpawns(readyClient, now) {
  const kills         = getAllPvpKills();
  const killsThreadId = process.env.PVP_KILLS_THREAD_ID;
  const pvpAlertId    = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;

  for (const [key, entry] of Object.entries(kills)) {
    if (entry.timerUnknown) continue;

    const earliest  = entry.nextSpawn;
    const latest    = entry.nextSpawnLatest || (earliest * 1.5); // fallback for old entries
    const toEarliest = earliest - now;

    // Reset soon-alert if still well before the window
    if (toEarliest > PVP_SOON_MS) {
      pvpAlertedSoon.delete(key);
      pvpAlertedSpawned.delete(key);
      pvpAlertedWindow.delete(key);
      pvpAlertMessages.delete(key);
      continue;
    }

    // ── Spawning soon (30 min before earliest) ──────────────────────────────
    if (!pvpAlertedSoon.has(key)) {
      pvpAlertedSoon.add(key);
      // Suppress stale alerts: if the earliest window opened more than 10 min ago
      // (e.g. bot was offline / just redeployed), skip the notification silently.
      const stale = earliest < now - 10 * 60 * 1000;
      if (!stale && pvpAlertId) {
        try {
          const pvpRoleName = process.env.PVP_ROLE || 'PVP';
          const guild       = readyClient.guilds.cache.first();
          const pvpRole     = guild?.roles.cache.find(r => r.name === pvpRoleName);
          const mention     = pvpRole ? `<@&${pvpRole.id}>` : '';
          const ch          = await readyClient.channels.fetch(pvpAlertId);
          const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
          const sent = await ch.send({
            content: `${mention}⚠️ **${entry.name}** spawn window opens soon!`,
            embeds: [new EB()
              .setColor(0xffa500)
              .setTitle(`⚠️ PVP Spawn Window — ${entry.name}`)
              .addFields(
                { name: '⏰ Earliest',  value: `${discordAbsoluteTime(earliest)} (${discordRelativeTime(earliest)})`, inline: true },
                { name: '⏳ Latest',    value: `${discordAbsoluteTime(latest)} (${discordRelativeTime(latest)})`,     inline: true },
              )
              .setFooter({ text: 'The mob can spawn any time in this window.' })
              .setTimestamp(),
            ],
            components: [new ARB().addComponents(
              new BB()
                .setCustomId(`pvp_window_spawned:${key}`)
                .setLabel('✅ Mob Spawned')
                .setStyle(BS.Success)
            )],
          });
          pvpAlertMessages.set(key, sent);
        } catch (err) { console.warn('[pvp] Could not post soon alert:', err?.message); }
      }
    }

    // ── Earliest passed — edit alert to "possibly spawned" ───────────────────
    if (now >= earliest && !pvpAlertedWindow.has(key)) {
      pvpAlertedWindow.add(key);
      const alertMsg = pvpAlertMessages.get(key);
      if (alertMsg) {
        try {
          const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
          await alertMsg.edit({
            content: `🎯 **${entry.name}** may have spawned — check the zone!`,
            embeds: [new EB()
              .setColor(0xffd700)
              .setTitle(`🎯 PVP Possibly Spawned — ${entry.name}`)
              .addFields(
                { name: '⏰ Window Opened', value: `${discordAbsoluteTime(earliest)} (${discordRelativeTime(earliest)})`, inline: true },
                { name: '⏳ Guaranteed By', value: `${discordAbsoluteTime(latest)} (${discordRelativeTime(latest)})`,     inline: true },
              )
              .setFooter({ text: 'Mob may be up — check the zone!' })
              .setTimestamp(),
            ],
            components: [new ARB().addComponents(
              new BB()
                .setCustomId(`pvp_window_spawned:${key}`)
                .setLabel('✅ Mob Spawned')
                .setStyle(BS.Success)
            )],
          });
        } catch (err) { console.warn('[pvp] Could not edit possibly-spawned alert:', err?.message); }
      }
    }

    // ── Spawn window fully open (latest time reached) — auto-clear ──────────
    if (now < latest) continue;
    if (pvpAlertedSpawned.has(key)) continue;
    pvpAlertedSpawned.add(key);

    // Delete kill card from kills thread
    if (killsThreadId && entry.threadMessageId) {
      try {
        const thread = await readyClient.channels.fetch(killsThreadId);
        const msg    = await thread.messages.fetch(entry.threadMessageId);
        await msg.delete();
      } catch { /* already gone */ }
    }

    // Final "definitely spawned" alert — suppress if latest passed long ago (stale post-redeploy)
    const spawnedLongAgo = latest < now - 15 * 60 * 1000;
    if (!spawnedLongAgo && pvpAlertId) {
      try {
        const pvpRoleName = process.env.PVP_ROLE || 'PVP';
        const guild       = readyClient.guilds.cache.first();
        const pvpRole     = guild?.roles.cache.find(r => r.name === pvpRoleName);
        const mention     = pvpRole ? `<@&${pvpRole.id}>` : '';
        const ch          = await readyClient.channels.fetch(pvpAlertId);
        const { EmbedBuilder: EB } = require('discord.js');
        await ch.send({
          content: `${mention}🟢 **${entry.name}** spawn window has fully opened — mob is up!`,
          embeds: [new EB()
            .setColor(0x57f287)
            .setTitle(`🟢 PVP Mob Up — ${entry.name}`)
            .setDescription('Maximum spawn time reached. The mob is definitely available.\nUse `/pvpkill` to start a new timer after you engage.')
            .setTimestamp(),
          ],
        });
      } catch (err) { console.warn('[pvp] Could not post spawned alert:', err?.message); }
    }

    clearPvpKill(key);
    console.log(`🟢 PVP Spawn window closed: ${entry.name}`);
  }
}

// ── Live kill spawn checker ─────────────────────────────────────────────────
async function checkLiveSpawns(readyClient, now) {
  const kills     = getAllLiveKills();
  const channelId = process.env.LIVE_CHANNEL_ID;

  for (const [key, entry] of Object.entries(kills)) {
    if (entry.timerUnknown) continue;

    const toSpawn = entry.nextSpawn - now;

    if (toSpawn > SOON_WARN_MS) {
      liveAlertedSoon.delete(key);
      liveAlertedSpawned.delete(key);
      continue;
    }

    // ── Spawning soon ────────────────────────────────────────────────────────
    if (!liveAlertedSoon.has(key)) {
      liveAlertedSoon.add(key);
      if (channelId) {
        try {
          const { EmbedBuilder: EB } = require('discord.js');
          const ch = await readyClient.channels.fetch(channelId);
          await ch.send({
            content: `⚠️ **${entry.name}** is spawning soon!`,
            embeds: [new EB()
              .setColor(0xffa500)
              .setTitle(`⚠️ Spawning Soon — ${entry.name}`)
              .addFields({ name: 'Spawns', value: `${discordAbsoluteTime(entry.nextSpawn)} (${discordRelativeTime(entry.nextSpawn)})`, inline: false })
              .setTimestamp(),
            ],
          });
        } catch (err) { console.warn('[live] soon alert failed:', err?.message); }
      }
    }

    if (toSpawn > 0) continue;
    if (liveAlertedSpawned.has(key)) continue;
    liveAlertedSpawned.add(key);

    // Delete kill card
    if (channelId && entry.channelMessageId) {
      try {
        const ch  = await readyClient.channels.fetch(channelId);
        const msg = await ch.messages.fetch(entry.channelMessageId);
        await msg.delete();
      } catch { /* already gone */ }
    }

    // Spawned alert
    if (channelId) {
      try {
        const { EmbedBuilder: EB } = require('discord.js');
        const ch = await readyClient.channels.fetch(channelId);
        await ch.send({
          content: `🟢 **${entry.name}** has spawned!`,
          embeds: [new EB()
            .setColor(0x57f287)
            .setTitle(`🟢 Spawned — ${entry.name}`)
            .setDescription('Use `/livekill` or `/livehatekill` to start a new timer after the next kill.')
            .setTimestamp(),
          ],
        });
      } catch (err) { console.warn('[live] spawned alert failed:', err?.message); }
    }

    clearLiveKill(key);
    console.log(`🟢 Live spawn: ${entry.name}`);
  }
}

// ── Midnight tasks ─────────────────────────────────────────────────────────
function scheduleMidnightSummary(readyClient) {
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const channelId       = process.env.TIMER_CHANNEL_ID;
  if (!historyThreadId) { console.warn('⚠️ HISTORIC_KILLS_THREAD_ID not set'); return; }

  function msUntilMidnightEST() {
    return msUntilMidnightInTz(getDefaultTz());
  }

  async function runMidnightTasks() {
    console.log('🕛 Midnight tasks running...');
    try {
      const historyThread = await readyClient.channels.fetch(historyThreadId).catch(() => null);
      const channel       = channelId ? await readyClient.channels.fetch(channelId).catch(() => null) : null;
      if (!historyThread) { console.warn('Cannot fetch historic kills thread'); return; }

      const bosses     = getBosses();
      const killState  = getAllState();
      // Deduplicate daily kills — keep first occurrence of each boss per day
      const seenBosses = new Set();
      const dailyKills = getDailyKills().filter(e => {
        if (seenBosses.has(e.bossId)) return false;
        seenBosses.add(e.bossId);
        return true;
      });
      const now          = Date.now();
      const availableNow = bosses.filter((b) => { const e = killState[b.id]; return !e || e.nextSpawn <= now; });

      // Format date for "Killed <Date>" header
      const dateStr = new Date().toLocaleDateString('en-US', { timeZone: getDefaultTz(), month: 'long', day: 'numeric', year: 'numeric' });
      const summaryEmbed = buildDailySummaryEmbed(dailyKills, availableNow, bosses, dateStr);

      // Update the fixed daily summary slot in main channel (edit in place)
      if (channel) {
        const dailySummaryId = getDailySummaryMessageId();
        if (dailySummaryId) {
          try { const m = await channel.messages.fetch(dailySummaryId); await m.edit({ embeds: [summaryEmbed] }); }
          catch { await channel.send({ embeds: [summaryEmbed] }); }
        } else {
          const m = await channel.send({ embeds: [summaryEmbed] });
          setDailySummaryMessageId(m.id);
        }
      }

      // Archive to historic kills thread
      await historyThread.send({ embeds: [summaryEmbed] });

      // Archive all /announce messages
      if (channel) {
        for (const msgId of getAnnounceMessageIds()) {
          try {
            const msg = await channel.messages.fetch(msgId);
            await historyThread.send({ content: `📋 **Archived announcement**`, embeds: msg.embeds, components: [] });
            await msg.delete();
          } catch (err) { console.warn(`Could not archive announce ${msgId}:`, err?.message); }
        }
      }

      // Delete all spawn alert messages (they get stale at midnight)
      for (const { bossId, messageId } of getAllSpawnAlertMessageIds()) {
        const boss     = bosses.find((b) => b.id === bossId);
        const expansion = boss ? getBossExpansion(boss) : null;
        const threadId  = expansion ? getThreadId(expansion) : null;
        try {
          const targetId = threadId || channelId;
          if (targetId) {
            const ch  = await readyClient.channels.fetch(targetId);
            const msg = await ch.messages.fetch(messageId);
            await msg.delete();
          }
        } catch {}
        clearSpawnAlertMessageId(bossId);
      }

      resetDailyKills();
      clearAnnounceMessageIds();
      clearRaidNight();

      // ── Archive passed announce threads ─────────────────────────────────
      await archivePassedAnnounceThreads(readyClient);

      // ── PVP midnight post ────────────────────────────────────────────────
      await postPvpMidnightSummary(readyClient);

      // ── Archive raid night parse thread ──────────────────────────────────
      await archiveRaidSession(readyClient);

      // ── Consolidate nightly parses ───────────────────────────────────────
      await consolidateNightlyParses(readyClient).catch(console.error);

      // ── Compact Supabase contributions (null out raw_parse blobs > 7 days) ─
      // encounter_players already holds the merged per-player totals permanently.
      // The contributions.raw_parse JSONB blobs are only needed for debugging
      // recent encounters; after 7 days they're just storage cost with no query value.
      // combat_events is intentionally not written to (schema exists for future use).
      try {
        const supabase = require('./utils/supabase');
        if (supabase.isEnabled()) {
          const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const result = await supabase.update(
            'contributions',
            `created_at=lt.${encodeURIComponent(cutoff)}&raw_parse=not.is.null`,
            { raw_parse: null },
          );
          console.log('[midnight] compacted contributions.raw_parse older than 7 days');
        }
      } catch (err) {
        console.warn('[midnight] contribution compaction skipped:', err?.message);
      }

      console.log('✅ Midnight tasks complete');
    } catch (err) { console.error('Midnight task error:', err); }
    setTimeout(runMidnightTasks, msUntilMidnightEST());
  }

  const delay = msUntilMidnightEST();
  console.log(`🕛 Midnight scheduled in ${Math.round(delay / 1000 / 60)} min`);
  setTimeout(runMidnightTasks, delay);
}

// ── Archive passed announce threads at midnight ────────────────────────────
async function archivePassedAnnounceThreads(readyClient) {
  const archiveChannelId = process.env.ARCHIVE_CHANNEL_ID;
  const announces        = getAllAnnounces();
  const now              = Date.now();

  for (const [msgId, data] of Object.entries(announces)) {
    if (!data.plannedTimeMs || data.plannedTimeMs > now) continue; // not yet passed

    // Post summary to Archive channel if configured
    if (archiveChannelId) {
      try {
        const { EmbedBuilder } = require('discord.js');
        const archiveCh = await readyClient.channels.fetch(archiveChannelId);
        const targetNames = (data.targets || [])
          .filter(t => !t.startsWith('_'))
          .map(tid => {
            delete require.cache[require.resolve('./data/bosses.json')];
            const b = require('./data/bosses.json').find(b => b.id === tid);
            return b ? `${b.emoji || '⚔️'} ${b.name}` : tid;
          });

        const embed = new EmbedBuilder()
          .setColor(0x555555)
          .setTitle(`📦 Archived Raid Event — ${data.zone || 'Unknown'}`)
          .addFields(
            { name: 'Planned Time', value: data.plannedTimeStr || 'Unknown', inline: true },
            { name: 'Organizer',    value: data.organizer ? `<@${data.organizer}>` : 'Unknown', inline: true },
            { name: 'Targets',      value: targetNames.length ? targetNames.join(', ') : 'None', inline: false },
          )
          .setTimestamp();
        await archiveCh.send({ embeds: [embed] });
      } catch (err) { console.warn(`archivePassedAnnounceThreads: could not post to archive channel:`, err?.message); }
    }

    // Archive/delete the announce thread
    if (data.threadId) {
      try {
        const thread = await readyClient.channels.fetch(data.threadId);
        if (thread && !thread.archived) {
          await thread.setArchived(true, 'Raid event passed midnight');
        }
      } catch (err) { console.warn(`archivePassedAnnounceThreads: could not archive thread ${data.threadId}:`, err?.message); }
    }

    // Remove from active announces
    removeAnnounce(msgId);
    removeAnnounceMessageId(msgId);
  }
}

// ── Archive raid night parse thread at midnight ───────────────────────────────
async function archiveRaidSession(readyClient) {
  const session = getRaidSession();
  if (!session) return;

  const archiveChannelId = process.env.RAID_MOBS_ARCHIVE_CHANNEL_ID;
  try {
    const thread = await readyClient.channels.fetch(session.threadId).catch(() => null);
    if (thread) {
      await thread.send({ content: `📦 **Archived** — ${session.label}. Parses saved to history.` }).catch(() => {});
      await thread.setArchived(true, 'Raid night ended at midnight').catch(() => {});
    }

    if (archiveChannelId) {
      const archiveCh = await readyClient.channels.fetch(archiveChannelId).catch(() => null);
      if (archiveCh && thread) {
        await archiveCh.send({
          content: `📋 **${session.label}** parse thread archived → <#${session.threadId}>`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[raidnight] archiveRaidSession error:', err?.message);
  }

  clearRaidSession();
}

// ── PVP midnight summary ────────────────────────────────────────────────────
async function postPvpMidnightSummary(readyClient) {
  const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  if (!pvpTargetId) return;
  try {
    const kills     = getAllPvpKills();
    const now       = Date.now();
    const in24h     = now + 24 * 3600000;
    const spawning  = Object.values(kills).filter(e => e.nextSpawn > now && e.nextSpawn <= in24h);
    if (spawning.length === 0) return; // nothing to post

    const { EmbedBuilder } = require('discord.js');
    const { discordAbsoluteTime, discordRelativeTime } = require('./utils/timer');
    const lines = spawning
      .sort((a, b) => a.nextSpawn - b.nextSpawn)
      .map(e => `• **${e.name}** — ${discordAbsoluteTime(e.nextSpawn)} (${discordRelativeTime(e.nextSpawn)})`);

    const embed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setTitle('🗡️ PVP Mobs Spawning Today')
      .setDescription(lines.join('\n'))
      .setTimestamp();

    const ch = await readyClient.channels.fetch(pvpTargetId);
    await ch.send({ embeds: [embed] });
  } catch (err) { console.warn('PVP midnight summary error:', err?.message); }
}

// ── Quake alert checker (runs inside spawn checker interval) ───────────────
async function checkQuakeAlert(readyClient) {
  const quake = getQuake();
  if (!quake || quake.alertPosted) return;

  const remaining = quake.scheduledTime - Date.now();
  if (remaining > 60 * 60 * 1000) return; // more than 1h away — wait
  if (remaining <= 0) { clearQuake(); return; } // already passed

  // Post 1-hour warning
  const { EmbedBuilder } = require('discord.js');
  const { discordAbsoluteTime, discordRelativeTime } = require('./utils/timer');
  const { formatInDefaultTz } = require('./utils/timezone');

  const embed = new EmbedBuilder()
    .setColor(0xff4500)
    .setTitle('⚠️ Quake in ~1 Hour — PVP Mobs Reset Soon!')
    .setDescription(
      `An EverQuest quake is approaching.\nAll PVP mob respawn timers will reset ${discordRelativeTime(quake.scheduledTime)}.`
    )
    .addFields({ name: 'Quake Time', value: `${discordAbsoluteTime(quake.scheduledTime)} (${discordRelativeTime(quake.scheduledTime)})`, inline: false })
    .setTimestamp();

  const pvpTargetId = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;
  const pvpRoleName = process.env.PVP_ROLE || 'PVP';

  try {
    const guild   = readyClient.guilds.cache.first();
    const roleObj = guild?.roles.cache.find(r => r.name === pvpRoleName);
    const mention = roleObj ? `<@&${roleObj.id}>` : null;

    if (pvpTargetId) {
      const ch = await readyClient.channels.fetch(pvpTargetId);
      const m  = await ch.send({ content: mention || undefined, embeds: [embed] });
      saveQuake({ ...quake, alertPosted: true, alertMessageId: m.id });
    }
  } catch (err) { console.warn('Quake alert error:', err?.message); }
}

// ── Nightly parse consolidation ────────────────────────────────────────────────
async function consolidateNightlyParses(client) {
  const { loadParses, saveParses, logParseToDiscord } = require('./commands/parse');
  const { groupKillsBySession, mergeKillGroup }        = require('./commands/parsestats');

  const allParses = loadParses();
  const now       = Date.now();
  const since24h  = now - 24 * 60 * 60 * 1000;

  let consolidated = false;

  for (const [bossId, kills] of Object.entries(allParses)) {
    // Only look at kills from the last 24 hours
    const recent = kills.filter(k => k.timestamp >= since24h);
    if (recent.length === 0) continue;

    // Group by 10-minute session windows
    const groups = groupKillsBySession(recent, 10 * 60 * 1000);

    const newKills = [...kills.filter(k => k.timestamp < since24h)]; // keep older kills untouched

    for (const group of groups) {
      if (group.length <= 1) {
        // Single submission — keep as-is
        newKills.push(...group);
        continue;
      }

      // Multiple submissions in same session window — merge them
      const merged = mergeKillGroup(group);

      // Delete individual Discord log messages for entries in this group
      const logThreadId = process.env.PARSES_LOG_THREAD_ID;
      if (logThreadId) {
        const logThread = await client.channels.fetch(logThreadId).catch(() => null);
        if (logThread) {
          for (const entry of group) {
            if (entry.discordMsgId) {
              try {
                const msg = await logThread.messages.fetch(entry.discordMsgId);
                await msg.delete();
              } catch {}
            }
          }
        }
      }

      // Use one of the existing entries as the base for the merged parse entry
      const canonical = group.reduce((best, k) => k.totalDamage > best.totalDamage ? k : best, group[0]);
      const mergedEntry = {
        timestamp:       merged.timestamp,
        submittedBy:     canonical.submittedBy || null,
        submittedByName: canonical.submittedByName || 'consolidated',
        duration:        merged.duration,
        totalDamage:     merged.totalDamage,
        totalDps:        merged.duration > 0 ? Math.round(merged.totalDamage / merged.duration) : 0,
        players:         merged.players,
        discordMsgId:    null, // will be set after logging
      };

      // Post ONE consolidated log entry
      const msg = await logParseToDiscord(client, bossId, mergedEntry).catch(() => null);
      if (msg?.id) mergedEntry.discordMsgId = msg.id;

      newKills.push(mergedEntry);
      consolidated = true;
    }

    allParses[bossId] = newKills;
  }

  if (consolidated) {
    saveParses(allParses);
    console.log('[consolidate] Nightly parse consolidation complete');
  } else {
    console.log('[consolidate] No parse groups to consolidate');
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────
// Health check (Railway proxy needs an HTTP listener) + endpoints for the
// wolfpack-logsync local agent.
const http = require('http');

async function _handleAgentUpload(req, res) {
  // Auth: shared-secret bearer token. WOLFPACK_AGENT_TOKEN must be set.
  const expected = process.env.WOLFPACK_AGENT_TOKEN;
  if (!expected) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'agent uploads disabled (WOLFPACK_AGENT_TOKEN unset)' }));
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${expected}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  // Read body (cap at 10MB for safety; encounters are typically <1MB)
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 10 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'payload too large' }));
    }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid JSON' }));
  }

  // Shape: { agent_version, character, encounter: { started_at, ended_at, boss_name, events: [...] } }
  const { character, encounter } = payload || {};
  if (!encounter || !Array.isArray(encounter.events)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'missing encounter.events' }));
  }

  // Server-side noise guard (agent already filters these, but defend in depth).
  // "YOU" means the player was identified as the primary target — received damage, no real mob.
  // null/empty boss_name with few events = background noise or all-heal encounter.
  const bossNameRaw = (encounter.boss_name || '').trim();
  if (/^you$/i.test(bossNameRaw) || (!bossNameRaw && encounter.events.length < 20)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, skipped: 'noise encounter' }));
  }

  console.log(`[agent] upload from ${character || '?'}: ${encounter.events.length} events, ` +
              `boss=${encounter.boss_name || '?'}, started=${encounter.started_at}`);

  // ── Compute damage totals once (used by both parses.json and Supabase paths) ──
  // Filter out noise before aggregating:
  //   - "Eye of PLAYERNAME" — wizard/mage scout pets that attack your target (not player DPS)
  //   - Cannibalize self-hits — shaman HP→mana conversion logged as self-damage
  //
  // IMPORTANT: events from the uploading character's OWN perspective (melee, spells,
  // DoTs, archery) are parsed by the agent as attacker=null ("self / first person").
  // We re-attribute those to `character` so their damage isn't silently dropped.
  const playerTotals = new Map();
  for (const ev of encounter.events) {
    if (ev.type !== 'damage') continue;
    const rawAttacker = ev.attacker;
    // Re-attribute first-person (null) events to the uploading character
    const attacker = rawAttacker ?? character ?? null;
    if (!attacker) continue;
    if (/^Eye of /i.test(attacker)) continue;                                                    // skip Eye of X pets
    if (ev.spell && /cannibali[sz]e/i.test(ev.spell) && rawAttacker === ev.target) continue;    // skip self-cannibalizes
    playerTotals.set(attacker, (playerTotals.get(attacker) || 0) + (ev.amount || 0));
  }
  const startedMs = encounter.started_at ? new Date(encounter.started_at).getTime() : Date.now();
  const endedMs   = encounter.ended_at   ? new Date(encounter.ended_at).getTime()   : startedMs;
  const duration  = Math.max(0, Math.round((endedMs - startedMs) / 1000));
  const players = [...playerTotals.entries()]
    .map(([name, dmg]) => ({
      name,
      damage:   dmg,
      duration,
      dps:      duration > 0 ? Math.round(dmg / duration) : 0,
      hasPets:  false,
    }))
    .sort((a, b) => b.damage - a.damage)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  const totalDamage = players.reduce((s, p) => s + p.damage, 0);
  const totalDps    = duration > 0 ? Math.round(totalDamage / duration) : 0;

  // ── Accumulate into active /raidnight session (all encounters, not just bosses) ──
  // sessionDamage lives inside raidSession in state.json — clears at midnight with the session.
  if (players.length > 0) {
    try { accumulateSessionDamage(players, duration); } catch (e) { /* non-fatal */ }
  }

  // ── Match boss against bosses.json, then mirror /parse instance behavior:
  //    write to parses.json, record the kill, update the board ─────────────────
  let matchedBoss = null;
  try {
    if (encounter.boss_name) {
      const { findBossFromName, loadParses, saveParses, logParseToDiscord } = require('./commands/parse');
      matchedBoss = findBossFromName(encounter.boss_name, getBosses());

      if (matchedBoss) {
        const parseEntry = {
          timestamp:       startedMs,
          submittedBy:     `agent:${character || 'unknown'}`,
          submittedByName: character || 'Agent',
          duration,
          totalDamage,
          totalDps,
          players,
          parseType:       'instance',
          source:          'wolfpack_agent',
          discordMsgId:    null,
        };

        // Append to parses.json so /parsestats sees the upload
        const parses = loadParses();
        if (!parses[matchedBoss.id]) parses[matchedBoss.id] = [];
        parses[matchedBoss.id].push(parseEntry);
        saveParses(parses);

        // Persist to Discord thread for survival across restarts
        logParseToDiscord(client, matchedBoss.id, parseEntry).then(msg => {
          if (msg?.id) {
            const p2 = loadParses();
            if (p2[matchedBoss.id]) {
              const idx = p2[matchedBoss.id].findIndex(e =>
                e.timestamp === parseEntry.timestamp && e.submittedBy === parseEntry.submittedBy);
              if (idx !== -1) { p2[matchedBoss.id][idx].discordMsgId = msg.id; saveParses(p2); }
            }
          }
        }).catch(err => console.warn('[agent] Discord log failed:', err?.message));

        // Auto-record kill if boss isn't already on cooldown
        const { getBossState, recordKill } = require('./utils/state');
        const { postKillUpdate } = require('./utils/killops');
        const bossState = getBossState(matchedBoss.id);
        const now = Date.now();
        if (!bossState || !bossState.killedAt || bossState.nextSpawn <= now) {
          recordKill(matchedBoss.id, matchedBoss.timerHours, null);
          postKillUpdate(client, process.env.TIMER_CHANNEL_ID, matchedBoss.id).catch(console.warn);
          console.log(`[agent] auto-killed ${matchedBoss.name} from ${character || '?'} agent upload`);
        } else {
          console.log(`[agent] ${matchedBoss.name} already on cooldown — parse recorded, no timer change`);
        }
      } else {
        console.log(`[agent] no bosses.json match for "${encounter.boss_name}" — parse not stored locally`);
      }
    }
  } catch (err) {
    console.warn('[agent] local parse write failed:', err?.message);
  }

  // ── Best-effort Supabase write. Falls through silently if Supabase isn't set up ──
  try {
    const supabase = require('./utils/supabase');
    if (supabase.isEnabled() && encounter.boss_name) {
      const rawParse = {
        bossName:   encounter.boss_name,
        duration,
        totalDamage,
        totalDps,
        players,
        eventCount: encounter.events.length,
      };

      // Prefer the bossId from bosses.json match; fall back to slugified name lookup
      const slug = (encounter.boss_name || '').toLowerCase().replace(/\W+/g, '_');
      const bossInternalId = matchedBoss?.id || slug;
      const localMatches = await supabase.select(
        'bosses_local',
        `internal_id=eq.${encodeURIComponent(bossInternalId)}&select=internal_id&limit=1`
      );
      if (Array.isArray(localMatches) && localMatches.length) {
        await supabase.recordParse({
          bossInternalId,
          parsed: rawParse,
          timestampMs: startedMs,
          contributorDiscordId: null,
          contributorCharacter: character || null,
          source: 'local_agent_v1',
        }).catch(err => console.warn('[agent] recordParse failed:', err?.message));
      } else {
        console.log(`[agent] no bosses_local match for "${bossInternalId}" — encounter not persisted to Supabase`);
      }
    }
  } catch (err) {
    console.warn('[agent] supabase write failed:', err?.message);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    events_received: encounter.events.length,
    matched_boss:    matchedBoss?.id || null,
  }));
}

http.createServer(async (req, res) => {
  // Agent upload endpoint
  if (req.method === 'POST' && req.url === '/api/agent/encounter') {
    try { return await _handleAgentUpload(req, res); }
    catch (err) {
      console.error('[agent] handler error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'internal error' }));
    }
  }

  // Default: health check
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
})
  .listen(process.env.PORT || 3000, () =>
    console.log(`[health] HTTP check + agent endpoint on :${process.env.PORT || 3000}`)
  );

client.login(process.env.DISCORD_TOKEN);
