// commands/hateboard.js — Post or refresh the persistent Plane of Hate tracker boards.
// Posts floor maps + live board + PVP board into HATE_THREAD_ID. Officer+.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');
const { getHateBoardMessageId, setHateBoardMessageId } = require('../utils/state');
const { buildHateBoardEmbed, buildHateBoardRows, HATE_THREAD_ID } = require('../utils/hateBoard');

// Static floor map embeds — posted once, never edited
function buildFloor1Embed() {
  return new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle('🗺️ Plane of Hate — Floor 1 Map')
    .setDescription(
      '**🏛️ Organ Hall**\n' +
      '• [#1 — Upper (upstairs)](https://www.pqdi.cc/spawngroup/76326/21449682)\n' +
      '• [#2 — West](https://www.pqdi.cc/spawngroup/76326/21449685)\n\n' +
      '**🏢 East Building**\n' +
      '• [#3 — Upper (upstairs)](https://www.pqdi.cc/spawngroup/76326/363944)\n\n' +
      '**⛪ Church**\n' +
      '• [#5 — Middle Upper (2nd floor interior)](https://www.pqdi.cc/spawngroup/76326/21449631)\n' +
      '• [#7 — South Lower (downstairs)](https://www.pqdi.cc/spawngroup/76326/21449632)\n' +
      '• [#8 — South Upper (2nd floor)](https://www.pqdi.cc/spawngroup/76326/21449632)\n' +
      '• [#9 — West Upper](https://www.pqdi.cc/spawngroup/76326/21449667)'
    );
}

function buildFloor2Embed() {
  return new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle('🗺️ Plane of Hate — Second Floor Map')
    .setDescription(
      '**⬆️ Second Floor Spawns**\n' +
      '• [#10 — North Spawn](https://www.pqdi.cc/spawngroup/76326/21449679)\n' +
      '• [#11 — East Spawn](https://www.pqdi.cc/spawngroup/76326/368076)\n' +
      '• [#12 — South Spawn](https://www.pqdi.cc/spawngroup/76326/21449686)'
    );
}

async function editOrPostBoard(thread, storedId, payload, type) {
  if (storedId) {
    try {
      const msg = await thread.messages.fetch(storedId);
      await msg.edit(payload);
      return msg.id;
    } catch {
      // message gone — fall through to post
    }
  }
  const msg = await thread.send(payload);
  setHateBoardMessageId(type, msg.id);
  return msg.id;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hateboard')
    .setDescription('Post or refresh the Plane of Hate tracker boards in the hate thread. (Officer+)'),

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member))
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: `❌ You need one of these roles: ${allowedRolesList()}` });

    const threadId = HATE_THREAD_ID();
    if (!threadId)
      return interaction.reply({ flags: MessageFlags.Ephemeral, content: '❌ `HATE_THREAD_ID` is not set.' });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const thread = await interaction.client.channels.fetch(threadId);
      const now    = Date.now();

      // Post floor maps only if they're not already pinned / present — always just post fresh
      // We don't edit maps since they never change
      const liveStoredId = getHateBoardMessageId('live');
      const pvpStoredId  = getHateBoardMessageId('pvp');

      // If neither board exists yet, post the static floor maps first
      if (!liveStoredId && !pvpStoredId) {
        await thread.send({ embeds: [buildFloor1Embed()] });
        await thread.send({ embeds: [buildFloor2Embed()] });
      }

      // Post or edit live board
      await editOrPostBoard(
        thread,
        liveStoredId,
        { embeds: [await buildHateBoardEmbed('live', now)], components: await buildHateBoardRows('live', now) },
        'live'
      );

      // Post or edit PVP board
      await editOrPostBoard(
        thread,
        pvpStoredId,
        { embeds: [await buildHateBoardEmbed('pvp', now)], components: await buildHateBoardRows('pvp', now) },
        'pvp'
      );

      await interaction.editReply({ content: '✅ Hate boards posted/refreshed.' });
    } catch (err) {
      console.error('[hateboard]', err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
