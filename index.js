// index.js — Quarm Raid Timer Bot

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
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
const bosses = require('./data/bosses.json');

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
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  await registerCommands();
  startSpawnChecker(readyClient);
  scheduleMidnightSummary(readyClient);
});

// ── Register slash commands ───────────────────────────────────────────────────
async function registerCommands() {
  const guildId  = process.env.DISCORD_GUILD_ID;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!guildId || !clientId) {
    console.warn('⚠️  Missing DISCORD_GUILD_ID or DISCORD_CLIENT_ID');
    return;
  }
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
    if (cmd?.autocomplete) {
      try { await cmd.autocomplete(interaction); } catch (e) { console.error(e); }
    }
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
    const msg = { content: '❌ An error occurred.', ephemeral: true };
    interaction.replied || interaction.deferred
      ? await interaction.followUp(msg)
      : await interaction.reply(msg);
  }
});

// ── Board button handler — toggle kill/unkill ─────────────────────────────────
async function handleBoardButton(interaction) {
  const bossId = interaction.customId.replace('kill:', '');
  const boss   = bosses.find((b) => b.id === bossId);
  if (!boss) return interaction.reply({ content: '❌ Unknown boss.', ephemeral: true });

  if (!hasAllowedRole(interaction.member)) {
    return interaction.reply({
      content: `❌ You need one of these roles: ${allowedRolesList()}`,
      ephemeral: true,
    });
  }

  const existing = getAllState()[bossId];
  const now      = Date.now();

  // ── Boss already on cooldown → /unkill behaviour ──────────────────────────
  if (existing && existing.nextSpawn > now) {
    // Delete the kill message from the channel
    if (existing.killMessageId) {
      try {
        const killMsg = await interaction.channel.messages.fetch(existing.killMessageId);
        await killMsg.delete();
      } catch (_) {}
    }

    clearKill(bossId);

    await interaction.reply({
      content: `↩️ Kill record cleared for **${boss.name}** by <@${interaction.user.id}>`,
      ephemeral: false,
    });

    await refreshBoardButtons(interaction.client, interaction.channelId);
    return;
  }

  // ── Normal kill recording ─────────────────────────────────────────────────
  const stateEntry = recordKill(bossId, boss.timerHours, interaction.user.id, null);
  const embed      = buildKillEmbed(boss, stateEntry, interaction.user.id);
  const reply      = await interaction.reply({ embeds: [embed], fetchReply: true });
  setKillMessageId(bossId, reply.id);

  await refreshBoardButtons(interaction.client, interaction.channelId);
}

// ── Refresh board button states in place ──────────────────────────────────────
async function refreshBoardButtons(discordClient, channelId) {
  try {
    const boardMsgIds = getBoardMessages();
    if (!boardMsgIds.length) return;
    const channel   = await discordClient.channels.fetch(channelId);
    const killState = getAllState();
    const allPanels = buildBoardPanels(bosses, killState);
    if (allPanels.length !== boardMsgIds.length) return;
    for (let i = 0; i < boardMsgIds.length; i++) {
      const panel = allPanels[i];
      if (panel.type !== 'zone') continue;
      try {
        const msg = await channel.messages.fetch(boardMsgIds[i].messageId);
        await msg.edit({ components: panel.payload.components });
      } catch (err) {
        console.warn(`Board refresh failed for panel ${i}:`, err?.message);
      }
    }
  } catch (err) {
    console.error('refreshBoardButtons error:', err);
  }
}

// ── Spawn checker (every 5 minutes) ──────────────────────────────────────────
const alertedSoon    = new Set();
const alertedSpawned = new Set();

function startSpawnChecker(readyClient) {
  const channelId      = process.env.TIMER_CHANNEL_ID;
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;

  if (!channelId) {
    console.warn('⚠️  TIMER_CHANNEL_ID not set');
    return;
  }

  setInterval(async () => {
    try {
      const channel       = await readyClient.channels.fetch(channelId);
      const historyThread = historyThreadId
        ? await readyClient.channels.fetch(historyThreadId).catch(() => null)
        : null;
      const state = getAllState();
      const now   = Date.now();

      for (const boss of bosses) {
        const entry = state[boss.id];
        if (!entry) continue;
        const remaining = entry.nextSpawn - now;

        // Spawned
        if (remaining <= 0 && !alertedSpawned.has(boss.id)) {
          alertedSpawned.add(boss.id);
          alertedSoon.delete(boss.id);

          if (entry.killMessageId) await archiveKillMessage(channel, historyThread, boss, entry);
          await channel.send({ embeds: [buildSpawnedEmbed(boss)] });
          clearKill(boss.id);
          await refreshBoardButtons(readyClient, channelId);
          console.log(`Spawned: ${boss.name}`);
          continue;
        }

        if (remaining > 30 * 60 * 1000) {
          alertedSpawned.delete(boss.id);
          alertedSoon.delete(boss.id);
        }

        // 30-min warning
        if (remaining > 0 && remaining <= 30 * 60 * 1000 && !alertedSoon.has(boss.id)) {
          alertedSoon.add(boss.id);
          await channel.send({ embeds: [buildSpawnAlertEmbed(boss)] });
          console.log(`30min warning: ${boss.name}`);
        }
      }
    } catch (err) {
      console.error('Spawn checker error:', err);
    }
  }, 5 * 60 * 1000);

  console.log('Spawn checker started');
}

// ── Archive kill embed to history thread ──────────────────────────────────────
async function archiveKillMessage(channel, historyThread, boss, entry) {
  try {
    const originalMsg = await channel.messages.fetch(entry.killMessageId).catch(() => null);
    if (!originalMsg) return;
    if (historyThread) {
      const spawnedAt = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZoneName: 'short', timeZone: 'America/New_York',
      });
      await historyThread.send({
        content: `📦 **${boss.name}** has respawned — archiving kill record (spawned ${spawnedAt})`,
        embeds: originalMsg.embeds,
      });
    }
    await originalMsg.delete().catch((e) => console.warn(`Delete failed for ${boss.name}:`, e?.message));
  } catch (err) {
    console.error(`archiveKillMessage error (${boss.name}):`, err);
  }
}

// ── Midnight EST summary + announce archival ──────────────────────────────────
function scheduleMidnightSummary(readyClient) {
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;
  const channelId       = process.env.TIMER_CHANNEL_ID;

  if (!historyThreadId) {
    console.warn('⚠️  HISTORIC_KILLS_THREAD_ID not set — midnight summary disabled');
    return;
  }

  function msUntilMidnightEST() {
    const now = new Date();
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const midnight = new Date(est);
    midnight.setHours(24, 0, 0, 0);
    return midnight - est;
  }

  async function runMidnightTasks() {
    console.log('Running midnight tasks...');
    try {
      const historyThread = await readyClient.channels.fetch(historyThreadId).catch(() => null);
      const channel       = channelId
        ? await readyClient.channels.fetch(channelId).catch(() => null)
        : null;

      if (!historyThread) {
        console.warn('Could not fetch historic kills thread for midnight summary');
        return;
      }

      // 1. Post daily summary
      const dailyKills   = getDailyKills();
      const killState    = getAllState();
      const availableNow = bosses.filter((b) => {
        const entry = killState[b.id];
        return !entry || entry.nextSpawn <= Date.now();
      });

      const summaryEmbed = buildDailySummaryEmbed(dailyKills, availableNow, bosses);
      await historyThread.send({ embeds: [summaryEmbed] });

      // 2. Archive /announce messages to history thread and delete from main channel
      if (channel) {
        const announceIds = getAnnounceMessageIds();
        for (const msgId of announceIds) {
          try {
            const msg = await channel.messages.fetch(msgId);
            await historyThread.send({
              content: `📋 **Archived announcement** from ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`,
              embeds:     msg.embeds,
              components: [], // strip buttons on archive
            });
            await msg.delete();
          } catch (err) {
            console.warn(`Could not archive announce message ${msgId}:`, err?.message);
          }
        }
      }

      // 3. Reset daily state
      resetDailyKills();
      clearAnnounceMessageIds();

      console.log('Midnight tasks complete');
    } catch (err) {
      console.error('Midnight task error:', err);
    }

    // Schedule next midnight
    setTimeout(runMidnightTasks, msUntilMidnightEST());
  }

  // First run: wait until next midnight EST
  const delay = msUntilMidnightEST();
  console.log(`Midnight summary scheduled in ${Math.round(delay / 1000 / 60)} minutes`);
  setTimeout(runMidnightTasks, delay);
}

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
