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
  getRaidSession, clearRaidSession,
} = require('./utils/state');
const { getDefaultTz, msUntilMidnightInTz } = require('./utils/timezone');
const {
  buildZoneKillCard, buildSpawnAlertEmbed, buildSpawnedEmbed,
  buildDailySummaryEmbed,
} = require('./utils/embeds');
const {
  postKillUpdate, postOrUpdateExpansionBoard,
} = require('./utils/killops');
const { hasAllowedRole, allowedRolesList } = require('./utils/roles');
const { EXPANSION_ORDER, getThreadId, getBossExpansion } = require('./utils/config');

function getBosses() {
  delete require.cache[require.resolve('./data/bosses.json')];
  return require('./data/bosses.json');
}

// ── Client ─────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

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
  const { loadParsesFromDiscord }  = require('./commands/parse');
  const { loadRosterFromDiscord }  = require('./utils/roster');
  const { runAutoRestore }         = require('./commands/restore');
  const { runBoard }               = require('./commands/board');
  const { runCleanup }             = require('./commands/cleanup');

  await loadOnboardingData(readyClient).catch(err => console.warn('[startup] loadOnboardingData:', err?.message));
  await postOrUpdateInstructions(readyClient).catch(err => console.warn('[startup] postOrUpdateInstructions:', err?.message));
  await loadParsesFromDiscord(readyClient).catch(err => console.warn('[startup] loadParsesFromDiscord:', err?.message));
  await loadRosterFromDiscord(readyClient).catch(err => console.warn('[startup] loadRosterFromDiscord:', err?.message));
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
    if (interaction.customId === 'cancel_announce')             { await handleCancelAnnounce(interaction); return; }
    if (interaction.customId.startsWith('cancel_event_thread:')){ await handleCancelEventThread(interaction); return; }
    if (interaction.customId.startsWith('remove_target:'))      { await handleRemoveTargetButton(interaction); return; }
    if (interaction.customId === 'pvprole_toggle')              { await handlePvpRoleToggle(interaction, false); return; }
    if (interaction.customId === 'pvprole_toggle_silent')       { await handlePvpRoleToggle(interaction, true); return; }
    if (interaction.customId.startsWith('pvpalert_howl:'))      { await handlePvpAlertHowl(interaction); return; }
    if (interaction.customId.startsWith('pvp_spawn_alert:'))    { await handlePvpSpawnAlert(interaction); return; }
    if (interaction.customId === 'onb_pvp')                     { await handleOnbPvp(interaction); return; }
    if (interaction.customId === 'onb_organizer')               { await handleOnbOrganizer(interaction); return; }
    if (interaction.customId === 'onb_attend')                  { await handleOnbAttend(interaction); return; }
    if (interaction.customId.startsWith('onb_ignore:'))         { await handleOnbIgnore(interaction); return; }
    if (interaction.customId === 'onb_show_again')              { await handleOnbShowAgain(interaction); return; }
    if (interaction.customId.startsWith('parse_breakdown:')) {
      const { handleParseBreakdown } = require('./commands/parse');
      await handleParseBreakdown(interaction).catch(console.error);
      return;
    }
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
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

  // Defer immediately so Discord doesn't time out while we do async work
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const killState  = getAllState();
  const existing   = killState[bossId];
  const now        = Date.now();
  const expansion  = getBossExpansion(boss);
  const threadId   = getThreadId(expansion);

  if (existing && existing.nextSpawn > now) {
    // Unkill
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
  }
  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
}

// ── Cancel announce button ─────────────────────────────────────────────────
async function handleCancelAnnounce(interaction) {
  if (!hasAllowedRole(interaction.member))
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
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
    buildControlPanelEmbed, buildTargetButtons, buildCancelRow, EASTER_EGG_CHAIN,
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
    const targetRows     = buildTargetButtons(freshAnnounce.targets, bosses);
    const cancelRow      = buildCancelRow(announce.messageId);
    await interaction.message.edit({ embeds: [cpEmbed], components: [...targetRows, cancelRow] });
  } catch (err) { console.warn('remove_target button: could not refresh panel:', err?.message); }

  await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ Target removed.${extra}` });
}

// ── Welcome card ──────────────────────────────────────────────────────────
const { EmbedBuilder: _EB, ActionRowBuilder: _ARB, ButtonBuilder: _BB, ButtonStyle: _BS } = require('discord.js');

function buildWelcomeEmbed() {
  return new _EB()
    .setColor(0x5865f2)
    .setTitle('🐺 Welcome to the Wolf Pack Raid Tracker!')
    .setDescription(
      'This bot keeps the pack coordinated across three pillars. Hit a button below to tell us how you\'d like to run with the pack.'
    )
    .addFields(
      {
        name: '⚔️ Accountability',
        value: 'When you kill a boss, click its button on the board. That logs the kill and starts the respawn countdown — accurate tracking means the whole pack knows when to be ready.',
        inline: false,
      },
      {
        name: '⏰ Timing',
        value: 'The board and the **Spawning in the Next 24 Hours** card show exactly when each boss is back up. Never miss a window because no one wrote it down.',
        inline: false,
      },
      {
        name: '📣 Coordination',
        value: 'Use `/announce` to schedule a group takedown — it creates a thread, a Discord event, and rallies the pack. Use `/pvpalert` to howl for backup right now.',
        inline: false,
      },
    )
    .setFooter({ text: 'You can always run /raidbosshelp for a full command reference.' });
}

function buildWelcomeRow() {
  return new _ARB().addComponents(
    new _BB().setCustomId('welcome_pvp').setLabel('🐺 Count me in for PVP').setStyle(_BS.Danger),
    new _BB().setCustomId('welcome_organizer').setLabel('📣 I want to help organize').setStyle(_BS.Primary),
    new _BB().setCustomId('welcome_attendee').setLabel('🎯 Just here to attend').setStyle(_BS.Secondary),
  );
}

async function maybeShowWelcome(interaction) {
  if (hasSeenWelcome(interaction.user.id)) return;
  markWelcomeSeen(interaction.user.id);
  try {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildWelcomeEmbed()],
      components: [buildWelcomeRow()],
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

// ── Spawn checker ──────────────────────────────────────────────────────────
const alertedSoon = new Set(), alertedSpawned = new Set();
const pvpAlertedSpawned = new Set();

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
  const kills          = getAllPvpKills();
  const killsThreadId  = process.env.PVP_KILLS_THREAD_ID;
  const pvpAlertId     = process.env.PVP_THREAD_ID || process.env.PVP_CHANNEL_ID;

  for (const [key, entry] of Object.entries(kills)) {
    const remaining = entry.nextSpawn - now;

    if (remaining > 0) { pvpAlertedSpawned.delete(key); continue; }
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

    // Alert in PVP channel/thread
    if (pvpAlertId) {
      try {
        const pvpRoleName = process.env.PVP_ROLE || 'PVP';
        const guild       = readyClient.guilds.cache.first();
        const pvpRole     = guild?.roles.cache.find(r => r.name === pvpRoleName);
        const mention     = pvpRole ? `<@&${pvpRole.id}> ` : '';
        const ch          = await readyClient.channels.fetch(pvpAlertId);

        const { EmbedBuilder } = require('discord.js');
        await ch.send({
          content: `${mention}🟢 **${entry.name}** has respawned!`,
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle(`🟢 PVP Mob Spawned — ${entry.name}`)
              .setDescription('The mob has respawned and is available. Use `/pvpkill` to start a new timer after you engage.')
              .setTimestamp(),
          ],
        });
      } catch (err) {
        console.warn('[pvp] Could not post spawn alert:', err?.message);
      }
    }

    clearPvpKill(key);
    console.log(`🟢 PVP Spawned: ${entry.name}`);
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

      // ── Archive passed announce threads ─────────────────────────────────
      await archivePassedAnnounceThreads(readyClient);

      // ── PVP midnight post ────────────────────────────────────────────────
      await postPvpMidnightSummary(readyClient);

      // ── Archive raid night parse thread ──────────────────────────────────
      await archiveRaidSession(readyClient);

      // ── Consolidate nightly parses ───────────────────────────────────────
      await consolidateNightlyParses(readyClient).catch(console.error);

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
      // Post archive notice in the thread itself
      await thread.send({ content: `📦 **Archived** — ${session.label}. Parses saved to history.` }).catch(() => {});
      // Archive (lock) the Discord thread
      await thread.setArchived(true, 'Raid night ended at midnight').catch(() => {});
    }

    // Post a link in the archive channel if configured
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

// ── Archive raid night parse thread at midnight ───────────────────────────────
async function archiveRaidSession(readyClient) {
  const { getRaidSession, clearRaidSession } = require('./utils/state');
  const session = getRaidSession();
  if (!session) return;

  const archiveChannelId = process.env.RAID_MOBS_ARCHIVE_CHANNEL_ID;
  try {
    const thread = await readyClient.channels.fetch(session.threadId).catch(() => null);
    if (thread) {
      // Post archive notice in the thread itself
      await thread.send({ content: `📦 **Archived** — ${session.label}. Parses saved to history.` }).catch(() => {});
      // Archive (lock) the Discord thread
      await thread.setArchived(true, 'Raid night ended at midnight').catch(() => {});
    }

    // Post a link in the archive channel if configured
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

// ── Health check server ───────────────────────────────────────────────────────
// Railway's proxy times out idle connections (including Discord's WebSocket) if
// there is no HTTP listener. This tiny server satisfies the health check.
const http = require('http');
http.createServer((_, res) => { res.writeHead(200); res.end('OK'); })
  .listen(process.env.PORT || 3000, () =>
    console.log(`[health] HTTP check on :${process.env.PORT || 3000}`)
  );

client.login(process.env.DISCORD_TOKEN);
