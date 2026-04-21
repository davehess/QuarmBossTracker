// deploy-commands.js
// Run this ONCE (or after editing commands) to register slash commands with Discord
// Usage: node deploy-commands.js

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`Preparing command: /${command.data.name}`);
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands...`);

    // Register to a specific guild (instant) vs globally (up to 1hr propagation)
    // For testing, use guild-specific. For production, switch to global.
    const guildId = process.env.DISCORD_GUILD_ID;

    if (guildId) {
      // Guild-specific (instant update, good for testing)
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} guild commands to guild ${guildId}`);
    } else {
      // Global (takes up to 1hr to propagate)
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} global commands`);
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
