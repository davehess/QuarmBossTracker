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
// Fetch a character's current DKP from OpenDKP (best-effort, swallows errors).
// Reuses the same logic as /dkp but keeps this command independent.
async function _currentDkpForCharacter(name) {
  try {
    const { getCharacters } = require('../utils/opendkp');
    const res = await getCharacters();
    const list = Array.isArray(res) ? res : (res?.Characters || res?.characters || []);
    const lc = name.toLowerCase();
    const char = list.find(c => (c.Name || c.name || '').toLowerCase() === lc);
    if (!char) return null;
    const v = char.CurrentDkp ?? char.currentDkp ?? char.Points ?? char.points ?? char.dkp ?? char.DKP;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

async function _add(interaction) {
  const characterArg = interaction.options.getString('character');
  const itemQuery    = interaction.options.getString('item');
  const bidAmount    = interaction.options.getInteger('bid_amount') ?? null;
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
    bid_amount:     bidAmount,        // null = bid 1 DKP (safe default); N = exactly N DKP
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

  // Surface current DKP context — important when the user is deciding an all-in amount.
  // Closed/sealed bid means whatever they set IS what gets bid — no escalation, no overage.
  const currentDkp = await _currentDkpForCharacter(rosterChar.name);
  const bidStr = bidAmount
    ? `bid **${bidAmount.toLocaleString()}** DKP (sealed)`
    : `bid **1 DKP** (safe default)`;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎯 Wishlist updated')
    .setDescription(
      `**${rosterChar.name}** added **[${item.name}](<https://www.pqdi.cc/item/${item.id}>)** ` +
      `· priority **${priority}** · ${bidStr}${item.lore_flag ? ' · 🔒 LORE' : ''}.`
    );
  if (note) embed.addFields({ name: 'Note', value: note, inline: false });

  // DKP context + warnings
  if (currentDkp !== null) {
    const fields = [];
    fields.push(`Current DKP: **${currentDkp.toLocaleString()}**`);
    if (bidAmount && bidAmount > currentDkp) {
      fields.push(`⚠️ Bid (${bidAmount}) exceeds current DKP (${currentDkp}) — bid will be capped to balance at auction time.`);
    } else if (bidAmount && bidAmount === currentDkp) {
      fields.push(`💎 **All-in bid** — committing your entire balance.`);
    } else if (bidAmount) {
      fields.push(`Remaining if you win: **${(currentDkp - bidAmount).toLocaleString()}** DKP`);
    }
    embed.addFields({ name: '💰 DKP', value: fields.join('\n'), inline: false });
  }

  embed.setFooter({
    text: bidAmount
      ? `Closed bid: bot places exactly ${bidAmount.toLocaleString()} DKP if this drops. No escalation. Highest unique bid wins.`
      : 'Closed bid: bot places 1 DKP if this drops. Re-add with bid_amount to commit more.',
  });

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

  // Fetch current DKP for context — useful when reviewing all-in commitments
  const currentDkp = await _currentDkpForCharacter(rosterChar.name);
  const totalCommitted = rows.reduce((s, r) => s + (r.bid_amount || 1), 0);

  const lines = rows.map(r => {
    const item = itemsMap.get(r.item_id);
    const itemName = item ? `[${item.name}](<https://www.pqdi.cc/item/${r.item_id}>)` : `Item ${r.item_id}`;
    const lore = item?.lore_flag ? ' 🔒' : '';
    const noteStr = r.note ? `  *${r.note}*` : '';
    const bid = r.bid_amount
      ? `**${r.bid_amount.toLocaleString()}** DKP`
      : '`1 DKP`';
    const allIn = currentDkp !== null && r.bid_amount && r.bid_amount >= currentDkp ? ' 💎' : '';
    return `\`P${r.priority}\` ${itemName}${lore} · ${bid}${allIn}${noteStr}`;
  });

  const footerParts = [`${rows.length} item${rows.length === 1 ? '' : 's'}`];
  if (currentDkp !== null) footerParts.push(`current DKP: ${currentDkp.toLocaleString()}`);
  footerParts.push(`total committed if all drop: ${totalCommitted.toLocaleString()}`);
  if (currentDkp !== null && totalCommitted > currentDkp) {
    footerParts.push(`⚠️ committed > balance`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🎯 ${rosterChar.name}'s wishlist`)
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: footerParts.join(' · ') });

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
        .addIntegerOption(o => o.setName('bid_amount').setDescription('EXACT DKP to bid (closed/sealed). Omit = bot bids 1 DKP only. No escalation.').setRequired(false).setMinValue(1).setMaxValue(50000))
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
