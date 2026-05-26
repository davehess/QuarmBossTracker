// utils/loot.js — Zeal loot paste parser, PQDI drop-rate scraper,
// item rarity calculator, guild drop-history cache, and loot embed builder.
//
// Item rarity labels:
//   🆕 NEW       — item has never appeared in guild raid history
//   💎 ULTRA RARE — seen exactly once AND drop rate is in the bottom quartile
//                   of all drops on that boss's PQDI table (or ≤ 5% absolute)
//
// Wishlist support:
//   parseQuarmyWishlist(url) — future: fetch BIS list from quarmy.com and
//   return [{itemName, source}] for pre-loading bid suggestions.

const https = require('https');
const http  = require('http');
const { EmbedBuilder } = require('discord.js');

// ── Zeal Loot Paste Parser ────────────────────────────────────────────────────
// Supported formats (all produced by Zeal's /loota or "LinkAll" commands):
//   Pipe-delimited (Alt+LinkAll):  "0019618Item Name | 0019616Other Item (2)"
//   Comma-delimited (LinkAll):     "0019618Item Name, 0019616Other Item (2)"
//   Space-delimited (raw link):    "0019618Item Name 0019616Other Item"
//
// Each entry: 7-digit zero-padded EQ item ID immediately followed by item name.
// Quantity appears at the end as "(N)" before any delimiter.
//
// Returns: [{ gameItemId: number, name: string, quantity: number }]
function parseZealLoot(text) {
  if (!text || !text.trim()) return [];

  const input = text.trim().replace(/\s+/g, ' ');

  // Determine segment delimiter
  let segments;
  if (input.includes(' | ') || /\|\s*\d{7}/.test(input)) {
    // Pipe-delimited (Alt+LinkAll)
    segments = input.split(/\s*\|\s*/).filter(Boolean);
  } else if (/,\s*\d{7}/.test(input)) {
    // Comma-delimited (LinkAll)
    segments = input.split(/,\s*(?=\d{7})/).filter(Boolean);
  } else {
    // Space-delimited: split before each 7-digit ID followed by a capital letter
    segments = input.split(/(?=\d{7}[A-Z])/).filter(Boolean);
  }

  const items = [];
  for (const seg of segments) {
    const s = seg.trim();
    // 7-digit zero-padded ID, then name (may contain spaces), then optional (qty)
    const m = s.match(/^(\d{7})(.+?)(?:\s*\((\d+)\))?\s*$/);
    if (!m) continue;

    const gameItemId = parseInt(m[1], 10);
    // Strip ASCII control characters (\x00-\x1f and \x7f DEL) that EverQuest
    // injects into item links — typically  (DC2) wraps each linked item.
    // Without this strip, names like "An eyeball" trail an invisible byte that
    // Discord renders as a "☐" box on button labels.
    const name = m[2].replace(/[\x00-\x1f\x7f]/g, '').trim();
    const quantity = m[3] ? parseInt(m[3], 10) : 1;

    if (!gameItemId || !name) continue;
    items.push({ gameItemId, name, quantity });
  }

  return items;
}

// ── PQDI Drop Table Scraper ───────────────────────────────────────────────────
function _fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'QuarmRaidBot/1.0' } }, (res) => {
      // Follow single-level redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('PQDI fetch timeout')); });
  });
}

// Scrape a PQDI NPC page and return its drop table.
// Returns: [{ itemId: number, itemName: string, chance: number }] (sorted by chance desc)
//   or null if unavailable / parse failed.
async function fetchPqdiDropTable(pqdiNpcUrl) {
  if (!pqdiNpcUrl || !pqdiNpcUrl.includes('pqdi.cc/npc/')) return null;

  let html;
  try {
    html = await _fetchHtml(pqdiNpcUrl);
  } catch (err) {
    console.warn('[loot] PQDI drop table fetch failed:', err?.message);
    return null;
  }

  const entries = [];
  const seen    = new Set();

  // Strategy: parse HTML table rows that contain both an /item/ link and a percentage.
  // PQDI renders drop tables as <tr> rows with <td><a href="/item/ID">Name</a></td><td>X.X%</td>
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const row = rowMatch[1];

    const itemMatch = row.match(/href="\/item\/(\d+)"[^>]*>([^<]+)<\/a>/i);
    if (!itemMatch) continue;

    const pctMatch = row.match(/(\d+\.?\d*)\s*%/);
    if (!pctMatch) continue;

    const itemId = parseInt(itemMatch[1], 10);
    if (seen.has(itemId)) continue;
    seen.add(itemId);

    entries.push({
      itemId,
      itemName: itemMatch[2].trim(),
      chance:   parseFloat(pctMatch[1]),
    });
  }

  // Fallback: inline item links near percentages (e.g. markdown-rendered pages)
  if (entries.length === 0) {
    const inlinePattern = /href="\/item\/(\d+)"[^>]*>([^<]+)<\/a>[^%\n]{0,150}?(\d+\.?\d*)\s*%/g;
    let m;
    while ((m = inlinePattern.exec(html)) !== null) {
      const itemId = parseInt(m[1], 10);
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      entries.push({ itemId, itemName: m[2].trim(), chance: parseFloat(m[3]) });
    }
  }

  if (entries.length === 0) return null;
  return entries.sort((a, b) => b.chance - a.chance);
}

// ── Guild Drop History Cache ──────────────────────────────────────────────────
// Scans the last N raids from OpenDKP and counts how many times each item
// (by GameItemId) has appeared in the Items array across all raids.
// Returns Map<gameItemId, count>.
// Cache TTL: 1 hour. Built lazily on first /loot call.

let _dropHistoryCache  = null;  // Map<number, number>
let _dropHistoryFetchedAt = 0;
const DROP_HISTORY_TTL   = 60 * 60 * 1000; // 1 hour
const DROP_HISTORY_RAID_LIMIT = 50;         // most recent raids to scan

// Called from commands/loot.js — passes the opendkp helpers to avoid circular deps.
async function getDropHistory({ getRaids, getRaid } = {}) {
  if (_dropHistoryCache && Date.now() - _dropHistoryFetchedAt < DROP_HISTORY_TTL) {
    return _dropHistoryCache;
  }

  if (!getRaids || !getRaid) {
    console.warn('[loot] Drop history: getRaids/getRaid not supplied, skipping');
    return new Map();
  }

  let raidList;
  try {
    const raw = await getRaids();
    // API may return array directly or { Raids: [...] }
    raidList = Array.isArray(raw) ? raw : (raw?.Raids || raw?.raids || []);
  } catch (err) {
    console.warn('[loot] Drop history: getRaids failed:', err?.message);
    return new Map();
  }

  // Sort by date descending, limit
  const recent = raidList
    .sort((a, b) => (b.RaidDate || b.raidDate || 0) - (a.RaidDate || a.raidDate || 0))
    .slice(0, DROP_HISTORY_RAID_LIMIT);

  const history = new Map();

  // Fetch full raid details in batches of 5 (to extract Items)
  const BATCH = 5;
  for (let i = 0; i < recent.length; i += BATCH) {
    const batch = recent.slice(i, i + BATCH);
    const details = await Promise.all(
      batch.map(r => getRaid(r.RaidId || r.raidId).catch(() => null))
    );
    for (const detail of details) {
      if (!detail) continue;
      // Items may be top-level or inside Ticks
      const topItems  = detail.Items || detail.items || [];
      const tickItems = (detail.Ticks || detail.ticks || []).flatMap(t => t.Items || t.items || []);
      const allItems  = [...topItems, ...tickItems];
      for (const item of allItems) {
        const id = item.GameItemId || item.gameItemId || item.ItemId || item.itemId;
        if (!id) continue;
        history.set(id, (history.get(id) || 0) + 1);
      }
    }
  }

  _dropHistoryCache     = history;
  _dropHistoryFetchedAt = Date.now();
  console.log(`[loot] Drop history cached: ${history.size} unique items across ${recent.length} raids`);
  return history;
}

// Invalidate the drop history cache (call after /loot creates an auction).
function invalidateDropHistory() {
  _dropHistoryCache     = null;
  _dropHistoryFetchedAt = 0;
}

// ── Rarity Calculation ────────────────────────────────────────────────────────
// dropHistory: Map<gameItemId, count> — pass null to skip history check
// dropTable:   [{ itemId, chance }] from fetchPqdiDropTable — pass null to skip PQDI check
// Returns: null | '🆕 NEW' | '💎 ULTRA RARE'
function getItemRarityLabel(gameItemId, dropHistory, dropTable) {
  const count = dropHistory ? (dropHistory.get(gameItemId) || 0) : null;

  // Can't determine rarity without history
  if (count === null) return null;

  if (count === 0) return '🆕 NEW';

  if (count === 1 && dropTable && dropTable.length > 0) {
    const entry = dropTable.find(e => e.itemId === gameItemId);
    if (entry !== undefined) {
      const sorted = [...dropTable].sort((a, b) => a.chance - b.chance);
      const q1     = sorted[Math.floor(sorted.length * 0.25)]?.chance ?? 0;
      if (entry.chance <= q1 || entry.chance <= 5) {
        return '💎 ULTRA RARE';
      }
    }
  }

  return null;
}

// ── Item Enrichment ───────────────────────────────────────────────────────────
// Adds rarityLabel and dropChance fields to each parsed item.
// dropHistory and dropTable may be null (graceful degradation).
function enrichLootItems(items, dropHistory, dropTable) {
  return items.map(item => {
    const rarityLabel = getItemRarityLabel(item.gameItemId, dropHistory, dropTable);
    const dropEntry   = dropTable?.find(e => e.itemId === item.gameItemId);
    const dropChance  = dropEntry?.chance ?? null;
    return { ...item, rarityLabel, dropChance };
  });
}

// ── Loot Announce Embed ───────────────────────────────────────────────────────
// items:       enriched items from enrichLootItems()
// bossName:    string or null (shown in embed title)
// bidMinutes:  number (default 20) — auction duration hint shown in footer
function buildLootAnnounceEmbed(items, bossName, bidMinutes = 20) {
  const opendkpBase = `https://${process.env.OPENDKP_CLIENT_NAME || 'wolfpack'}.opendkp.com`;

  const lines = items.map(item => {
    const pqdiLink = `[${item.name}](<https://www.pqdi.cc/item/${item.gameItemId}>)`;
    const qty      = item.quantity > 1 ? ` ×**${item.quantity}**` : '';
    const rarity   = item.rarityLabel ? ` ${item.rarityLabel}` : '';

    let line = `• ${pqdiLink}${qty}${rarity}`;

    if (item.quantity > 1) {
      line += `\n  ↳ Top **${item.quantity}** bids win`;
    }
    if (item.rarityLabel === '🆕 NEW') {
      line += '\n  ↳ *First drop ever for the guild!*';
    } else if (item.rarityLabel === '💎 ULTRA RARE') {
      const pct = item.dropChance !== null ? ` · ${item.dropChance.toFixed(1)}% drop rate` : '';
      line += `\n  ↳ *Seen once in guild history${pct}*`;
    }

    return line;
  });

  return new EmbedBuilder()
    .setColor(0xf5a623)
    .setTitle(`🎁 Loot Available${bossName ? ` — ${bossName}` : ''}`)
    .setDescription(lines.join('\n\n') || '*No items parsed*')
    .addFields({
      name: '💰 Bidding',
      value: `Bid at **[OpenDKP Bidding Tool](<${opendkpBase}/#/bidding>)**\n` +
             `Tell bids accepted — officers settle before announcing winners.`,
      inline: false,
    })
    .setFooter({ text: `Auction closes in ~${bidMinutes} minutes · Ties go to earlier bid` })
    .setTimestamp();
}

// ── Quarmy Wishlist (future) ──────────────────────────────────────────────────
// Placeholder for parsing quarmy.com BIS wishlist pages.
// Returns [{ itemName: string, source: string|null }] or null if unavailable.
// Will be implemented in a future version to support pre-loaded bid suggestions.
async function parseQuarmyWishlist(quarmyUrl) {
  // TODO: implement when Quarmy wishlist page format is confirmed.
  // Expected URL pattern: https://quarmy.com/b/<id>
  // The page likely contains a list of item names with source/zone info.
  console.warn('[loot] parseQuarmyWishlist not yet implemented:', quarmyUrl);
  return null;
}

// Build the button rows for a /loot announcement:
//   - one Secondary "✖ <Item Name>" button per item (click to remove from batch)
//   - one Success "📣 Post Auctions (N)" button (fires createAuctions)
//   - one Danger "🚫 Cancel" button (abandons the batch)
//
// Discord caps components at 5 rows × 5 buttons = 25 per message. We use up to
// 4 rows (20 buttons) for item-remove buttons, leaving 1 row for the action
// buttons. Items beyond 20 are auto-capped — caller should warn officers if
// they pasted too many.
function buildLootComponents(items) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const MAX_ITEM_BUTTONS = 20;
  const cappedItems = items.slice(0, MAX_ITEM_BUTTONS);
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (const item of cappedItems) {
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    let label = item.name || '?';
    if (item.rarityLabel?.startsWith('🆕')) label = `🆕 ${label}`;
    else if (item.rarityLabel?.startsWith('💎')) label = `💎 ${label}`;
    if (item.quantity > 1) label += ` ×${item.quantity}`;
    // Button label max is 80 chars; cap conservatively and prefix with ✖ remove
    label = `✖ ${label}`;
    if (label.length > 78) label = label.slice(0, 77) + '…';
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`loot_rm:${item.gameItemId}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (currentRow.components.length > 0) rows.push(currentRow);

  // Action row at the bottom (Post + Cancel)
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('loot_post')
      .setLabel(`📣 Post Auctions (${cappedItems.length})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(cappedItems.length === 0),
    new ButtonBuilder()
      .setCustomId('loot_cancel')
      .setLabel('🚫 Cancel')
      .setStyle(ButtonStyle.Danger),
  );
  rows.push(actionRow);

  return rows;
}

module.exports = {
  parseZealLoot,
  fetchPqdiDropTable,
  getDropHistory,
  invalidateDropHistory,
  getItemRarityLabel,
  enrichLootItems,
  buildLootAnnounceEmbed,
  buildLootComponents,
  parseQuarmyWishlist,
};
