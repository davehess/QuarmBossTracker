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
  getAllState, recordKill, setKillMessageId, clearKill,
  getBoardMessages, getDailyKills, resetDailyKills,
  getAnnounceMessageIds, clearAnnounceMessageIds,
} = require('./utils/state');
const { buildKillEmbed, buildSpawnAlertEmbed, buildSpawnedEmbed, buildDailySummaryEmbed } = require('./utils/embeds');
const { buildBoardPanels } = require('./utils/board');
const { hasAllowedRole, allowedRolesList } = require('./utils/roles');

function getBosses() {
  // Always re-read from disk so /addboss changes are reflected without restart
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
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`Monitoring ${bosses.length} bosses`);
  await registerCommands();
  startSpawnChecker(readyClient);
  scheduleMidnightSummary(readyClient);
});

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
    if (existing.killMessageId) {
      try {
        const killMsg = await interaction.channel.messages.fetch(existing.killMessageId);
        await killMsg.delete();
      } catch (_) {}
    }
    clearKill(bossId);
    await interaction.reply({ content: `↩️ Kill record cleared for **${boss.name}** by <@${interaction.user.id}>` });
    await refreshBoard(interaction.client, interaction.channelId);
    return;
  }

  // ── Record kill ───────────────────────────────────────────────────────────
  const stateEntry = recordKill(bossId, boss.timerHours, interaction.user.id, null);
  const embed      = buildKillEmbed(boss, stateEntry, interaction.user.id);
  const { resource } = await interaction.reply({ embeds: [embed], withResponse: true });
  setKillMessageId(bossId, resource.message.id);
  await refreshBoard(interaction.client, interaction.channelId);
}

// ── Refresh full board in place (embed + buttons) ─────────────────────────────
async function refreshBoard(discordClient, channelId) {
  try {
    const boardMsgIds = getBoardMessages();
    if (!boardMsgIds.length) return;
    const channel   = await discordClient.channels.fetch(channelId);
    const bosses    = getBosses();
    const killState = getAllState();
    const panels    = buildBoardPanels(bosses, killState);
    if (panels.length !== boardMsgIds.length) return;
    for (let i = 0; i < boardMsgIds.length; i++) {
      try {
        const msg = await channel.messages.fetch(boardMsgIds[i].messageId);
        await msg.edit(panels[i].payload);
      } catch (err) { console.warn(`Board refresh failed panel ${i}:`, err?.message); }
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
          if (entry.killMessageId) await archiveKillMessage(channel, historyThread, boss, entry);
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

async function archiveKillMessage(channel, historyThread, boss, entry) {
  try {
    const originalMsg = await channel.messages.fetch(entry.killMessageId).catch(() => null);
    if (!originalMsg) return;
    if (historyThread) {
      const spawnedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' });
      await historyThread.send({ content: `📦 **${boss.name}** respawned — archiving kill record (${spawnedAt})`, embeds: originalMsg.embeds });
    }
    await originalMsg.delete().catch((e) => console.warn(`Delete failed (${boss.name}):`, e?.message));
  } catch (err) { console.error(`archiveKillMessage error (${boss.name}):`, err); }
}

// ── Midnight EST summary ──────────────────────────────────────────────────────
function scheduleMidnightSummary(readyClient) {
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const channelId       = process.env.TIMER_CHANNEL_ID;
  if (!historyThreadId) { console.warn('⚠️  HISTORIC_KILLS_THREAD_ID not set — midnight summary disabled'); return; }

  function msUntilMidnightEST() {
    const now = new Date();
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
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
            await historyThread.send({ content: `📋 **Archived announcement** (${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })})`, embeds: msg.embeds, components: [] });
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
