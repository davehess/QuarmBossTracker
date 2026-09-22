// commands/register.js — Create a new character in OpenDKP and add to the local roster.
// Defaults: Level=10, Active=1.
// Rank choices: 'Recruit' (a new raid main), 'Non-raid Alt' (default) or
// 'Trader level 1'.
// ⚠ 'Trader level 1' is UNVERIFIED against OpenDKP. Every other choice here
// appears in the `characters` rank mirror ('Non-raid Alt' 1, 'Recruit' 17,
// alongside 'Raid Alt' 232, 'Raid Pack' 50, 'Trader' 36, 'Officer' 9, …) but
// 'Trader level 1' appears on ZERO characters while a bare 'Trader' has 36.
// That is either a rank OpenDKP renames on write, or a stale value that has
// been silently creating traders under a name nothing else uses. Confirm
// against OpenDKP before trusting it; do not "fix" it by guessing.
// If a main is specified, the character is linked via ParentId set to the family root's
// CharacterId (the ParentId=0 root in OpenDKP's family tree, NOT necessarily the rank-
// priority main's own CharacterId).
// After creation, notifies OFFICER_CHAT_CHANNEL_ID and updates the roster threads.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { getCharacter, getActiveRoster, addCharacterEntry, saveRosters } = require('../utils/roster');
const { createCharacter, getCharacters } = require('../utils/opendkp');
const { hasAllowedRole, allowedRolesList } = require('../utils/roles');

// Ranks that live in OUR database only and are never created in OpenDKP.
// Neither earns DKP, and neither counts toward guild membership — that
// predicate is OpenDKP rank `Raid Pack`+ — so an upstream record buys nothing
// and only clutters the export every `/rosterimport` reads.
const LOCAL_ONLY_RANKS = new Set(['Non-raid Alt', 'Trader level 1']);

const EQ_CLASSES = [
  { name: 'Bard',          value: 'Bard' },
  { name: 'Beastlord',     value: 'Beastlord' },
  { name: 'Berserker',     value: 'Berserker' },
  { name: 'Cleric',        value: 'Cleric' },
  { name: 'Druid',         value: 'Druid' },
  { name: 'Enchanter',     value: 'Enchanter' },
  { name: 'Magician',      value: 'Magician' },
  { name: 'Monk',          value: 'Monk' },
  { name: 'Necromancer',   value: 'Necromancer' },
  { name: 'Paladin',       value: 'Paladin' },
  { name: 'Ranger',        value: 'Ranger' },
  { name: 'Rogue',         value: 'Rogue' },
  { name: 'Shadow Knight', value: 'Shadow Knight' },
  { name: 'Shaman',        value: 'Shaman' },
  { name: 'Warrior',       value: 'Warrior' },
  { name: 'Wizard',        value: 'Wizard' },
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

// Extract CharacterId from a wolfpack.opendkp.com character URL
function _extractCharId(dkpUrl) {
  const m = (dkpUrl || '').match(/\/characters\/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

// Resolve the OpenDKP ParentId for a new alt of the given main.
// OpenDKP's family tree is a flat star: all alts point to the ParentId=0 root, NOT to
// the rank-priority main. rootCharId on the roster entry gives us this directly.
// Falls back to an API fetch if the roster entry predates the rootCharId field.
async function _resolveParentId(mainChar, mainName) {
  // Fast path: rootCharId stored from the last /rosterimport
  if (mainChar.rootCharId) return { parentId: mainChar.rootCharId, error: null };

  // Slow path: roster was imported before _rootId field existed — fetch from API
  try {
    const allChars = await getCharacters();
    const chars = Array.isArray(allChars) ? allChars : (allChars?.characters || []);
    const found = chars.find(c => c.Name?.toLowerCase() === mainName.toLowerCase() && !c.Deleted);
    if (!found) {
      return {
        parentId: null,
        error: `❌ Could not find **${mainName}** in OpenDKP. Run /rosterimport to refresh the roster.`,
      };
    }
    // If this character is itself the root (ParentId=0), use their CharacterId.
    // If they have a ParentId, that's the family root — use it.
    const parentId = found.ParentId === 0 ? found.CharacterId : found.ParentId;
    return { parentId, error: null };
  } catch (err) {
    return { parentId: null, error: `❌ Failed to look up main in OpenDKP: ${err?.message}` };
  }
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
    )
    .addStringOption(opt =>
      opt.setName('rank')
        .setDescription('Rank to assign (default: Non-raid Alt — pick Recruit for a new raid main)')
        .setRequired(false)
        // ⚠ Recruit added 2026-09-22: there was no way to register a new RAID
        // MAIN here at all, only an alt or a trader (the guild lead: "I should
        // be able to register a new raid main from that, this wasn't available
        // as an option… raid mains often start as 'Recruit'").
        // Listed first for discoverability; the default is unchanged, so an
        // officer who picks nothing still gets Non-raid Alt.
        // The string is the one OpenDKP actually uses — 17 characters in the
        // mirror carry it — not an invented label.
        .addChoices(
          { name: 'Recruit (new raid main)', value: 'Recruit' },
          { name: 'Non-raid Alt',            value: 'Non-raid Alt' },
          { name: 'Trader level 1',          value: 'Trader level 1' },
        )
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
    const rank      = interaction.options.getString('rank') || 'Non-raid Alt';

    // Proper-case the name
    const name = rawName.replace(/\b\w/g, c => c.toUpperCase());

    // ⚠ Traders and non-raid alts are OURS, not OpenDKP's (the guild lead,
    // 2026-09-22: "traders and non-raid Alts don't need to be in opendkp, only
    // in our db"). They never earn DKP and never count toward membership —
    // that predicate is OpenDKP rank `Raid Pack`+ — so a record upstream buys
    // nothing and clutters the roster export. Skip the create entirely; the
    // character lives in `characters` and in the roster threads.
    const localOnly = LOCAL_ONLY_RANKS.has(rank);

    // ── Validate + resolve ParentId ──────────────────────────────────────────
    let parentId = 0;
    if (mainName) {
      const mainChar = getCharacter(mainName);
      if (!mainChar) {
        return interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: `❌ **${mainName}** not found in the roster. Run /rosterimport first.`,
        });
      }
      if (mainChar.isAlt) {
        return interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: `❌ **${mainName}** is an alt — can't use an alt as a parent.`,
        });
      }

      // Fast path uses rootCharId; slow path fetches from API
      // Both paths may need async, so defer now
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      // ParentId only exists to link the family IN OpenDKP. A local-only
      // character is never created there, so resolving it would be a pointless
      // API round-trip that can also fail and block a registration that does
      // not need it. The local main↔alt link is `mainName`, below.
      if (!localOnly) {
        const { parentId: resolved, error } = await _resolveParentId(mainChar, mainName);
        if (error) return interaction.editReply(error);
        parentId = resolved;
      }
    }

    if (!interaction.deferred) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // ── Create character in OpenDKP (raid ranks only) ────────────────────────
    let newCharId = null;
    if (!localOnly) {
      try {
        const result = await createCharacter({
          Name:     name,
          Class:    charClass,
          Race:     charRace,
          Level:    10,
          Active:   1,
          Rank:     rank,
          ParentId: parentId,
        });
        newCharId = result?.CharacterId ?? result?.characterId ?? result?.id ?? null;
      } catch (err) {
        return interaction.editReply(`❌ Failed to create character in OpenDKP: ${err?.message}`);
      }
    } else {
      // ⚠ The DURABLE home. The roster lives in Discord threads that
      // `/rosterimport` rewrites from the OpenDKP export, and `characters` is
      // the table the rest of the platform reads. `openDkpSync` upserts and
      // never deletes, so a row it has never seen upstream survives its passes
      // — which is what makes this safe as the record of a local character.
      // Best-effort: a Supabase hiccup must not lose the roster entry below.
      try {
        const supabase = require('../utils/supabase');
        if (supabase.isEnabled()) {
          await supabase.upsert('characters', [{
            guild_id:  process.env.SUPABASE_GUILD_ID || 'wolfpack',
            name,
            class:     charClass,
            race:      charRace,
            rank,
            main_name: mainName || null,
            active:    true,
          }], 'guild_id,name');
        }
      } catch (err) {
        console.warn('[register] local-only characters upsert failed:', err?.message);
      }
    }

    // ── Build DKP URL ────────────────────────────────────────────────────────
    const clientName = process.env.OPENDKP_CLIENT_NAME || 'wolfpack';
    const dkpUrl     = newCharId != null ? `https://${clientName}.opendkp.com/#/characters/${newCharId}` : null;

    // ── Add to local roster ──────────────────────────────────────────────────
    // For a new main (no mainName), rootCharId = their own CharacterId (they become family root)
    const rootCharId = mainName ? null : newCharId;
    addCharacterEntry({ name, race: charRace, charClass, dkpUrl, mainName, rootCharId });

    saveRosters(interaction.client, `/register ${name} by ${interaction.user?.tag || interaction.user?.id || '?'}`).catch(err =>
      console.warn('[register] saveRosters failed:', err?.message)
    );

    // ── Officer notification ─────────────────────────────────────────────────
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
            { name: 'Race',  value: charRace,  inline: true },
            { name: 'Class', value: charClass, inline: true },
            { name: 'Rank',  value: rank,      inline: true },
          );
        if (dkpUrl) embed.addFields({ name: '🔗 OpenDKP', value: `[View Character](<${dkpUrl}>)`, inline: false });
        // Say it plainly, so nobody goes hunting for a record that was never
        // meant to exist upstream.
        else if (localOnly) embed.addFields({ name: '📒 Where', value: 'Guild roster only — not created in OpenDKP.', inline: false });
        await ch.send({ embeds: [embed] });
      } catch (err) {
        console.warn('[register] officer notification failed:', err?.message);
      }
    }

    // ── Reply ────────────────────────────────────────────────────────────────
    const classEmoji = CLASS_EMOJI[charClass] || '❓';
    const lines = [`✅ **${name}** created successfully!`, `${classEmoji} ${charRace} ${charClass} — ${rank}`];
    if (mainName) lines.push(`Alt of **${mainName}**`);
    // ⚠ Three states, not two. "No URL" used to mean one thing — the create
    // succeeded but OpenDKP did not hand back an id — and the message said so.
    // A local-only rank now also has no URL, and telling an officer to go
    // verify it upstream would send them looking for a record we deliberately
    // never made.
    if (dkpUrl)        lines.push(`🔗 [View on OpenDKP](<${dkpUrl}>)`);
    else if (localOnly) lines.push('📒 Saved to the guild roster only — traders and non-raid alts are not created in OpenDKP.');
    else               lines.push('*(CharacterId not returned — verify on OpenDKP)*');

    await interaction.editReply(lines.join('\n'));
  },
};
