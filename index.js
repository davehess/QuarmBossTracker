// index.js
// Main entry point for the Quarm Raid Timer Bot

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

const { getAllState, recordKill, setKillMessageId, clearKill, getBoardMessages } = require('./utils/state');
const { buildKillEmbed, buildSpawnAlertEmbed, buildSpawnedEmbed }                = require('./utils/embeds');
const { buildBoardPanels }                                                        = require('./utils/board');
const bosses = require('./data/bosses.json');

// ── Bot client setup ──────────────────────────────────────────────────────────
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
      console.log(`Loaded command: /${cmd.data.name}`);
    }
  });

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`Monitoring ${bosses.length} bosses across ${[...new Set(bosses.map(b => b.zone))].length} zones`);
  await registerCommands();
  startSpawnChecker(readyClient);
});

// ── Auto-register slash commands ──────────────────────────────────────────────
async function registerCommands() {
  const guildId  = process.env.DISCORD_GUILD_ID;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!guildId || !clientId) {
    console.warn('⚠️  DISCORD_GUILD_ID or DISCORD_CLIENT_ID not set — skipping command registration');
    return;
  }
  const commandData = [...client.commands.values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
    console.log(`✅ Registered ${commandData.length} slash commands to guild ${guildId}`);
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err?.message || err);
  }
}

// ── Interaction handler ───────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd?.autocomplete) {
      try { await cmd.autocomplete(interaction); }
      catch (err) { console.error(`Autocomplete error:`, err); }
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('kill:')) await handleBoardKillButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const msg = { content: '❌ An error occurred.', ephemeral: true };
    interaction.replied || interaction.deferred
      ? await interaction.followUp(msg)
      : await interaction.reply(msg);
  }
});

// ── Board button handler ──────────────────────────────────────────────────────
async function handleBoardKillButton(interaction) {
  const bossId = interaction.customId.replace('kill:', '');
  const boss   = bosses.find((b) => b.id === bossId);

  if (!boss) {
    return interaction.reply({ content: '❌ Unknown boss on this button.', ephemeral: true });
  }

  const allowedRole = process.env.ALLOWED_ROLE_NAME || 'Pack Member';
  const hasRole = interaction.member.roles.cache.some((r) => r.name === allowedRole);
  if (!hasRole) {
    return interaction.reply({
      content: `❌ You need the **${allowedRole}** role to record kills.`,
      ephemeral: true,
    });
  }

  // Record the kill (without killMessageId yet — we get that after reply)
  const stateEntry = recordKill(bossId, boss.timerHours, interaction.user.id, null);
  const embed = buildKillEmbed(boss, stateEntry, interaction.user.id);

  // Post the kill embed publicly
  const reply = await interaction.reply({ embeds: [embed], fetchReply: true });

  // Now store the message ID so the spawn checker can archive it later
  setKillMessageId(bossId, reply.id);

  // Update the board buttons in place (turn this boss grey/skull)
  await refreshBoardButtons(interaction.client, interaction.channelId);
}

// ── Refresh board button labels/styles in place ───────────────────────────────
// Called after a kill or after a spawn so the board always reflects current state.
async function refreshBoardButtons(discordClient, channelId) {
  try {
    const boardMsgIds = getBoardMessages();
    if (!boardMsgIds.length) return;

    const channel    = await discordClient.channels.fetch(channelId);
    const killState  = getAllState();
    const allPanels  = buildBoardPanels(bosses, killState);

    if (allPanels.length !== boardMsgIds.length) return; // mismatch — board needs full repost

    for (let i = 0; i < boardMsgIds.length; i++) {
      const panel = allPanels[i];
      if (panel.type !== 'zone') continue; // only zone panels have buttons
      try {
        const msg = await channel.messages.fetch(boardMsgIds[i].messageId);
        await msg.edit({ components: panel.payload.components });
      } catch (err) {
        console.warn(`Could not refresh board panel ${i}:`, err?.message);
      }
    }
  } catch (err) {
    console.error('refreshBoardButtons error:', err);
  }
}

// ── Spawn notification loop ───────────────────────────────────────────────────
const alertedSoon    = new Set();
const alertedSpawned = new Set();

function startSpawnChecker(readyClient) {
  const channelId      = process.env.TIMER_CHANNEL_ID;
  const historyThreadId = process.env.HISTORIC_KILLS_THREAD_ID;

  if (!channelId) {
    console.warn('⚠️  TIMER_CHANNEL_ID not set — spawn notifications disabled');
    return;
  }
  if (!historyThreadId) {
    console.warn('⚠️  HISTORIC_KILLS_THREAD_ID not set — kill archive disabled (original messages will not be moved)');
  }

  setInterval(async () => {
    try {
      const channel = await readyClient.channels.fetch(channelId);
      if (!channel) return;

      const historyThread = historyThreadId
        ? await readyClient.channels.fetch(historyThreadId).catch(() => null)
        : null;

      const state = getAllState();
      const now   = Date.now();

      for (const boss of bosses) {
        const entry = state[boss.id];
        if (!entry) continue;

        const remaining = entry.nextSpawn - now;

        // ── Boss has spawned ──────────────────────────────────────────────────
        if (remaining <= 0 && !alertedSpawned.has(boss.id)) {
          alertedSpawned.add(boss.id);
          alertedSoon.delete(boss.id);

          // 1. Archive the kill embed to the history thread, then delete original
          if (entry.killMessageId) {
            await archiveKillMessage(channel, historyThread, boss, entry);
          }

          // 2. Post spawned notification in main channel
          await channel.send({ embeds: [buildSpawnedEmbed(boss)] });
          console.log(`Spawned: ${boss.name}`);

          // 3. Clear kill record so the boss is back to "unknown"
          clearKill(boss.id);

          // 4. Reset board button back to normal red
          await refreshBoardButtons(readyClient, channelId);

          continue;
        }

        // Re-arm for next kill cycle
        if (remaining > 30 * 60 * 1000) {
          alertedSpawned.delete(boss.id);
          alertedSoon.delete(boss.id);
        }

        // ── 30-minute warning ─────────────────────────────────────────────────
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

  console.log('Spawn notification loop started (checking every 5 minutes)');
}

// ── Archive kill message to history thread ────────────────────────────────────
async function archiveKillMessage(channel, historyThread, boss, entry) {
  try {
    // Fetch the original kill embed message
    const originalMsg = await channel.messages.fetch(entry.killMessageId).catch(() => null);
    if (!originalMsg) return;

    if (historyThread) {
      // Re-post the embed into the history thread with a timestamp header
      const spawnedAt = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZoneName: 'short', timeZone: 'America/New_York',
      });
      await historyThread.send({
        content: `📦 **${boss.name}** has respawned — archiving kill record (spawned ${spawnedAt})`,
        embeds: originalMsg.embeds,
      });
    }

    // Delete the original kill message from #raid-mobs
    await originalMsg.delete().catch((err) => {
      console.warn(`Could not delete kill message for ${boss.name}:`, err?.message);
    });
  } catch (err) {
    console.error(`archiveKillMessage error for ${boss.name}:`, err);
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
