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
  getExpansionBoard, saveExpansionBoard,
  getSummaryMessageId, setSummaryMessageId,
  getDailyKills, resetDailyKills,
  getAnnounceMessageIds, removeAnnounceMessageId, clearAnnounceMessageIds,
} = require('./utils/state');
const { buildZoneKillCard, buildSpawnAlertEmbed, buildSpawnedEmbed, buildDailySummaryEmbed, buildSummaryCard } = require('./utils/embeds');
const { buildExpansionPanels } = require('./utils/board');
const { postKillUpdate, postOrUpdateExpansionBoard, refreshSummaryCard } = require('./utils/killops');
const { hasAllowedRole, allowedRolesList } = require('./utils/roles');
const { EXPANSION_ORDER, EXPANSION_META, getThreadId, getBossExpansion } = require('./utils/config');

function getBosses() {
  delete require.cache[require.resolve('./data/bosses.json')];
  return require('./data/bosses.json');
}

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── Load commands ─────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js')).forEach((file) => {
  const cmd = require(path.join(commandsPath, file));
  if (cmd.data && cmd.execute) { client.commands.set(cmd.data.name, cmd); console.log(`Loaded: /${cmd.data.name}`); }
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  const bosses = getBosses();
  console.log(`✅ Logged in as ${readyClient.user.tag} | ${bosses.length} bosses`);
  await registerCommands();
  startSpawnChecker(readyClient);
  scheduleMidnightSummary(readyClient);
});

// ── Register commands ─────────────────────────────────────────────────────────
async function registerCommands() {
  const guildId = process.env.DISCORD_GUILD_ID, clientId = process.env.DISCORD_CLIENT_ID;
  if (!guildId || !clientId) { console.warn('⚠️  Missing DISCORD_GUILD_ID or DISCORD_CLIENT_ID'); return; }
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    const data = [...client.commands.values()].map((c) => c.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: data });
    console.log(`✅ Registered ${data.length} commands`);
  } catch (err) { console.error('❌ Command registration failed:', err?.message); }
}

// ── Interactions ──────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) { try { await cmd.autocomplete(interaction); } catch (e) { console.error(e); } }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('kill:'))     { await handleBoardButton(interaction); return; }
    if (interaction.customId === 'cancel_announce')   { await handleCancelAnnounce(interaction); return; }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try { await cmd.execute(interaction); }
  catch (err) {
    console.error(`/${interaction.commandName} error:`, err);
    const msg = { flags: MessageFlags.Ephemeral, content: '❌ An error occurred.' };
    interaction.replied || interaction.deferred ? await interaction.followUp(msg) : await interaction.reply(msg);
  }
});

// ── Board button (kill / unkill toggle) ───────────────────────────────────────
async function handleBoardButton(interaction) {
  const bossId = interaction.customId.replace('kill:', '');
  const bosses = getBosses();
  const boss   = bosses.find((b) => b.id === bossId);
  if (!boss) return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Unknown boss.' });

  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
  }

  const existing = getAllState()[bossId];
  const now      = Date.now();

  if (existing && existing.nextSpawn > now) {
    // Unkill
    clearKill(bossId);
    const killState  = getAllState();
    const stillKilled = bosses.filter((b) => b.zone === boss.zone && killState[b.id] && killState[b.id].nextSpawn > now);
    const zoneCard   = getZoneCard(boss.zone);
    const expansion  = getBossExpansion(boss);
    const threadId   = getThreadId(expansion);

    if (zoneCard) {
      try {
        const targetCh = await interaction.client.channels.fetch(zoneCard.threadId || interaction.channelId);
        if (stillKilled.length > 0) {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));
          const msg = await targetCh.messages.fetch(zoneCard.messageId);
          await msg.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
        } else {
          const msg = await targetCh.messages.fetch(zoneCard.messageId);
          await msg.delete(); clearZoneCard(boss.zone);
        }
      } catch { clearZoneCard(boss.zone); }
    }

    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `↩️ Kill record cleared for **${boss.name}**.` });
  } else {
    // Kill
    recordKill(bossId, boss.timerHours, interaction.user.id);
    const killState    = getAllState();
    const zoneBosses   = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses.filter((b) => killState[b.id] && killState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));

    const embed     = buildZoneKillCard(boss.zone, killedInZone);
    const expansion = getBossExpansion(boss);
    const threadId  = getThreadId(expansion);
    const zoneCard  = getZoneCard(boss.zone);

    if (zoneCard) {
      try {
        const targetCh = await interaction.client.channels.fetch(zoneCard.threadId || interaction.channelId);
        const msg = await targetCh.messages.fetch(zoneCard.messageId);
        await msg.edit({ embeds: [embed] });
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ **${boss.name}** kill recorded.` });
      } catch {
        if (threadId) {
          const thread = await interaction.client.channels.fetch(threadId);
          const sent   = await thread.send({ embeds: [embed] });
          setZoneCard(boss.zone, sent.id, threadId);
        }
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ **${boss.name}** kill recorded.` });
      }
    } else if (threadId) {
      const thread = await interaction.client.channels.fetch(threadId);
      const sent   = await thread.send({ embeds: [embed] });
      setZoneCard(boss.zone, sent.id, threadId);
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ **${boss.name}** kill recorded in <#${threadId}>.` });
    } else {
      const { resource } = await interaction.reply({ embeds: [embed], withResponse: true });
      setZoneCard(boss.zone, resource.message.id, null);
    }
  }

  await postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
}

// ── Cancel announce button ────────────────────────────────────────────────────
async function handleCancelAnnounce(interaction) {
  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });
  }

  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const origMsg         = interaction.message;

  try {
    if (historyThreadId) {
      const thread = await interaction.client.channels.fetch(historyThreadId);
      await thread.send({
        content: `📋 **Cancelled announcement** (archived by <@${interaction.user.id}>)`,
        embeds: origMsg.embeds,
      });
    }
    await origMsg.delete();
    removeAnnounceMessageId(origMsg.id);
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: '✅ Announcement cancelled and archived.' });
  } catch (err) {
    console.error('handleCancelAnnounce error:', err);
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ Could not archive the announcement.' });
  }
}

// ── Spawn checker ─────────────────────────────────────────────────────────────
const alertedSoon = new Set(), alertedSpawned = new Set();

function startSpawnChecker(readyClient) {
  const channelId       = process.env.TIMER_CHANNEL_ID;
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  if (!channelId) { console.warn('⚠️  TIMER_CHANNEL_ID not set'); return; }

  setInterval(async () => {
    try {
      const bosses        = getBosses();
      const channel       = await readyClient.channels.fetch(channelId);
      const historyThread = historyThreadId ? await readyClient.channels.fetch(historyThreadId).catch(() => null) : null;
      const state = getAllState(), now = Date.now();

      for (const boss of bosses) {
        const entry = state[boss.id];
        if (!entry) continue;
        const remaining = entry.nextSpawn - now;

        if (remaining <= 0 && !alertedSpawned.has(boss.id)) {
          alertedSpawned.add(boss.id);
          alertedSoon.delete(boss.id);

          // Archive and remove zone card
          await archiveZoneCardEntry(readyClient, boss, bosses, state, historyThread);

          // Post spawned alert to expansion thread if available, else main channel
          const expansion = getBossExpansion(boss);
          const threadId  = getThreadId(expansion);
          const target    = threadId ? await readyClient.channels.fetch(threadId).catch(() => channel) : channel;
          await target.send({ embeds: [buildSpawnedEmbed(boss)] });

          clearKill(boss.id);
          await postKillUpdate(readyClient, channelId, boss.id).catch(console.warn);
          console.log(`Spawned: ${boss.name}`);
          continue;
        }

        if (remaining > 30 * 60 * 1000) { alertedSpawned.delete(boss.id); alertedSoon.delete(boss.id); }

        if (remaining > 0 && remaining <= 30 * 60 * 1000 && !alertedSoon.has(boss.id)) {
          alertedSoon.add(boss.id);
          const expansion = getBossExpansion(boss);
          const threadId  = getThreadId(expansion);
          const target    = threadId ? await readyClient.channels.fetch(threadId).catch(() => channel) : channel;
          await target.send({ embeds: [buildSpawnAlertEmbed(boss)] });
          console.log(`30min warning: ${boss.name}`);
        }
      }
    } catch (err) { console.error('Spawn checker error:', err); }
  }, 5 * 60 * 1000);

  console.log('Spawn checker started');
}

async function archiveZoneCardEntry(readyClient, spawnedBoss, bosses, state, historyThread) {
  const zoneCard = getZoneCard(spawnedBoss.zone);
  if (!zoneCard) return;
  try {
    const targetCh = await readyClient.channels.fetch(zoneCard.threadId || process.env.TIMER_CHANNEL_ID);
    const cardMsg  = await targetCh.messages.fetch(zoneCard.messageId);

    if (historyThread) {
      const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' });
      await historyThread.send({ content: `📦 **${spawnedBoss.name}** (${spawnedBoss.zone}) respawned at ${now}`, embeds: cardMsg.embeds });
    }

    const now         = Date.now();
    const stillOnTimer = bosses.filter((b) => b.zone === spawnedBoss.zone && b.id !== spawnedBoss.id && state[b.id] && state[b.id].nextSpawn > now + 5000);
    if (stillOnTimer.length > 0) {
      const killedInZone = stillOnTimer.map((b) => ({ boss: b, entry: state[b.id], killedBy: state[b.id].killedBy }));
      await cardMsg.edit({ embeds: [buildZoneKillCard(spawnedBoss.zone, killedInZone)] });
    } else {
      await cardMsg.delete();
      clearZoneCard(spawnedBoss.zone);
    }
  } catch (err) { console.warn(`archiveZoneCardEntry (${spawnedBoss.name}):`, err?.message); }
}

// ── Midnight tasks ────────────────────────────────────────────────────────────
function scheduleMidnightSummary(readyClient) {
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const channelId       = process.env.TIMER_CHANNEL_ID;
  if (!historyThreadId) { console.warn('⚠️  HISTORIC_KILLS_THREAD_ID not set — midnight summary disabled'); return; }

  function msUntilMidnightEST() {
    const est = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const m   = new Date(est); m.setHours(24, 0, 0, 0); return m - est;
  }

  async function runMidnightTasks() {
    console.log('Running midnight tasks...');
    try {
      const historyThread = await readyClient.channels.fetch(historyThreadId).catch(() => null);
      const channel       = channelId ? await readyClient.channels.fetch(channelId).catch(() => null) : null;
      if (!historyThread) { console.warn('Could not fetch historic kills thread'); return; }

      const bosses       = getBosses();
      const dailyKills   = getDailyKills();
      const killState    = getAllState();
      const now          = Date.now();
      const availableNow = bosses.filter((b) => { const e = killState[b.id]; return !e || e.nextSpawn <= now; });

      // Daily summary at TOP of channel (send to main channel, not just thread)
      const summaryEmbed = buildDailySummaryEmbed(dailyKills, availableNow, bosses);
      if (channel) await channel.send({ embeds: [summaryEmbed] });
      await historyThread.send({ embeds: [summaryEmbed] });

      // Archive announce messages
      if (channel) {
        for (const msgId of getAnnounceMessageIds()) {
          try {
            const msg = await channel.messages.fetch(msgId);
            await historyThread.send({ content: `📋 **Archived announcement**`, embeds: msg.embeds, components: [] });
            await msg.delete();
          } catch (err) { console.warn(`Could not archive announce ${msgId}:`, err?.message); }
        }
      }

      resetDailyKills();
      clearAnnounceMessageIds();
      console.log('Midnight tasks complete');
    } catch (err) { console.error('Midnight task error:', err); }
    setTimeout(runMidnightTasks, msUntilMidnightEST());
  }

  const delay = msUntilMidnightEST();
  console.log(`Midnight summary in ${Math.round(delay / 1000 / 60)} min`);
  setTimeout(runMidnightTasks, delay);
}

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
