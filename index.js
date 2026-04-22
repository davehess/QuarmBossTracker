// index.js — Quarm Raid Timer Bot

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
  MessageFlags,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const {
  getAllState, recordKill, clearKill,
  getZoneCard, setZoneCard, clearZoneCard,
  getBoardMessages, saveBoardMessages,
  getDailyKills, resetDailyKills,
  getAnnounceMessageIds, clearAnnounceMessageIds,
} = require('./utils/state');
const { buildZoneKillCard, buildSpawnAlertEmbed, buildSpawnedEmbed, buildDailySummaryEmbed } = require('./utils/embeds');
const { buildBoardPanels } = require('./utils/board');
const { hasAllowedRole, allowedRolesList } = require('./utils/roles');

const BOARD_ANCHOR_TITLE = '⚔️ Classic EverQuest';

function getBosses() {
  delete require.cache[require.resolve('./data/bosses.json')];
  return require('./data/bosses.json');
}

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── Load commands ─────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
fs.readdirSync(commandsPath)
  .filter((f) => f.endsWith('.js'))
  .forEach((file) => {
    const cmd = require(path.join(commandsPath, file));
    if (cmd.data && cmd.execute) {
      client.commands.set(cmd.data.name, cmd);
      console.log(`Loaded: /${cmd.data.name}`);
    }
  });

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  const bosses = getBosses();
  console.log(`✅ Logged in as ${readyClient.user.tag} | ${bosses.length} bosses`);
  await registerCommands();
  await reAnchorBoard(readyClient);
  startSpawnChecker(readyClient);
  scheduleMidnightSummary(readyClient);
});

// ── Re-anchor board on startup ────────────────────────────────────────────────
// After a redeploy, state.json board IDs may be stale. Scan the channel and
// lock onto the earliest board set so /board edits the right messages.
async function reAnchorBoard(readyClient) {
  const channelId = process.env.TIMER_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel   = await readyClient.channels.fetch(channelId);
    const bosses    = getBosses();
    const killState = getAllState();
    const panels    = buildBoardPanels(bosses, killState);
    const botId     = readyClient.user.id;

    // Fetch channel history to find earliest board
    let allMessages = [];
    let lastId = null;
    for (let i = 0; i < 10; i++) {
      const opts = { limit: 50 };
      if (lastId) opts.before = lastId;
      const batch = await channel.messages.fetch(opts);
      if (batch.size === 0) break;
      allMessages = allMessages.concat([...batch.values()]);
      lastId = batch.last().id;
    }

    const botMsgs = allMessages
      .filter((m) => m.author.id === botId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const startIdx = botMsgs.findIndex((m) =>
      m.embeds.some((e) => e.title === BOARD_ANCHOR_TITLE)
    );

    if (startIdx === -1) {
      console.log('No existing board found in channel — will post on first /board');
      return;
    }

    const boardMsgs = botMsgs.slice(startIdx, startIdx + panels.length);
    const newIds    = boardMsgs.map((m, i) => ({ messageId: m.id, panelIndex: i }));

    const currentIds = getBoardMessages();
    const firstCurrentId = currentIds[0]?.messageId;

    if (firstCurrentId !== newIds[0]?.messageId) {
      saveBoardMessages(newIds);
      console.log(`Re-anchored board to ${newIds[0]?.messageId} (${newIds.length} panels)`);
    } else {
      console.log(`Board anchor confirmed: ${newIds[0]?.messageId}`);
    }
  } catch (err) {
    console.warn('reAnchorBoard error:', err?.message);
  }
}

// ── Register slash commands ───────────────────────────────────────────────────
async function registerCommands() {
  const guildId  = process.env.DISCORD_GUILD_ID;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!guildId || !clientId) { console.warn('⚠️  Missing DISCORD_GUILD_ID or DISCORD_CLIENT_ID'); return; }
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    const data = [...client.commands.values()].map((c) => c.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: data });
    console.log(`✅ Registered ${data.length} commands`);
  } catch (err) {
    console.error('❌ Command registration failed:', err?.message);
  }
}

// ── Interaction handler ───────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) { try { await cmd.autocomplete(interaction); } catch (e) { console.error(e); } }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('kill:')) await handleBoardButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} error:`, err);
    const msg = { flags: MessageFlags.Ephemeral, content: '❌ An error occurred.' };
    interaction.replied || interaction.deferred ? await interaction.followUp(msg) : await interaction.reply(msg);
  }
});

// ── Board button handler — toggle kill / unkill ───────────────────────────────
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

  // ── Already killed → unkill ───────────────────────────────────────────────
  if (existing && existing.nextSpawn > now) {
    clearKill(bossId);

    // Update zone card
    const killState  = getAllState();
    const zoneBosses = bosses.filter((b) => b.zone === boss.zone);
    const stillKilled = zoneBosses.filter((b) => killState[b.id] && killState[b.id].nextSpawn > now);
    const zoneCard   = getZoneCard(boss.zone);

    if (zoneCard) {
      if (stillKilled.length > 0) {
        try {
          const killedInZone = stillKilled.map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));
          const msg = await interaction.channel.messages.fetch(zoneCard.messageId);
          await msg.edit({ embeds: [buildZoneKillCard(boss.zone, killedInZone)] });
        } catch (_) {}
      } else {
        try {
          const msg = await interaction.channel.messages.fetch(zoneCard.messageId);
          await msg.delete();
        } catch (_) {}
        clearZoneCard(boss.zone);
      }
    }

    await interaction.reply({ content: `↩️ Kill record cleared for **${boss.name}** by <@${interaction.user.id}>` });
    await refreshBoard(interaction.client, interaction.channelId);
    return;
  }

  // ── Record kill ───────────────────────────────────────────────────────────
  recordKill(bossId, boss.timerHours, interaction.user.id);

  const killState   = getAllState();
  const zoneBosses  = bosses.filter((b) => b.zone === boss.zone);
  const killedInZone = zoneBosses
    .filter((b) => killState[b.id] && killState[b.id].nextSpawn > now)
    .map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));

  const embed    = buildZoneKillCard(boss.zone, killedInZone);
  const zoneCard = getZoneCard(boss.zone);

  if (zoneCard) {
    try {
      const msg = await interaction.channel.messages.fetch(zoneCard.messageId);
      await msg.edit({ embeds: [embed] });
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: `✅ **${boss.name}** kill recorded — zone card updated.` });
    } catch {
      const { resource } = await interaction.reply({ embeds: [embed], withResponse: true });
      setZoneCard(boss.zone, resource.message.id);
    }
  } else {
    const { resource } = await interaction.reply({ embeds: [embed], withResponse: true });
    setZoneCard(boss.zone, resource.message.id);
  }

  await refreshBoard(interaction.client, interaction.channelId);
}

// ── Refresh board in place ────────────────────────────────────────────────────
async function refreshBoard(discordClient, channelId) {
  try {
    const boardIds = getBoardMessages();
    if (!boardIds.length) return;
    const channel   = await discordClient.channels.fetch(channelId);
    const bosses    = getBosses();
    const killState = getAllState();
    const panels    = buildBoardPanels(bosses, killState);
    if (panels.length !== boardIds.length) return;
    for (let i = 0; i < boardIds.length; i++) {
      try {
        const msg = await channel.messages.fetch(boardIds[i].messageId);
        await msg.edit(panels[i].payload);
      } catch (err) { console.warn(`Board panel ${i} refresh failed:`, err?.message); }
    }
  } catch (err) { console.error('refreshBoard error:', err); }
}

// ── Spawn checker (every 5 minutes) ──────────────────────────────────────────
const alertedSoon    = new Set();
const alertedSpawned = new Set();

function startSpawnChecker(readyClient) {
  const channelId       = process.env.TIMER_CHANNEL_ID;
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  if (!channelId) { console.warn('⚠️  TIMER_CHANNEL_ID not set'); return; }

  setInterval(async () => {
    try {
      const bosses        = getBosses();
      const channel       = await readyClient.channels.fetch(channelId);
      const historyThread = historyThreadId ? await readyClient.channels.fetch(historyThreadId).catch(() => null) : null;
      const state = getAllState();
      const now   = Date.now();

      for (const boss of bosses) {
        const entry = state[boss.id];
        if (!entry) continue;
        const remaining = entry.nextSpawn - now;

        if (remaining <= 0 && !alertedSpawned.has(boss.id)) {
          alertedSpawned.add(boss.id);
          alertedSoon.delete(boss.id);

          // Archive zone card to history thread, update it to remove this boss
          await archiveAndUpdateZoneCard(channel, historyThread, boss, bosses, state, now);

          await channel.send({ embeds: [buildSpawnedEmbed(boss)] });
          clearKill(boss.id);
          await refreshBoard(readyClient, channelId);
          console.log(`Spawned: ${boss.name}`);
          continue;
        }

        if (remaining > 30 * 60 * 1000) { alertedSpawned.delete(boss.id); alertedSoon.delete(boss.id); }

        if (remaining > 0 && remaining <= 30 * 60 * 1000 && !alertedSoon.has(boss.id)) {
          alertedSoon.add(boss.id);
          await channel.send({ embeds: [buildSpawnAlertEmbed(boss)] });
          console.log(`30min warning: ${boss.name}`);
        }
      }
    } catch (err) { console.error('Spawn checker error:', err); }
  }, 5 * 60 * 1000);

  console.log('Spawn checker started');
}

async function archiveAndUpdateZoneCard(channel, historyThread, spawnedBoss, bosses, state, now) {
  const zoneCard = getZoneCard(spawnedBoss.zone);
  if (!zoneCard) return;

  try {
    const cardMsg = await channel.messages.fetch(zoneCard.messageId);

    // Archive to history thread
    if (historyThread) {
      const spawnedAt = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZoneName: 'short', timeZone: 'America/New_York',
      });
      await historyThread.send({
        content: `📦 **${spawnedBoss.name}** (${spawnedBoss.zone}) respawned at ${spawnedAt}`,
        embeds: cardMsg.embeds,
      });
    }

    // Check if other bosses in the zone are still on cooldown (excluding the one that just spawned)
    const zoneBosses    = bosses.filter((b) => b.zone === spawnedBoss.zone && b.id !== spawnedBoss.id);
    const stillOnTimer  = zoneBosses.filter((b) => state[b.id] && state[b.id].nextSpawn > now + 5000);

    if (stillOnTimer.length > 0) {
      // Update the card to remove the spawned boss
      const killedInZone = stillOnTimer.map((b) => ({ boss: b, entry: state[b.id], killedBy: state[b.id].killedBy }));
      await cardMsg.edit({ embeds: [buildZoneKillCard(spawnedBoss.zone, killedInZone)] });
    } else {
      // All bosses in zone have spawned — delete the card
      await cardMsg.delete();
      clearZoneCard(spawnedBoss.zone);
    }
  } catch (err) {
    console.warn(`archiveAndUpdateZoneCard error (${spawnedBoss.name}):`, err?.message);
  }
}

// ── Midnight EST summary ──────────────────────────────────────────────────────
function scheduleMidnightSummary(readyClient) {
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const channelId       = process.env.TIMER_CHANNEL_ID;
  if (!historyThreadId) { console.warn('⚠️  HISTORIC_KILLS_THREAD_ID not set — midnight summary disabled'); return; }

  function msUntilMidnightEST() {
    const est = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const midnight = new Date(est); midnight.setHours(24, 0, 0, 0);
    return midnight - est;
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
      const availableNow = bosses.filter((b) => { const e = killState[b.id]; return !e || e.nextSpawn <= Date.now(); });
      await historyThread.send({ embeds: [buildDailySummaryEmbed(dailyKills, availableNow, bosses)] });

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
