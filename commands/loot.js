// commands/loot.js — Post looted items for bidding.
//
// Usage: /loot paste:<zeal_text> [boss:<boss>] [bid_minutes:<N>]
//
// Flow:
//   1. Parse Zeal item paste → [{ gameItemId, name, quantity }]
//   2. Fetch guild drop history from OpenDKP (cached 1h) → rarity labels
//   3. Optionally scrape PQDI drop table from boss's NPC page → ULTRA RARE check
//   4. Build and post a loot announcement embed to the current channel
//   5. OpenDKP auction creation → PENDING (see utils/opendkp.js createAuctions)
//
// Rarity labels:
//   🆕 NEW         — never appeared in guild raid history
//   💎 ULTRA RARE  — seen exactly once AND drop rate in bottom 25% of boss's table
//
// Quest turn-ins: items used for quest hand-ins (e.g., "Remains of Vah Kerrath")
//   are bid on normally — they appear in the Zeal paste with a regular item ID.
//   The PQDI link in the embed shows the full item context.
//
// Once the OpenDKP auction creation cURL is captured, uncomment the auction block
// in execute() and update utils/opendkp.js createAuctions().

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { hasAllowedRole, allowedRolesList }  = require('../utils/roles');
const { getRaids, getRaid, getMostRecentRaid } = require('../utils/opendkp');
const { setPendingLoot }                    = require('../utils/state');
const {
  parseZealLoot,
  fetchPqdiDropTable,
  getDropHistory,
  enrichLootItems,
  buildLootAnnounceEmbed,
  buildLootComponents,
} = require('../utils/loot');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loot')
    .setDescription('Post looted items for DKP bidding (officer use)')
    .addStringOption(opt =>
      opt.setName('paste')
        .setDescription('Zeal item paste (pipe, comma, or space delimited)')
        .setRequired(true)
        .setMaxLength(2000)
    )
    .addStringOption(opt =>
      opt.setName('boss')
        .setDescription('Boss that dropped the loot (enables drop-rate rarity check)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption(opt =>
      opt.setName('bid_minutes')
        .setDescription('Minutes before bidding closes (default from LOOT_DEFAULT_BID_MINUTES env, or 3)')
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(120)
    ),

  async autocomplete(interaction) {
    const bosses  = getBosses();
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const choices = bosses.map(b => ({
      name:  `${b.emoji ? b.emoji + ' ' : ''}${b.name} (${b.zone})`,
      value: b.id,
      terms: [b.name.toLowerCase(), ...(b.nicknames || []).map(n => n.toLowerCase())],
    }));
    await interaction.respond(
      choices
        .filter(c => !focused || c.terms.some(t => t.includes(focused)) || c.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map(({ name, value }) => ({ name, value }))
    );
  },

  async execute(interaction) {
    if (!hasAllowedRole(interaction.member)) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `❌ You need one of these roles: ${allowedRolesList()}`,
      });
    }

    const pasteText  = interaction.options.getString('paste');
    const bossId     = interaction.options.getString('boss');
    // Default bidding duration. OpenDKP's web UI defaults to 3 minutes; we
    // mirror that here so the Discord timer matches the auction timer in
    // OpenDKP. Officers can override per /loot via `bid_minutes:` or set a
    // guild-wide default via the LOOT_DEFAULT_BID_MINUTES env var.
    const envDefault = parseInt(process.env.LOOT_DEFAULT_BID_MINUTES || '', 10);
    const defaultBidMinutes = Number.isFinite(envDefault) && envDefault >= 1 ? envDefault : 3;
    const bidMinutes = interaction.options.getInteger('bid_minutes') ?? defaultBidMinutes;

    // ── Parse Zeal paste ──────────────────────────────────────────────────────
    const parsedItems = parseZealLoot(pasteText);
    if (parsedItems.length === 0) {
      return interaction.reply({
        flags: MessageFlags.Ephemeral,
        content:
          '❌ Could not parse any items from that paste.\n' +
          'Expected format: `0019618Item Name | 0019616Other Item (2)`\n' +
          'Zeal formats supported: pipe ( | ), comma ( , ), or space-delimited.',
      });
    }

    // Defer so we can do async work (drop history + PQDI scrape can take a few seconds)
    await interaction.deferReply();

    // ── Boss context ──────────────────────────────────────────────────────────
    const bosses = getBosses();
    const boss   = bossId ? bosses.find(b => b.id === bossId) : null;

    // ── Fetch guild drop history (cached 1h) ──────────────────────────────────
    let dropHistory = null;
    if (process.env.OPENDKP_RAIDS_URL) {
      try {
        dropHistory = await getDropHistory({ getRaids, getRaid });
      } catch (err) {
        console.warn('[loot] Drop history fetch failed:', err?.message);
        // Non-fatal — rarity labels will be omitted
      }
    }

    // ── Fetch PQDI drop table (only if boss with pqdiUrl provided) ───────────
    let dropTable = null;
    if (boss?.pqdiUrl) {
      try {
        dropTable = await fetchPqdiDropTable(boss.pqdiUrl);
      } catch (err) {
        console.warn('[loot] PQDI drop table fetch failed:', err?.message);
      }
    }

    // ── Enrich items with rarity labels ──────────────────────────────────────
    const enrichedItems = enrichLootItems(parsedItems, dropHistory, dropTable);

    // ── Verify there's an active raid in OpenDKP to link auctions against ───
    // OpenDKP auto-links a new auction to whatever raid is currently open
    // for this client — no RaidId in the create-auction payload. If no raid
    // is open, the auction would still post but with no DKP-charge target.
    // We show the linked raid in the embed so officers can confirm at a glance.
    let activeRaid = null;
    if (process.env.OPENDKP_RAIDS_URL) {
      try { activeRaid = await getMostRecentRaid(); }
      catch (err) { console.warn('[loot] getMostRecentRaid failed:', err?.message); }
    }

    // ── Build embed + interactive button rows ─────────────────────────────────
    const bossName = boss?.name ?? null;
    const embed    = buildLootAnnounceEmbed(enrichedItems, bossName, bidMinutes);
    if (activeRaid) {
      embed.addFields({
        name:  'Linked raid',
        value: `**${activeRaid.Name || '?'}** · #${activeRaid.RaidId}`,
        inline: false,
      });
    } else {
      embed.setFooter({ text: '⚠ No active raid found in OpenDKP — start one before posting auctions.' });
    }
    const components = buildLootComponents(enrichedItems);

    const sent = await interaction.editReply({ embeds: [embed], components });

    // ── Persist the pending batch so button clicks can mutate it ──────────────
    // Keyed by the announcement message ID; cleared on Post / Cancel / midnight.
    if (sent?.id) {
      setPendingLoot(sent.id, {
        messageId:  sent.id,
        channelId:  interaction.channelId,
        officerId:  interaction.user.id,
        items:      enrichedItems,
        bossName,
        bidMinutes,
        activeRaidId:   activeRaid?.RaidId  || null,
        activeRaidName: activeRaid?.Name    || null,
        createdAt:  Date.now(),
      });
    }

    // Warn if items were auto-capped at 20 (Discord button limit)
    if (enrichedItems.length > 20) {
      await interaction.followUp({
        flags:   MessageFlags.Ephemeral,
        content: `⚠ Only the first 20 items show remove-buttons (Discord limit). All ${enrichedItems.length} items will still be auctioned on Post.`,
      });
    }

    // ── Wishlist auto-bid notifications ──────────────────────────────────────
    // Look up wishlisters for each dropped item, post ephemeral DMs after a
    // brief delay so they can act if they want — and record the auto-bid
    // intent in Supabase so the bid pipeline picks them up.
    //
    // Default delay: 12 seconds. This gives manual fast-clickers a small head
    // start (per the 'vigor stays high' design) while still ensuring the busy
    // player who can't alt-tab gets bid in automatically before the timer ends.
    try {
      const supabase   = require('../utils/supabase');
      const { decryptBid } = require('../utils/bidCrypto');
      if (supabase.isEnabled()) {
        const itemIds = enrichedItems.map(i => i.gameItemId);
        const wishlistRows = await supabase.select(
          'wishlists',
          `item_id=in.(${itemIds.join(',')})&select=character_name,item_id,priority,bid_amount_enc,bid_amount,note`
        );

        if (Array.isArray(wishlistRows) && wishlistRows.length > 0) {
          // Group by item_id; decrypt each bid in the bot process (never returned to Discord raw)
          const byItem = new Map();
          for (const w of wishlistRows) {
            const bid = decryptBid(w.bid_amount_enc) ?? w.bid_amount ?? null;
            if (!byItem.has(w.item_id)) byItem.set(w.item_id, []);
            byItem.get(w.item_id).push({ ...w, _bid: bid });
          }

          // Post officer-visible summary with each wishlister's sealed bid amount.
          // Sealed bid semantics: each row is the EXACT amount that will be bid —
          // no escalation, no overage. NULL bid = 1 DKP safe default.
          // Sort by effective bid descending so the projected winner is on top.
          const summary = enrichedItems
            .filter(i => byItem.has(i.gameItemId))
            .map(i => {
              const wishers = byItem.get(i.gameItemId)
                .map(w => ({ ...w, _eff: w._bid ?? 1 }))
                .sort((a, b) => b._eff - a._eff || a.priority - b.priority);

              const lines = wishers.map((w, idx) => {
                const marker  = idx === 0 ? '🏆' : '  ';
                const bid     = w._bid ? `**${w._bid.toLocaleString()}** DKP` : '`1 DKP`';
                const noteStr = w.note ? ` *(${w.note})*` : '';
                return `${marker} ${w.character_name} · P${w.priority} · ${bid}${noteStr}`;
              });
              return `• **${i.name}** — ${wishers.length} wishlister(s):\n${lines.join('\n')}`;
            });
          if (summary.length) {
            await interaction.followUp({
              flags: MessageFlags.Ephemeral,
              content:
                `🎯 **Wishlist matches** (sealed bids queued for ~12s):\n${summary.join('\n')}\n\n` +
                `🏆 = projected winner (highest sealed bid, ties broken by priority).\n` +
                `These are **closed bids** — no escalation. Tell-bids submitted by other players will be merged in at settlement.`,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[loot] wishlist lookup failed:', err?.message);
    }

    // ── OpenDKP Auction Creation ──────────────────────────────────────────────
    // Live: creation now happens when the officer clicks "📣 Post Auctions" on
    // the button row.  See handleLootPost() in index.js.  Item removal happens
    // via individual ✖ buttons.  See utils/loot.js buildLootComponents.

    // ── Rarity summary for officer context (ephemeral follow-up) ─────────────
    const newItems   = enrichedItems.filter(i => i.rarityLabel === '🆕 NEW');
    const ultraItems = enrichedItems.filter(i => i.rarityLabel === '💎 ULTRA RARE');
    if (newItems.length > 0 || ultraItems.length > 0) {
      const lines = [];
      if (newItems.length)   lines.push(`🆕 NEW: ${newItems.map(i => i.name).join(', ')}`);
      if (ultraItems.length) lines.push(`💎 ULTRA RARE: ${ultraItems.map(i => i.name).join(', ')}`);
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        content: `📊 Rarity flags detected:\n${lines.join('\n')}`,
      });
    }
  },
};
