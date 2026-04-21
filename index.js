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
const fs = require('fs');
const path = require('path');

const { getAllState } = require('./utils/state');
const { buildSpawnAlertEmbed, buildSpawnedEmbed } = require('./utils/embeds');
const bosses = require('./data/bosses.json');

// ── Bot client setup ────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ── Load commands ───────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`Loaded command: /${command.data.name}`);
  }
}

// ── Ready ────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`Monitoring ${bosses.length} bosses across ${[...new Set(bosses.map(b => b.zone))].length} zones`);

  // Auto-register slash commands on every startup — guild-scoped so they appear instantly.
  // No need to run deploy-commands.js separately.
  await registerCommands();

  // Start spawn notification loop
  startSpawnChecker(readyClient);
});

// ── Auto-register slash commands ─────────────────────────────────────────────
async function registerCommands() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!guildId || !clientId) {
    console.warn('⚠️  DISCORD_GUILD_ID or DISCORD_CLIENT_ID not set — skipping command registration');
    return;
  }

  const commandData = [...client.commands.values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commandData }
    );
    console.log(`✅ Registered ${commandData.length} slash commands to guild ${guildId}`);
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err?.message || err);
  }
}

// ── Interaction handler ──────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  // Autocomplete
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`Autocomplete error for ${interaction.commandName}:`, err);
      }
    }
    return;
  }

  // Button interactions — boss board kill buttons
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('kill:')) {
      await handleBoardKillButton(interaction);
    }
    return;
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const msg = { content: '❌ An error occurred running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

// ── Board button handler ─────────────────────────────────────────────────────
async function handleBoardKillButton(interaction) {
  const bossId = interaction.customId.replace('kill:', '');
  const boss = bosses.find((b) => b.id === bossId);

  if (!boss) {
    return interaction.reply({ content: '❌ Unknown boss on this button.', ephemeral: true });
  }

  // Role check
  const allowedRole = process.env.ALLOWED_ROLE_NAME || 'Pack Member';
  const hasRole = interaction.member.roles.cache.some((r) => r.name === allowedRole);
  if (!hasRole) {
    return interaction.reply({
      content: `❌ You need the **${allowedRole}** role to record kills.`,
      ephemeral: true,
    });
  }

  const { recordKill } = require('./utils/state');
  const { buildKillEmbed } = require('./utils/embeds');

  const stateEntry = recordKill(bossId, boss.timerHours, interaction.user.id);
  const embed = buildKillEmbed(boss, stateEntry, interaction.user.id);

  await interaction.reply({ embeds: [embed] });
}

// ── Spawn notification loop ──────────────────────────────────────────────────
const alertedSoon = new Set();
const alertedSpawned = new Set();

function startSpawnChecker(readyClient) {
  const channelId = process.env.TIMER_CHANNEL_ID;
  if (!channelId) {
    console.warn('⚠️  TIMER_CHANNEL_ID not set — spawn notifications disabled');
    return;
  }

  setInterval(async () => {
    try {
      const channel = await readyClient.channels.fetch(channelId);
      if (!channel) return;

      const state = getAllState();
      const now = Date.now();

      for (const boss of bosses) {
        const entry = state[boss.id];
        if (!entry) continue;

        const remaining = entry.nextSpawn - now;

        if (remaining <= 0 && !alertedSpawned.has(boss.id)) {
          alertedSpawned.add(boss.id);
          alertedSoon.delete(boss.id);
          await channel.send({ embeds: [buildSpawnedEmbed(boss)] });
          console.log(`Spawned: ${boss.name}`);
          continue;
        }

        if (remaining > 30 * 60 * 1000) {
          alertedSpawned.delete(boss.id);
          alertedSoon.delete(boss.id);
        }

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

// ── Login ────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
