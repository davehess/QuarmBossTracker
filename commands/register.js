// commands/register.js — Create a new character in OpenDKP and add to the local roster.
// Sets Level=10, Active=1, Rank='Non-raid Alt' automatically.
// If a main is specified, the character is linked as an alt (ParentId set to main's CharacterId).
// After creation, notifies OFFICER_CHAT_CHANNEL_ID and updates the roster threads.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { getCharacter, getActiveRoster, addCharacterEntry, saveRosters } = require('../utils/roster');
const { createCharacter, getCharacters } = require('../utils/opendkp');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

const EQ_CLASSES = [
  { name: 'Bard',         value: 'Bard' },
  { name: 'Beastlord',    value: 'Beastlord' },
  { name: 'Berserker',    value: 'Berserker' },
  { name: 'Cleric',       value: 'Cleric' },
  { name: 'Druid',        value: 'Druid' },
  { name: 'Enchanter',    value: 'Enchanter' },
  { name: 'Magician',     value: 'Magician' },
  { name: 'Monk',         value: 'Monk' },
  { name: 'Necromancer',  value: 'Necromancer' },
  { name: 'Paladin',      value: 'Paladin' },
  { name: 'Ranger',       value: 'Ranger' },
  { name: 'Rogue',        value: 'Rogue' },
  { name: 'Shadow Knight', value: 'Shadow Knight' },
  { name: 'Shaman',       value: 'Shaman' },
  { name: 'Warrior',      value: 'Warrior' },
  { name: 'Wizard',       value: 'Wizard' },
];

const EQ_RACES = [
  { name: 'Barbarian', value: 'Barbarian' },
  { name: 'Dark Elf',  value: 'Dark Elf' },
  { name: 'Dwarf',     value: 'Dwarf' },
  { name: 'Erudite',   value: 'Erudite' },
  { name: 'Gnome',     value: 'Gnome' },
  { name: 'Half Elf',  value: 'Half Elf' },
  { name: 'Halfling',  value: 'Halfling' },
  { name: 'High Elf',  value: 'High Elf' },
  { name: 'Human',     value: 'Human' },
  { name: 'Iksar',     value: 'Iksar' },
  { name: 'Ogre',      value: 'Ogre' },
  { name: 'Troll',     value: 'Troll' },
  { name: 'Vah Shir',  value: 'Vah Shir' },
  { name: 'Wood Elf',  value: 'Wood Elf' },
];

const CLASS_EMOJI = {
  Warrior: '⚔️', Cleric: '✨', Paladin: '🛡️', Ranger: '🏹', 'Shadow Knight': '💀',
  Druid: '🌿', Monk: '👊', Bard: '🎵', Rogue: '🗡️', Shaman: '🔮',
  Necromancer: '💀', Wizard: '🔥', Magician: '🔮', Enchanter: '✨',
  Beastlord: '🐾', Berserker: '🪓',
};

// Extract CharacterId from a DKP URL (https://wolfpack.opendkp.com/#/characters/12345)
function _extractCharId(dkpUrl) {
  const m = (dkpUrl || '').match(/\/characters\/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Create a new character in OpenDKP and add to the roster')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Character name')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('class')
        .setDescription('Character class')
        .setRequired(true)
        .addChoices(...EQ_CLASSES)
    )
    .addStringOption(opt =>
      opt.setName('race')
        .setDescription('Character race')
        .setRequired(true)
        .addChoices(...EQ_RACES)
    )
    .addStringOption(opt =>
      opt.setName('main')
        .setDescription('Main character name (leave blank if this is a main)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const mains = getActiveRoster()
      .filter(m => !m._alt)
      .map(m => ({ name: m.n, value: m.n }))
      .filter(c => c.name.toLowerCase().includes(focused))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 25);
    await interaction.respond(mains);
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const rawName   = interaction.options.getString('name').trim();
    const charClass = interaction.options.getString('class');
    const charRace  = interaction.options.getString('race');
    const mainName  = interaction.options.getString('main')?.trim() || null;

    // Proper-case the name (capitalize first letter of each word)
    const name = rawName.replace(/\b\w/g, c => c.toUpperCase());

    // Validate main exists if specified
    let parentId = 0;
    if (mainName) {
      const mainChar = getCharacter(mainName);
      if (!mainChar) {
        return interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: `❌ Main character **${mainName}** not found in the roster. Make sure they've been imported via /rosterimport first.`,
        });
      }
      if (mainChar.isAlt) {
        return interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: `❌ **${mainName}** is already an alt — can't use an alt as a parent character.`,
        });
      }
      // Try to extract CharacterId from the stored DKP URL (fast path)
      const storedId = _extractCharId(mainChar.dkpUrl);
      if (storedId) {
        parentId = storedId;
      } else {
        // DKP URL not yet in roster — fetch full character list from OpenDKP
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const allChars = await getCharacters();
          const chars = Array.isArray(allChars) ? allChars : (allChars?.characters || []);
          const found = chars.find(c => c.Name?.toLowerCase() === mainName.toLowerCase() && !c.Deleted);
          if (!found) {
            return interaction.editReply(
              `❌ Could not find **${mainName}** in OpenDKP. ` +
              `Make sure they exist there, or run /rosterimport to refresh the roster with DKP IDs.`
            );
          }
          parentId = found.CharacterId;
        } catch (err) {
          return interaction.editReply(`❌ Failed to look up main character in OpenDKP: ${err?.message}`);
        }
      }
    }

    if (!interaction.deferred) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // ── Create character in OpenDKP ──────────────────────────────────────────
    let newCharId = null;
    try {
      const payload = {
        Name:     name,
        Class:    charClass,
        Race:     charRace,
        Level:    10,
        Active:   1,
        Rank:     'Non-raid Alt',
        ParentId: parentId,
      };
      const result = await createCharacter(payload);
      // OpenDKP returns the created character object; CharacterId is the primary key
      newCharId = result?.CharacterId ?? result?.characterId ?? result?.id ?? null;
    } catch (err) {
      return interaction.editReply(`❌ Failed to create character in OpenDKP: ${err?.message}`);
    }

    // ── Build DKP URL ────────────────────────────────────────────────────────
    const clientName = process.env.OPENDKP_CLIENT_NAME || 'wolfpack';
    const dkpUrl = newCharId != null ? `https://${clientName}.opendkp.com/#/characters/${newCharId}` : null;

    // ── Add to local in-memory roster ────────────────────────────────────────
    addCharacterEntry({ name, race: charRace, charClass, dkpUrl, mainName });

    // Persist to Discord roster threads (best-effort)
    saveRosters(interaction.client).catch(err =>
      console.warn('[register] saveRosters failed:', err?.message)
    );

    // ── Notify officer chat ──────────────────────────────────────────────────
    const officerChannelId = process.env.OFFICER_CHAT_CHANNEL_ID;
    if (officerChannelId) {
      try {
        const classEmoji = CLASS_EMOJI[charClass] || '❓';
        const ch = await interaction.client.channels.fetch(officerChannelId);
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${classEmoji} New Character Registered: ${name}`)
          .setDescription(
            mainName
              ? `Alt of **${mainName}** · Registered by <@${interaction.user.id}>`
              : `New character · Registered by <@${interaction.user.id}>`
          )
          .addFields(
            { name: 'Race',  value: charRace,       inline: true },
            { name: 'Class', value: charClass,      inline: true },
            { name: 'Rank',  value: 'Non-raid Alt', inline: true },
          );
        if (dkpUrl) {
          embed.addFields({ name: '🔗 OpenDKP', value: `[View Character](<${dkpUrl}>)`, inline: false });
        }
        await ch.send({ embeds: [embed] });
      } catch (err) {
        console.warn('[register] officer chat notification failed:', err?.message);
      }
    }

    // ── Reply ────────────────────────────────────────────────────────────────
    const classEmoji = CLASS_EMOJI[charClass] || '❓';
    const lines = [`✅ **${name}** created successfully!`, `${classEmoji} ${charRace} ${charClass}`];
    if (mainName) lines.push(`Alt of **${mainName}**`);
    if (dkpUrl)   lines.push(`🔗 [View on OpenDKP](<${dkpUrl}>)`);
    else          lines.push('*(CharacterId not returned — verify on OpenDKP)*');

    await interaction.editReply(lines.join('\n'));
  },
};
