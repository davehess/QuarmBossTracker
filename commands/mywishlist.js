// commands/mywishlist.js — Private self-view of your wishlist with full bid visibility.
//
// Usage: /mywishlist [character]
//
// What this shows (always ephemeral — visible ONLY to the caller):
//   • Every item still on your wishlist (not yet won from loot_drops)
//   • Your sealed bid per item (decrypted from bid_amount_enc)
//   • Whether the item has previously dropped — who won it and for how much
//     (context to calibrate your bid; knowing past winners helps set strategy)
//   • Total DKP committed across all items
//   • Headroom vs your current DKP balance from OpenDKP
//
// Privacy model:
//   • Always ephemeral → only the caller can see the response
//   • Bid amounts are decrypted locally (bot process) and never written back
//   • To view ANOTHER character's bids, you need officer role AND the output
//     still redacts bids (shows "🔒 sealed" instead of the amount)
//
// The "previous drop history" block shows what others paid for the same item.
// This is intentionally public-facing (the auction winner is announced anyway)
// and helps under-bidders adjust their wishlist bid for the next drop.

'use strict';

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const supabase              = require('../utils/supabase');
const { decryptBid, isEncryptionEnabled } = require('../utils/bidCrypto');
const { getCharacter, getAllNames }        = require('../utils/roster');
const { hasAllowedRole }                  = require('../utils/roles');

// ── DKP helper (mirrors dkp.js / wishlist.js — kept independent) ────────────
async function _currentDkp(name) {
  try {
    const { getCharacters } = require('../utils/opendkp');
    const res  = await getCharacters();
    const list = Array.isArray(res) ? res : (res?.Characters || res?.characters || []);
    const lc   = name.toLowerCase();
    const char = list.find(c => (c.Name || c.name || '').toLowerCase() === lc);
    if (!char) return null;
    const v = char.CurrentDkp ?? char.currentDkp ?? char.Points ?? char.points ?? char.dkp ?? char.DKP;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

// ── Progress bar helper ──────────────────────────────────────────────────────
function _progressBar(current, max, length = 10) {
  if (!max || max <= 0) return '';
  const filled = Math.min(Math.round((current / max) * length), length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

// ── Main execute ─────────────────────────────────────────────────────────────
async function execute(interaction) {
  if (!supabase.isEnabled()) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: '❌ Wishlists require Supabase. `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` must be set.',
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // ── Resolve character ────────────────────────────────────────────────────
  const charArg = interaction.options.getString('character');
  let targetName = charArg;

  if (!targetName) {
    // Infer from Discord display name (same logic as /dkp)
    const displayName = interaction.member?.displayName || interaction.user.username;
    const guessed = getCharacter(displayName);
    if (guessed) targetName = guessed.name;
  }

  if (!targetName) {
    return interaction.editReply({
      content:
        '❓ Couldn\'t infer your character from your Discord display name.\n' +
        'Run `/mywishlist character:<name>` to specify it directly.',
    });
  }

  const rosterChar = getCharacter(targetName);
  if (!rosterChar) {
    return interaction.editReply({
      content: `❌ **${targetName}** isn't in the roster. Check spelling or run /who.`,
    });
  }

  // ── Privacy check ────────────────────────────────────────────────────────
  // Only the character's owner (inferred from display name) or officers can
  // view a wishlist via /mywishlist. If someone specifies another player's
  // character and isn't an officer, bid amounts are hidden.
  const selfDisplayName = (interaction.member?.displayName || interaction.user.username).toLowerCase();
  const selfRosterChar  = getCharacter(selfDisplayName);
  const isSelf          = selfRosterChar?.name?.toLowerCase() === rosterChar.name.toLowerCase()
                       || selfDisplayName === rosterChar.name.toLowerCase();
  const isOfficer       = hasAllowedRole(interaction.member);
  const showBids        = isSelf || isOfficer; // officers see bids when running the auction

  // ── Fetch wishlist rows ───────────────────────────────────────────────────
  const wishRows = await supabase.select(
    'wishlists',
    `character_name=eq.${encodeURIComponent(rosterChar.name)}&order=priority.asc&select=*`
  );

  if (!Array.isArray(wishRows) || wishRows.length === 0) {
    return interaction.editReply({
      content:
        `📭 **${rosterChar.name}** has no items wishlisted.\n` +
        `Use \`/wishlist add character:${rosterChar.name} item:<name>\` to start.`,
    });
  }

  // ── Resolve item names from eqemu_items ─────────────────────────────────
  const itemIds  = wishRows.map(r => r.item_id);
  const itemRows = await supabase.select(
    'eqemu_items',
    `id=in.(${itemIds.join(',')})&select=id,name,lore_flag`
  );
  const itemsMap = new Map((itemRows || []).map(i => [i.id, i]));

  // ── Fetch previous drops for wishlisted items (all characters, all time) ─
  // Shows who won these items before and for how much — helps calibrate bids.
  // runner_up_bids is intentionally excluded here (it contains others' bids).
  const dropRows = await supabase.select(
    'loot_drops',
    `item_id=in.(${itemIds.join(',')})` +
    `&select=item_id,winner_character,dkp_spent,awarded_at` +
    `&order=awarded_at.desc`
  );
  // Group by item_id
  const dropsByItem = new Map();
  if (Array.isArray(dropRows)) {
    for (const d of dropRows) {
      if (!dropsByItem.has(d.item_id)) dropsByItem.set(d.item_id, []);
      dropsByItem.get(d.item_id).push(d);
    }
  }

  // ── Fetch current DKP balance ─────────────────────────────────────────────
  const currentDkp = await _currentDkp(rosterChar.name);

  // ── Decrypt and compute totals ────────────────────────────────────────────
  const items = wishRows.map(r => {
    const bid = decryptBid(r.bid_amount_enc) ?? r.bid_amount ?? null; // enc first, plaintext fallback
    return { ...r, _bid: bid };
  });

  const totalCommitted = items.reduce((s, r) => s + (r._bid ?? 1), 0);
  const headroom       = currentDkp !== null ? currentDkp - totalCommitted : null;
  const overcommitted  = headroom !== null && headroom < 0;

  // ── Build embed lines ─────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(overcommitted ? 0xed4245 : 0x5865f2)
    .setTitle(`🎯 ${rosterChar.name}'s Wishlist`);

  const lines = [];

  for (const r of items) {
    const item     = itemsMap.get(r.item_id);
    const name     = item ? item.name : `Item ${r.item_id}`;
    const pqdiLink = `[${name}](<https://www.pqdi.cc/item/${r.item_id}>)`;
    const lore     = item?.lore_flag ? ' 🔒' : '';

    // Sealed bid display
    let bidStr;
    if (!showBids) {
      bidStr = '`🔒 sealed`';
    } else if (r._bid !== null) {
      const allInFlag = currentDkp !== null && r._bid >= currentDkp ? ' 💎' : '';
      bidStr = `**${r._bid.toLocaleString()} DKP**${allInFlag}`;
    } else {
      bidStr = '`1 DKP` *(safe default)*';
    }

    const noteStr = r.note ? `  *${r.note}*` : '';
    lines.push(`\`P${r.priority}\` ${pqdiLink}${lore} · ${bidStr}${noteStr}`);

    // Previous drop history for this item
    const drops = dropsByItem.get(r.item_id);
    if (drops && drops.length > 0) {
      // Show up to 3 most recent wins
      const recent = drops.slice(0, 3);
      const dropLines = recent.map(d => {
        const date = d.awarded_at ? new Date(d.awarded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '?';
        const dkpStr = d.dkp_spent ? `${d.dkp_spent.toLocaleString()} DKP` : 'unknown DKP';
        const winner = d.winner_character || 'unknown';
        return `  → ${winner} won for ${dkpStr} (${date})`;
      });
      if (drops.length > 3) dropLines.push(`  *(+ ${drops.length - 3} earlier drop${drops.length - 3 === 1 ? '' : 's'})*`);
      lines.push(dropLines.join('\n'));
    } else {
      lines.push(`  → *No recorded drops in guild history.*`);
    }

    lines.push(''); // spacer between items
  }

  embed.setDescription(lines.join('\n').slice(0, 4000));

  // ── Summary footer ────────────────────────────────────────────────────────
  const footerParts = [];
  if (showBids) {
    footerParts.push(`${items.length} item${items.length === 1 ? '' : 's'} · Total committed: ${totalCommitted.toLocaleString()} DKP`);
    if (currentDkp !== null) {
      const bar = _progressBar(totalCommitted, currentDkp);
      if (overcommitted) {
        footerParts.push(`⚠️ Balance: ${currentDkp.toLocaleString()} DKP | Overcommitted by ${Math.abs(headroom).toLocaleString()} DKP`);
      } else {
        footerParts.push(`Balance: ${currentDkp.toLocaleString()} DKP | Headroom: ${headroom.toLocaleString()} DKP [${bar}]`);
      }
    } else {
      footerParts.push(`OpenDKP balance unavailable`);
    }
    if (!isEncryptionEnabled()) {
      footerParts.push(`⚠️ Bid encryption not active — set WISHLIST_BID_KEY for full privacy`);
    }
  } else {
    footerParts.push(`${items.length} item${items.length === 1 ? '' : 's'} · Bid amounts sealed (officers only see bids during active auctions)`);
  }

  embed.setFooter({ text: footerParts.join('\n') });

  if (overcommitted && showBids) {
    embed.addFields({
      name: '⚠️ Overcommitted',
      value:
        `Your total sealed bids (**${totalCommitted.toLocaleString()} DKP**) exceed your current balance ` +
        `(**${currentDkp.toLocaleString()} DKP**). If multiple items drop on the same night, ` +
        `bids will be filled in priority order. Consider reducing lower-priority bids.`,
      inline: false,
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

// ── Command definition ────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('mywishlist')
    .setDescription('Show your private wishlist — sealed bids, drop history, DKP headroom')
    .addStringOption(o =>
      o.setName('character')
        .setDescription('Character name (default: inferred from your Discord display name)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names   = getAllNames()
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

  execute,
};
