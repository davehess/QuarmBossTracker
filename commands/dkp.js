// commands/dkp.js — Ephemeral DKP balance lookup. Phone-friendly.
//
// The single most-asked-during-raid question turned into one tap.
// No Supabase dependency — uses OpenDKP read API directly.
//
// Behavior:
//   /dkp                 → if your Discord display name matches a roster
//                          character, shows that character's balance.
//                          Otherwise prompts to specify one.
//   /dkp character:foo   → balance for that character (autocomplete from roster)
//   /dkp main:true       → for a Discord ID with multiple linked characters,
//                          shows the main + total family balance
//
// Always ephemeral. Never spams the channel.

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getCharacters }       = require('../utils/opendkp');
const { getCharacter, getAllNames, getActiveRoster } = require('../utils/roster');

// Short-lived cache for the OpenDKP characters response — keeps /dkp fast
// during raid when many people may run it back-to-back.
let _charCache = null;
let _charCacheAt = 0;
const CACHE_MS = 60 * 1000;  // 60 seconds

async function _fetchAllCharacters() {
  if (_charCache && Date.now() - _charCacheAt < CACHE_MS) return _charCache;
  try {
    const res = await getCharacters();
    const list = Array.isArray(res) ? res : (res?.Characters || res?.characters || []);
    _charCache   = list;
    _charCacheAt = Date.now();
    return list;
  } catch (err) {
    console.warn('[dkp] getCharacters failed:', err?.message);
    return _charCache || [];
  }
}

// OpenDKP field names vary — be defensive about which one carries the balance.
function _dkpFrom(char) {
  if (!char) return null;
  const candidates = [
    char.CurrentDkp, char.currentDkp,
    char.DkpPoints,  char.dkpPoints,
    char.Points,     char.points,
    char.dkp,        char.DKP,
  ];
  for (const v of candidates) if (typeof v === 'number') return v;
  return null;
}

function _nameFrom(char) {
  return char?.Name || char?.name || '';
}

function _rankFrom(char) {
  return char?.Rank || char?.rank || char?.Class || char?.class || '';
}

function _findCharOpendkp(list, name) {
  if (!name || !list?.length) return null;
  const lc = name.toLowerCase();
  return list.find(c => _nameFrom(c).toLowerCase() === lc) || null;
}

function _resolveCharNameFromInteraction(interaction) {
  // Try Discord display name match against roster — most common case
  const display = interaction.member?.displayName || interaction.user.username;
  const direct  = getCharacter(display);
  if (direct) return direct.name;

  // Try removing common suffixes (e.g. "Hitya | Officer" → "Hitya")
  const cleaned = display.split(/[\s|,(\-]/)[0]?.trim();
  if (cleaned && cleaned !== display) {
    const c = getCharacter(cleaned);
    if (c) return c.name;
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dkp')
    .setDescription('Look up a DKP balance. Always ephemeral — only you see it.')
    .addStringOption(opt =>
      opt.setName('character')
        .setDescription('Character name (defaults to your Discord display name)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addBooleanOption(opt =>
      opt.setName('family')
        .setDescription('Show main + all alts (default: just the named character)')
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names = getAllNames();
    const matches = names
      .filter(n => !focused || n.includes(focused))
      .sort()
      .slice(0, 25)
      .map(n => {
        const c = getCharacter(n);
        const label = c
          ? `${c.name} (${c.race} ${c.class}${c.isAlt ? ` · Alt of ${c.mainName}` : ''})`
          : n;
        return { name: label.slice(0, 100), value: c?.name || n };
      });
    await interaction.respond(matches);
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let name = interaction.options.getString('character');
    const showFamily = interaction.options.getBoolean('family') || false;

    // No explicit character → infer from Discord display
    if (!name) {
      name = _resolveCharNameFromInteraction(interaction);
      if (!name) {
        return interaction.editReply({
          content:
            '❓ Couldn\'t guess your character from your Discord name. ' +
            'Run again with `/dkp character:<your-name>` — autocomplete will help.',
        });
      }
    }

    const rosterChar = getCharacter(name);
    if (!rosterChar) {
      return interaction.editReply({
        content: `❌ **${name}** isn't in the roster. Has /rosterimport been run recently?`,
      });
    }

    const allOpenDkp = await _fetchAllCharacters();
    if (!allOpenDkp.length) {
      return interaction.editReply({
        content: '⚠️ Could not reach OpenDKP right now. Try again in a moment.',
      });
    }

    // Single character mode
    if (!showFamily) {
      const dkpChar = _findCharOpendkp(allOpenDkp, name);
      const dkp     = _dkpFrom(dkpChar);

      const embed = new EmbedBuilder()
        .setColor(0xf5a623)
        .setTitle(`💰 ${rosterChar.name}`)
        .setDescription(
          `${rosterChar.race} ${rosterChar.class}` +
          (rosterChar.isAlt && rosterChar.mainName ? ` · Alt of **${rosterChar.mainName}**` : '') +
          (rosterChar.dkpUrl ? ` · [OpenDKP](<${rosterChar.dkpUrl}>)` : '')
        )
        .addFields({
          name: 'Current DKP',
          value: dkp !== null ? `**${dkp.toLocaleString()}**` : '*not found in OpenDKP*',
          inline: false,
        });

      if (dkpChar?.Rank || dkpChar?.rank) {
        embed.addFields({ name: 'Rank', value: dkpChar.Rank || dkpChar.rank, inline: true });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // Family mode: this character (treated as main if it is, else lookup main)
    const mainName = rosterChar.isAlt ? rosterChar.mainName : rosterChar.name;
    const mainRoster = getCharacter(mainName);
    if (!mainRoster) {
      return interaction.editReply({
        content: `❌ Couldn't resolve the family for **${name}**.`,
      });
    }

    const familyNames = [mainName, ...(mainRoster.alts || []).map(a => a.name)];
    const familyEntries = familyNames.map(n => {
      const dkpChar = _findCharOpendkp(allOpenDkp, n);
      const dkp     = _dkpFrom(dkpChar);
      const rc      = getCharacter(n);
      return { name: n, dkp, rank: dkpChar?.Rank || dkpChar?.rank || '', isMain: n === mainName, rc };
    });

    const total = familyEntries.reduce((s, e) => s + (e.dkp || 0), 0);

    const embed = new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle(`💰 ${mainName} — family DKP`)
      .setDescription(`${familyEntries.length} character${familyEntries.length === 1 ? '' : 's'} in family`);

    for (const e of familyEntries) {
      const tag    = e.isMain ? '👑' : '↳';
      const dkpStr = e.dkp !== null ? `**${e.dkp.toLocaleString()}** DKP` : '*not on OpenDKP*';
      const rank   = e.rank ? ` · ${e.rank}` : '';
      embed.addFields({
        name:  `${tag} ${e.name}`,
        value: `${dkpStr}${rank}`,
        inline: false,
      });
    }

    embed.setFooter({ text: `Family total: ${total.toLocaleString()} DKP` });

    return interaction.editReply({ embeds: [embed] });
  },
};
