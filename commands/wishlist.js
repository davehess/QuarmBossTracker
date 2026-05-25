// commands/wishlist.js — Async-friendly BIS registration.
//
// Members register items they want (with a per-item DKP ceiling) between
// raids. When the item drops during a raid, the bot auto-places a minimum
// bid on their behalf so they never miss it because they were busy healing.
//
// Subcommands:
//   /wishlist add character:<...> item:<...> max_dkp:<N> [priority:<1-10>] [note:<...>]
//   /wishlist remove character:<...> item:<...>
//   /wishlist show [character:<...>]
//   /wishlist import character:<...> url:<quarmy_bis_url>          (placeholder for 2.1)
//
// Storage: Supabase `wishlists` table. Returns clear errors if Supabase isn't
// configured — wishlists are inherently async, so no local-cache fallback.

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const supabase = require('../utils/supabase');
const { getCharacter, getAllNames } = require('../utils/roster');
const { hasAllowedRole } = require('../utils/roles');

// ── Item resolution ─────────────────────────────────────────────────────────
// Two ways to specify an item:
//   1. By GameItemId (the 7-digit EQ ID from Zeal pastes or PQDI URLs)
//   2. By name (autocomplete from eqemu_items if Supabase is populated)

async function _findItem(query) {
  if (!supabase.isEnabled()) return null;

  // Numeric → direct lookup
  const num = parseInt(query, 10);
  if (!isNaN(num) && String(num) === query.trim()) {
    const rows = await supabase.select('eqemu_items', `id=eq.${num}&select=id,name,lore_flag`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // Name → ilike search
  const enc = encodeURIComponent(`*${query.toLowerCase()}*`);
  const rows = await supabase.select('eqemu_items', `name=ilike.${enc}&select=id,name,lore_flag&limit=2`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (rows.length > 1) return { _ambiguous: rows };
  return rows[0];
}

// ── Subcommand: add ─────────────────────────────────────────────────────────
async function _add(interaction) {
  const characterArg = interaction.options.getString('character');
  const itemQuery    = interaction.options.getString('item');
  const maxDkp       = interaction.options.getInteger('max_dkp');
  const priority     = interaction.options.getInteger('priority') ?? 5;
  const note         = interaction.options.getString('note') ?? null;

  // Validate character against roster
  const rosterChar = getCharacter(characterArg);
  if (!rosterChar) {
    return interaction.editReply({
      content: `❌ **${characterArg}** isn't in the roster. Run /rosterimport, or check spelling with /who.`,
    });
  }

  const item = await _findItem(itemQuery);
  if (!item) {
    return interaction.editReply({
      content:
        `❌ Couldn't find an item matching "${itemQuery}".\n` +
        `Try the 7-digit ID from a Zeal paste (e.g. \`0019618\`), ` +
        `or search by an exact partial name once eqemu_items is populated.`,
    });
  }
  if (item._ambiguous) {
    const list = item._ambiguous.map(r => `\`${r.id}\` — **${r.name}**`).join('\n');
    return interaction.editReply({
      content:
        `🔎 Multiple items match "${itemQuery}":\n${list}\n` +
        `Re-run /wishlist add with the specific 7-digit ID.`,
    });
  }

  const row = {
    character_name: rosterChar.name,
    item_id:        item.id,
    priority,
    note,
    source:         'manual',
    source_url:     null,
  };

  const result = await supabase.upsert('wishlists', [row], 'character_name,item_id');
  if (!result) {
    return interaction.editReply({
      content: '⚠️ Supabase write failed. Check bot logs.',
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎯 Wishlist updated')
    .setDescription(
      `**${rosterChar.name}** added **[${item.name}](<https://www.pqdi.cc/item/${item.id}>)** ` +
      `(max **${maxDkp.toLocaleString()}** DKP, priority **${priority}**)${item.lore_flag ? ' · 🔒 LORE' : ''}.`
    );
  if (note) embed.addFields({ name: 'Note', value: note, inline: false });
  embed.setFooter({ text: 'When this item drops, the bot will auto-place a 1 DKP bid for you.' });

  return interaction.editReply({ embeds: [embed] });
}

// ── Subcommand: remove ──────────────────────────────────────────────────────
async function _remove(interaction) {
  const characterArg = interaction.options.getString('character');
  const itemQuery    = interaction.options.getString('item');

  const rosterChar = getCharacter(characterArg);
  if (!rosterChar) {
    return interaction.editReply({ content: `❌ **${characterArg}** isn't in the roster.` });
  }

  // Allow remove by either name (Supabase lookup) or raw item_id
  let itemId = null;
  const asNum = parseInt(itemQuery, 10);
  if (!isNaN(asNum) && String(asNum) === itemQuery.trim()) itemId = asNum;
  else {
    const item = await _findItem(itemQuery);
    if (!item || item._ambiguous) {
      return interaction.editReply({
        content: `❌ Couldn't pin down "${itemQuery}". Try the exact 7-digit item ID.`,
      });
    }
    itemId = item.id;
  }

  // PostgREST delete via ?col=eq.x&col2=eq.y
  const url = `/wishlists?character_name=eq.${encodeURIComponent(rosterChar.name)}&item_id=eq.${itemId}`;
  const result = await supabase._request ? null : null;  // explicit DELETE below

  // Use the raw fetch via supabase.update with a DELETE method instead
  await supabase.rpc; // touch to ensure module loaded
  const sb = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1${url}`,
    {
      method: 'DELETE',
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!sb.ok) {
    return interaction.editReply({ content: `⚠️ Delete failed (${sb.status}). Check bot logs.` });
  }

  return interaction.editReply({
    content: `🗑️ Removed item \`${itemId}\` from **${rosterChar.name}**'s wishlist.`,
  });
}

// ── Subcommand: show ────────────────────────────────────────────────────────
async function _show(interaction) {
  const characterArg = interaction.options.getString('character');

  // Default to user's character via display name
  let name = characterArg;
  if (!name) {
    const guess = interaction.member?.displayName || interaction.user.username;
    const c = getCharacter(guess);
    if (c) name = c.name;
  }
  if (!name) {
    return interaction.editReply({
      content: '❓ Provide a character name (autocomplete from roster).',
    });
  }

  const rosterChar = getCharacter(name);
  if (!rosterChar) {
    return interaction.editReply({ content: `❌ **${name}** isn't in the roster.` });
  }

  const rows = await supabase.select(
    'wishlists',
    `character_name=eq.${encodeURIComponent(rosterChar.name)}&order=priority.asc&select=*`
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return interaction.editReply({
      content: `📭 **${rosterChar.name}** has no items wishlisted. Use /wishlist add to start.`,
    });
  }

  // Resolve item names from eqemu_items (best-effort)
  const itemIds = rows.map(r => r.item_id);
  const itemsList = await supabase.select(
    'eqemu_items',
    `id=in.(${itemIds.join(',')})&select=id,name,lore_flag`
  );
  const itemsMap = new Map((itemsList || []).map(i => [i.id, i]));

  const lines = rows.map(r => {
    const item = itemsMap.get(r.item_id);
    const itemName = item ? `[${item.name}](<https://www.pqdi.cc/item/${r.item_id}>)` : `Item ${r.item_id}`;
    const lore = item?.lore_flag ? ' 🔒' : '';
    const noteStr = r.note ? `  *${r.note}*` : '';
    return `\`P${r.priority}\` ${itemName}${lore}${noteStr}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎯 ${rosterChar.name}'s wishlist`)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: `${rows.length} item${rows.length === 1 ? '' : 's'} · auto-bid 1 DKP when these drop` });

  return interaction.editReply({ embeds: [embed] });
}

// ── Slash command definition ────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('wishlist')
    .setDescription('Register items you want — bot auto-bids when they drop')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add an item to a character\'s wishlist')
        .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('item').setDescription('Item name or 7-digit ID').setRequired(true))
        .addIntegerOption(o => o.setName('max_dkp').setDescription('Maximum DKP to spend').setRequired(true).setMinValue(1).setMaxValue(50000))
        .addIntegerOption(o => o.setName('priority').setDescription('1=top BIS, 10=nice-to-have (default 5)').setMinValue(1).setMaxValue(10))
        .addStringOption(o => o.setName('note').setDescription('Optional note (e.g. "BIS for raids"; "weekend only")').setMaxLength(200))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove an item from a character\'s wishlist')
        .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('item').setDescription('Item name or 7-digit ID').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('show')
        .setDescription('Show a character\'s wishlist')
        .addStringOption(o => o.setName('character').setDescription('Character name (default: yours)').setAutocomplete(true))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names = getAllNames()
      .filter(n => !focused || n.includes(focused))
      .sort()
      .slice(0, 25);
    await interaction.respond(names.map(n => {
      const c = getCharacter(n);
      const label = c
        ? `${c.name} (${c.race} ${c.class}${c.isAlt ? ` · Alt of ${c.mainName}` : ''})`
        : n;
      return { name: label.slice(0, 100), value: c?.name || n };
    }));
  },

  async execute(interaction) {
    if (!supabase.isEnabled()) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: '❌ Wishlists require Supabase. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set.',
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'add')    return await _add(interaction);
      if (sub === 'remove') return await _remove(interaction);
      if (sub === 'show')   return await _show(interaction);
      return interaction.editReply({ content: `❌ Unknown subcommand: ${sub}` });
    } catch (err) {
      console.error('[wishlist]', err);
      return interaction.editReply({ content: `⚠️ Error: ${err.message}` });
    }
  },
};
