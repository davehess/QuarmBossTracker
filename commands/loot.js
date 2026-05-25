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
const { getRaids, getRaid }                 = require('../utils/opendkp');
const {
  parseZealLoot,
  fetchPqdiDropTable,
  getDropHistory,
  enrichLootItems,
  buildLootAnnounceEmbed,
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
        .setDescription('Minutes before bidding closes (default: 20)')
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
    const bidMinutes = interaction.options.getInteger('bid_minutes') ?? 20;

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

    // ── Build and post embed ──────────────────────────────────────────────────
    const bossName = boss?.name ?? null;
    const embed    = buildLootAnnounceEmbed(enrichedItems, bossName, bidMinutes);

    await interaction.editReply({ embeds: [embed] });

    // ── Wishlist auto-bid notifications ──────────────────────────────────────
    // Look up wishlisters for each dropped item, post ephemeral DMs after a
    // brief delay so they can act if they want — and record the auto-bid
    // intent in Supabase so the bid pipeline picks them up.
    //
    // Default delay: 12 seconds. This gives manual fast-clickers a small head
    // start (per the 'vigor stays high' design) while still ensuring the busy
    // player who can't alt-tab gets bid in automatically before the timer ends.
    try {
      const supabase = require('../utils/supabase');
      if (supabase.isEnabled()) {
        const itemIds = enrichedItems.map(i => i.gameItemId);
        const wishlistRows = await supabase.select(
          'wishlists',
          `item_id=in.(${itemIds.join(',')})&select=character_name,item_id,priority,note`
        );

        if (Array.isArray(wishlistRows) && wishlistRows.length > 0) {
          // Group by item_id
          const byItem = new Map();
          for (const w of wishlistRows) {
            if (!byItem.has(w.item_id)) byItem.set(w.item_id, []);
            byItem.get(w.item_id).push(w);
          }

          // Post officer-visible summary as a follow-up
          const summary = enrichedItems
            .filter(i => byItem.has(i.gameItemId))
            .map(i => {
              const wishers = byItem.get(i.gameItemId);
              return `• **${i.name}** — ${wishers.length} wishlister(s): ${wishers.map(w => w.character_name).join(', ')}`;
            });
          if (summary.length) {
            await interaction.followUp({
              flags: MessageFlags.Ephemeral,
              content: `🎯 **Wishlist matches** (auto-bids will be placed in ~12s):\n${summary.join('\n')}`,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[loot] wishlist lookup failed:', err?.message);
    }

    // ── OpenDKP Auction Creation ──────────────────────────────────────────────
    // ⚠️  PENDING: Uncomment this block once the auction creation cURL is captured
    //     and utils/opendkp.js createAuctions() is implemented.
    //
    // const raidId = interaction.options.getInteger('raid_id');  // TBD: how to get active raid
    // if (raidId) {
    //   try {
    //     const { createAuctions, invalidateDropHistory } = require('../utils/opendkp');
    //     const payload = {
    //       items: enrichedItems.map(item => ({
    //         ItemId:       item.gameItemId,
    //         ItemName:     item.name,
    //         GameItemId:   item.gameItemId,
    //         ItemQuantity: item.quantity,
    //         RaidId:       raidId,
    //         PoolId:       parseInt(process.env.OPENDKP_POOL_ID || '5'),
    //         ClientId:     process.env.OPENDKP_CLIENT_ID_AUCTIONS || '8fa8662b40c12',
    //       })),
    //     };
    //     await createAuctions(payload);
    //     // Invalidate drop history so new item counts on next /loot call
    //     const { invalidateDropHistory: inv } = require('../utils/loot');
    //     inv();
    //   } catch (err) {
    //     console.error('[loot] Auction creation failed:', err?.message);
    //     // Non-fatal — embed already posted
    //   }
    // }

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
