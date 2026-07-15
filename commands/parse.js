// commands/parse.js — Submit an EQLogParser DPS parse for a boss fight.
const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { parseEQLog, findBossFromName, kmToInt } = require('../utils/parseEqLog');

const PARSES_FILE = path.join(__dirname, '../data/parses.json');

// In-memory dedup map for no-session parse posts: bossId → { messageId, channelId, ts }
// Allows subsequent /parse submissions for the same boss within 10 minutes to edit the
// existing card in the interaction channel instead of flooding with new posts.
const recentParseCards = new Map();

function loadParses() {
  if (!fs.existsSync(PARSES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PARSES_FILE, 'utf8')); }
  catch { return {}; }
}

function saveParses(data) {
  const tmp = PARSES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, PARSES_FILE);
}

// Returns { exact: boss } | { partial: boss } | { candidates: [boss,...] } | { none: true }
function findBossWithQuality(parsedName, bosses) {
  const nl = parsedName.toLowerCase().trim();
  const exact = bosses.find(b => b.name.toLowerCase() === nl);
  if (exact) return { exact };
  const nick = bosses.find(b => (b.nicknames || []).some(n => n.toLowerCase() === nl));
  if (nick) return { exact: nick };

  // Build all partials with score
  const partials = bosses
    .filter(b => { const bn = b.name.toLowerCase(); return bn.includes(nl) || nl.includes(bn); })
    .map(b => ({ boss: b, diff: Math.abs(b.name.length - nl.length) }))
    .sort((a, b) => a.diff !== b.diff ? a.diff - b.diff : b.boss.name.length - a.boss.name.length);

  if (partials.length === 0) return { none: true };
  if (partials.length === 1) return { partial: partials[0].boss };

  // If the best score is significantly better than second, treat as single partial
  const best = partials[0].diff;
  const similar = partials.filter(p => p.diff <= best + 3); // within 3 chars of best
  if (similar.length === 1) return { partial: similar[0].boss };

  // Multiple similar candidates — return top 5 for select menu
  return { candidates: similar.slice(0, 5).map(p => p.boss) };
}

function fmt(n) { return n.toLocaleString('en-US'); }

// ── Session grouping (shared with parsestats) ────────────────────────────────

// Group kill submissions by session: any submission within windowMs of the
// first entry in an open group belongs to that group.
function groupKillsBySession(sortedKills, windowMs) {
  const groups = [];
  for (const kill of sortedKills) {
    const last = groups[groups.length - 1];
    if (last && kill.timestamp - last[0].timestamp <= windowMs) {
      last.push(kill);
    } else {
      groups.push([kill]);
    }
  }
  return groups;
}

// Merge a session group into one canonical kill.
// For each player, keep the submission with the highest damage.
// Returns { timestamp, duration, totalDamage, totalDps, players }
// Players are re-ranked by damage descending.
function mergeKillGroup(group) {
  const canonical = group.reduce((best, k) => k.totalDamage > best.totalDamage ? k : best, group[0]);
  const playerMap = new Map();
  for (const kill of group) {
    for (const p of kill.players) {
      const key = p.name.toLowerCase();
      const existing = playerMap.get(key);
      if (!existing || p.damage > existing.damage) playerMap.set(key, { ...p });
    }
  }
  const players = [...playerMap.values()]
    .map(p => ({ ...p, dps: p.duration > 0 ? Math.round(p.damage / p.duration) : p.dps }))
    .sort((a, b) => b.damage - a.damage)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  const totalDamage = players.reduce((s, p) => s + p.damage, 0);
  const totalDps    = canonical.duration > 0 ? Math.round(totalDamage / canonical.duration) : canonical.totalDps;
  return { timestamp: canonical.timestamp, duration: canonical.duration, totalDamage, totalDps, players };
}

// Find the session group (array of entries) that a given timestamp belongs to.
function findSessionForTimestamp(allEntries, ts, windowMs) {
  const sorted = [...allEntries].sort((a, b) => a.timestamp - b.timestamp);
  const groups = groupKillsBySession(sorted, windowMs);
  return groups.find(g => g.some(e => e.timestamp === ts)) || null;
}
const CLASS_EMOJI = {
  'Warrior':       '⚔️',
  'Cleric':        '💊',
  'Paladin':       '🛡️',
  'Ranger':        '🏹',
  'Shadow Knight': '🖤',
  'Druid':         '🌿',
  'Monk':          '👊',
  'Bard':          '🎵',
  'Rogue':         '🗡️',
  'Shaman':        '🔮',
  'Necromancer':   '💀',
  'Wizard':        '⚡',
  'Magician':      '🔥',
  'Enchanter':     '🌀',
  'Beastlord':     '🐾',
  'Berserker':     '🪓',
};

function aggregateByClass(players) {
  const { getCharacter } = require('../utils/roster');
  const { getWhoEntry }  = require('../utils/state');
  const classMap = new Map();
  for (const p of players) {
    const char = getCharacter(p.name);
    const who  = getWhoEntry(p.name);
    // Roster is curated (OpenDKP), so we trust it first. Fall back to /who
    // observations from the wolfpack-logsync agent for non-guildies / Zek.
    const cls  = char?.class || who?.class || 'Unknown';
    if (!classMap.has(cls)) {
      classMap.set(cls, { class: cls, emoji: CLASS_EMOJI[cls] || '❓', totalDamage: 0, totalDps: 0, count: 0, totalDuration: 0 });
    }
    const agg = classMap.get(cls);
    agg.totalDamage   += p.damage;
    agg.totalDps      += p.dps;
    agg.count++;
    agg.totalDuration += p.duration;
  }
  return [...classMap.values()]
    .map(c => ({ ...c, avgDps: Math.round(c.totalDps / c.count), avgDuration: Math.round(c.totalDuration / c.count) }))
    .sort((a, b) => b.totalDamage - a.totalDamage);
}

// ── Breakdown button store ────────────────────────────────────────────────────
// Key format: "<bossId>|<timestamp>" — decodable from parses.json on cache miss.
const pendingBreakdowns = new Map(); // key → { bossName, parsed, bossEmoji }

function storeBreakdown(bossName, parsed, bossEmoji, bossId, timestamp) {
  const key = `${bossId || '_'}|${timestamp || Date.now()}`;
  pendingBreakdowns.set(key, { bossName, parsed, bossEmoji });
  return key;
}

function buildParseComponents(key) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`parse_breakdown:${key}`)
        .setLabel('📊 Full Breakdown')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function handleParseBreakdown(interaction) {
  const key  = interaction.customId.split(':')[1];
  let data   = pendingBreakdowns.get(key);

  // Cache miss — reconstruct from parses.json using bossId|timestamp key
  if (!data) {
    const [bossId, tsStr] = key.split('|');
    const ts = parseInt(tsStr, 10);
    if (bossId && !isNaN(ts)) {
      const allParses = loadParses();
      const allForBoss = allParses[bossId] || [];
      delete require.cache[require.resolve('../data/bosses.json')];
      const bosses  = require('../data/bosses.json');
      const boss    = bosses.find(b => b.id === bossId);
      const windowMs = (boss?.timerHours || 24) * 3600 * 1000;
      const group   = findSessionForTimestamp(allForBoss, ts, windowMs);
      if (group) {
        const merged = mergeKillGroup(group);
        const parsed = {
          bossName:    boss?.name || bossId,
          duration:    merged.duration,
          totalDamage: merged.totalDamage,
          totalDps:    merged.totalDps,
          players:     merged.players,
        };
        data = { bossName: parsed.bossName, parsed, bossEmoji: boss?.emoji };
      }
    }
  }

  if (!data) {
    return interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: '❌ Parse not found. If this is a very old parse, run `/parseboss` to look it up directly.',
    });
  }

  const { bossName, parsed, bossEmoji } = data;
  const classes = aggregateByClass(parsed.players);

  // All-classes field (inline markdown, no code block — emojis break monospace alignment)
  const classLines = classes.map((c, i) =>
    `**${i + 1}.** ${c.emoji} **${c.class}** — ${fmt(c.totalDamage)} dmg · ${fmt(c.avgDps)}/s avg · ${c.count} player${c.count !== 1 ? 's' : ''} · ${c.avgDuration}s combat`
  );
  let classValue = '';
  for (const line of classLines) {
    if ((classValue + line + '\n').length > 1020) { classValue += '*…more classes not shown*'; break; }
    classValue += line + '\n';
  }
  classValue = classValue.trimEnd() || '*No roster data — run `/rosterimport` to enable class tracking*';

  // All-players table (code block, dynamic trimming)
  const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Damage'.padStart(7)}  ${'DPS'.padStart(7)}  Time`;
  const divider = '─'.repeat(hdr.length);
  let rows = parsed.players.map(p => {
    const rank = String(p.rank).padStart(2);
    const name = (p.name + (p.hasPets ? ' +P' : '')).slice(0, 20).padEnd(20);
    const dmg  = fmt(p.damage).padStart(7);
    const dps  = (p.dps + '/s').padStart(7);
    const dur  = (p.duration + 's').padStart(4);
    return `${rank}. ${name} ${dmg}  ${dps}  ${dur}`;
  });
  const wrap = r => '```\n' + [hdr, divider, ...r].join('\n') + '\n```';
  while (rows.length > 0 && wrap(rows).length > 1024) rows.pop();

  const title = ['📊', bossEmoji, bossName].filter(Boolean).join(' ');
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`${title} — Full Breakdown`)
    .setDescription(`Fight: **${parsed.duration}s** · ${fmt(parsed.totalDamage)} dmg · ${fmt(parsed.totalDps)}/s raid DPS`)
    .addFields(
      { name: `📊 All Classes (${classes.length})`, value: classValue, inline: false },
      { name: `👥 All Players (${parsed.players.length})`, value: wrap(rows), inline: false },
    )
    .setTimestamp();

  // Pet Attribution — only shown when at least one player has attributed pet damage.
  // Helps distinguish "Bstie's own DPS" from "Bstie's charmed-mob DPS".
  const petPlayers = parsed.players.filter(p => p.petDamage > 0);
  if (petPlayers.length > 0) {
    const petLines = petPlayers.map(p => {
      const direct = p.directDamage ?? (p.damage - p.petDamage);
      const pct    = p.damage > 0 ? Math.round((p.petDamage / p.damage) * 100) : 0;
      return `**${p.name}** — ${fmt(direct)} direct + ${fmt(p.petDamage)} pet *(${pct}% from pet)*`;
    });
    let petValue = petLines.join('\n');
    if (petValue.length > 1020) petValue = petValue.slice(0, 1017) + '…';
    embed.addFields({ name: '🐾 Pet Attribution', value: petValue, inline: false });
  }

  return interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
}

/**
 * Build the parse embed.
 *
 * @param {string}   bossName
 * @param {object}   parsed        { duration, totalDamage, totalDps, players }
 * @param {string}   [bossEmoji]
 * @param {object}   [extras]      { healers?, defenders?, isRaidWindow? }
 *   healers:   [{ name, healed, ticks, targets }]  — from encounter.healers aggregate
 *   defenders: [{ name, hits, damageTaken, misses, dodges, parries, ripostes,
 *                 blocks, invulns, ripostedFor }]   — from encounter.defenders aggregate
 *   isRaidWindow: bool — tag the footer with a 🎯 badge when this is an official night
 */
function buildParseEmbed(bossName, parsed, bossEmoji, extras = {}) {
  const { healers, defenders, isRaidWindow, deaths, healGaps, healUnattributed } = extras;

  const hdr     = `${'#'.padStart(2)}  ${'Player'.padEnd(20)} ${'Damage'.padStart(7)}  ${'DPS'.padStart(7)}  Time`;
  const divider = '─'.repeat(hdr.length);

  // Build rows (up to 20), truncating names to 20 chars so padEnd doesn't overflow
  let rows = parsed.players.slice(0, 20).map((p) => {
    const rank = String(p.rank).padStart(2);
    const name = (p.name + (p.hasPets ? ' +P' : '')).slice(0, 20).padEnd(20);
    const dmg  = fmt(p.damage).padStart(7);
    const dps  = (p.dps + '/s').padStart(7);
    const dur  = (p.duration + 's').padStart(4);
    return `${rank}. ${name} ${dmg}  ${dps}  ${dur}`;
  });

  // Trim rows until the wrapped code block fits Discord's 1024-char field limit
  const wrap = (r) => '```\n' + [hdr, divider, ...r].join('\n') + '\n```';
  while (rows.length > 0 && wrap(rows).length > 1024) rows.pop();

  // Top-5 class breakdown (inline markdown — cleaner than a code block for 5 lines)
  const classes = aggregateByClass(parsed.players);
  const classLines = classes.slice(0, 5).map((c, i) =>
    `**${i + 1}.** ${c.emoji} **${c.class}** — ${fmt(c.totalDamage)} dmg · ${fmt(c.avgDps)}/s avg · ${c.avgDuration}s combat`
  );
  const classValue = classLines.join('\n') || '*No roster data — run `/rosterimport` to enable*';

  const title = ['📊', bossEmoji, bossName].filter(Boolean).join(' ');
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setDescription(`Fight: **${parsed.duration}s** · ${fmt(parsed.totalDamage)} dmg · ${fmt(parsed.totalDps)}/s raid DPS${isRaidWindow ? '  🎯 *raid night*' : ''}`)
    .addFields(
      { name: '🏆 Top Classes', value: classValue, inline: false },
      { name: 'DPS Rankings',   value: wrap(rows),  inline: false },
    )
    .setTimestamp();

  // ── 🩺 Healers section ────────────────────────────────────────────────────
  // Amounts come from the bot's cast×landing join: each healer's Mimic reports
  // WHAT they cast on WHOM, each recipient's Mimic reports the landed amount,
  // and the bot marries the two (Quarm never logs another player's heal
  // amount). Healers whose recipients don't run Mimic still show with a casts
  // count and "—" healed. Recipient-only rows ("→ You" self heals) are gone —
  // those now pool into the unattributed footnote (Uilnayar 2026-07-14).
  // Heal chain gap warning is appended when gaps >8s were detected on the
  // primary tank (8s = ~2 missed CH ticks in Luclin-era chain healing).
  if (Array.isArray(healers) && healers.length > 0) {
    const sorted = [...healers]
      .sort((a, b) => (b.healed - a.healed) || ((b.casts || 0) - (a.casts || 0)))
      .slice(0, 10);
    const healHdr  = `${'#'.padStart(2)}  ${'Healer'.padEnd(14)} ${'Healed'.padStart(8)} ${'Casts'.padStart(5)}`;
    const healDiv  = '─'.repeat(healHdr.length);
    const healRows = sorted.map((h, i) => {
      const name   = (h.name || '?').slice(0, 14).padEnd(14);
      // ~ = includes catalog-estimated amounts (public CH landings joined to
      // casts when the recipient runs no Mimic — exact only from their client).
      const total  = (h.healed > 0 ? (h.estimated ? '~' : '') + fmt(h.healed) : '—').padStart(8);
      const casts  = String(h.casts ?? h.ticks ?? 0).padStart(5);
      // Top recipients by amount when we have them; name list otherwise.
      // 'You' is a legacy self-received artifact — never a real recipient.
      const tgts   = h.byTarget && Object.keys(h.byTarget).length > 0
        ? Object.entries(h.byTarget).filter(([t]) => t !== 'You')
            .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t, amt]) => `${t} ${fmt(amt)}`)
        : (h.targets || []).filter(t => t !== 'You').slice(0, 2);
      const extra  = tgts.length > 0 ? `  → ${tgts.join(', ')}` : '';
      return `${String(i + 1).padStart(2)}. ${name} ${total} ${casts}${extra}`;
    });
    const wrapH = (r) => '```\n' + [healHdr, healDiv, ...r].join('\n') + '\n```';
    const gapNote = healGaps?.count > 0
      ? `\n> ⚠️ **${healGaps.count}** heal gap${healGaps.count !== 1 ? 's' : ''} on **${healGaps.tank}** (longest: **${Math.round(healGaps.maxGapMs / 1000)}s**)`
      : '';
    const unattribNote = healUnattributed?.total > 0
      ? `\n*+${fmt(healUnattributed.total)} received by ${healUnattributed.recipients} raider${healUnattributed.recipients !== 1 ? 's' : ''} couldn't be attributed — the healer isn't running Mimic*`
      : '';
    const reserved = gapNote.length + unattribNote.length;
    while (healRows.length > 0 && (wrapH(healRows).length + reserved) > 1024) healRows.pop();
    embed.addFields({ name: '🩺 Healers', value: wrapH(healRows) + gapNote + unattribNote, inline: false });
  } else if (healUnattributed?.total > 0) {
    // No attributable healer rows at all — still show the raid what landed.
    embed.addFields({
      name: '🩺 Healers',
      value: `*${fmt(healUnattributed.total)} healing received by ${healUnattributed.recipients} raider${healUnattributed.recipients !== 1 ? 's' : ''} — no Mimic-running healer to attribute it to yet*`,
      inline: false,
    });
  }

  // ── 💀 Deaths section ─────────────────────────────────────────────────────
  // Shows each player who died during the fight. Knights (Paladin/SK) who died
  // from a confirmed boss riposte get ⚔️ — ripostes proc from the attacker's
  // melee swings and a Knight avoids them entirely (Riposte avoidance AA).
  // Counts >1 shown when the same player died multiple times (rare but happens
  // on charm-break wipes or multi-pull trash).
  const KNIGHT_CLASSES = new Set(['Paladin', 'Shadow Knight']);
  if (Array.isArray(deaths) && deaths.length > 0) {
    const deathLines = deaths.map(d => {
      const count       = (d.count || 1) > 1 ? ` ×${d.count}` : '';
      const cls         = d.class ? ` *(${d.class})*` : '';
      const riposteFlag = d.riposteDeath
        ? (KNIGHT_CLASSES.has(d.class) ? ' ⚔️ *riposte — Knight avoids*' : ' ⚔️ *riposte*')
        : '';
      return `**${d.name}**${count}${cls}${riposteFlag}`;
    });
    let deathValue = deathLines.join('\n');
    if (deathValue.length > 1020) deathValue = deathValue.slice(0, 1017) + '…';
    embed.addFields({ name: '💀 Deaths', value: deathValue, inline: false });
  }

  return embed;
}

/**
 * Post a compact JSON embed to PARSES_LOG_THREAD_ID so parse data survives volume wipes.
 * Returns the sent message object (or null).
 */
async function logParseToDiscord(client, bossId, parseEntry) {
  const threadId = process.env.PARSES_LOG_THREAD_ID;
  if (!threadId) return null;
  const thread = await client.channels.fetch(threadId);
  const data = {
    bossId,
    ts:  parseEntry.timestamp,
    dur: parseEntry.duration,
    dmg: parseEntry.totalDamage,
    dps: parseEntry.totalDps,
    by:  parseEntry.submittedByName,
    p:   parseEntry.players.map(({ name, hasPets, damage, dps, duration, petDamage }) => ({
      n: name, ...(hasPets ? { hp: 1 } : {}), d: damage, dps, dur: duration,
      ...(petDamage > 0 ? { pd: petDamage } : {}),
    })),
  };
  const msg = await thread.send({
    embeds: [new EmbedBuilder()
      .setTitle('📊 Parse Log')
      .setColor(0x2f3136)
      .setDescription(JSON.stringify(data))
    ]
  });
  return msg;
}

/**
 * Rebuild parses.json by fetching all '📊 Parse Log' embeds from PARSES_LOG_THREAD_ID.
 * Merges with whatever is already on the volume (union, dedup by timestamp).
 * Called on startup so Discord is the authoritative source of truth.
 */
async function loadParsesFromDiscord(client) {
  const threadId = process.env.PARSES_LOG_THREAD_ID;
  if (!threadId) { console.log('[parses] PARSES_LOG_THREAD_ID not set — skipping Discord recovery'); return; }

  try {
    const thread = await client.channels.fetch(threadId);

    // Fetch up to 2000 messages (20 pages × 100)
    const allMsgs = [];
    let lastId = null;
    for (let i = 0; i < 20; i++) {
      const opts = { limit: 100 };
      if (lastId) opts.before = lastId;
      const batch = await thread.messages.fetch(opts);
      if (batch.size === 0) break;
      allMsgs.push(...batch.values());
      lastId = batch.last().id;
    }

    // Parse log embeds → { bossId → [entry, ...] }
    const fromDiscord = {};
    for (const msg of allMsgs) {
      const embed = msg.embeds[0];
      if (!embed || embed.title !== '📊 Parse Log') continue;
      try {
        const data = JSON.parse(embed.description);
        if (!data.bossId || !data.ts) continue;
        if (!fromDiscord[data.bossId]) fromDiscord[data.bossId] = [];
        fromDiscord[data.bossId].push({
          timestamp:       data.ts,
          submittedByName: data.by || 'unknown',
          duration:        data.dur,
          totalDamage:     data.dmg,
          totalDps:        data.dps,
          discordMsgId:    msg.id,
          players: (data.p || []).map(p => ({
            name: p.n, hasPets: !!(p.hp), damage: p.d, dps: p.dps, duration: p.dur,
            petDamage:    p.pd || 0,
            directDamage: p.pd ? (p.d - p.pd) : p.d,
          })),
        });
      } catch {}
    }

    // Merge with existing volume data, dedup by (bossId, timestamp)
    const existing = loadParses();
    const merged   = { ...existing };
    for (const [bossId, kills] of Object.entries(fromDiscord)) {
      const knownTs = new Set((merged[bossId] || []).map(k => k.timestamp));
      if (!merged[bossId]) merged[bossId] = [];
      for (const k of kills) {
        if (!knownTs.has(k.timestamp)) { merged[bossId].push(k); knownTs.add(k.timestamp); }
      }
    }

    saveParses(merged);
    const total = Object.values(merged).reduce((s, v) => s + v.length, 0);
    console.log(`[parses] Loaded ${total} parses from Discord + volume`);
  } catch (err) {
    console.error('[parses] Failed to load from Discord:', err?.message);
  }
}

// ── Post parse embed to all active announce threads ──────────────────────────
async function postParseToAnnounceThreads(client, embed, components) {
  const { getAllAnnounces } = require('../utils/state');
  const announces = Object.values(getAllAnnounces());
  const payload = { embeds: [embed], ...(components ? { components } : {}) };
  for (const ann of announces) {
    if (!ann.threadId) continue;
    try {
      const thread = await client.channels.fetch(ann.threadId).catch(() => null);
      if (thread) await thread.send(payload);
    } catch (err) {
      console.warn('[parse] Could not post to announce thread:', err?.message);
    }
  }
}

// ── Pending parses (for select-menu confirm flow) ──────────────────────────────
const pendingParses = new Map(); // userId → { parsed, rawData, ts }

// Expire entries after 2 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [userId, entry] of pendingParses.entries()) {
    if (entry.ts < cutoff) pendingParses.delete(userId);
  }
}, 30_000);

// ── Shared finish-parse logic ─────────────────────────────────────────────────
// parseType: 'instance' | 'open_world' | 'pvp'
//   instance   — guild instanced raid kill. Triggers respawn timer. DEFAULT.
//   open_world — open-world kill (no lockout). Parse stored for stats only.
//   pvp        — PvP kill. Parse stored for stats only.
// Only 'instance' triggers recordKill() — the others record the DPS data
// without starting a timer, since open-world/PvP spawns aren't on our timers.
async function finishParse(interaction, bossId, boss, parsed, parseType = 'instance') {
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');

  const parseEntry = {
    timestamp:        Date.now(),
    submittedBy:      interaction.user.id,
    submittedByName:  interaction.member?.displayName || interaction.user.username,
    duration:         parsed.duration,
    totalDamage:      parsed.totalDamage,
    totalDps:         parsed.totalDps,
    players:          parsed.players,
    parseType,        // stored so stats commands can filter by type
    discordMsgId:     null, // filled after logging
  };

  const parses = loadParses();
  if (!parses[bossId]) parses[bossId] = [];
  parses[bossId].push(parseEntry);
  saveParses(parses);

  // Best-effort Supabase write — now awaited so we can surface completeness info
  // in the ephemeral reply. Still gracefully no-ops if Supabase is unconfigured
  // or the boss isn't mapped in bosses_local yet.
  let supabaseResult = null;
  try {
    const supabase = require('../utils/supabase');
    if (supabase.isEnabled()) {
      supabaseResult = await supabase.recordParse({
        bossInternalId:       bossId,
        parsed,
        timestampMs:          parseEntry.timestamp,
        contributorDiscordId: interaction.user.id,
        contributorCharacter: parseEntry.submittedByName,
        source:               'eqlogparser_send_to_eq',
      }).catch(err => { console.warn('[parse] supabase write failed:', err?.message); return null; });
    }
  } catch (err) {
    console.warn('[parse] supabase module load failed:', err?.message);
  }

  const bossName  = boss?.name || parsed.bossName;
  const windowMs  = (boss?.timerHours || 24) * 3600 * 1000;
  const allForBoss = parses[bossId];
  const group      = findSessionForTimestamp(allForBoss, parseEntry.timestamp, windowMs) || [parseEntry];
  const merged     = mergeKillGroup(group);
  const mergedParsed = {
    bossName,
    duration:    merged.duration,
    totalDamage: merged.totalDamage,
    totalDps:    merged.totalDps,
    players:     merged.players,
  };
  // Use the earliest timestamp in the session as the stable key so all
  // submitters for the same kill share one breakdown entry.
  const sessionTs = group[0].timestamp;
  const bdKey     = storeBreakdown(bossName, mergedParsed, boss?.emoji, bossId, sessionTs);
  const embed     = buildParseEmbed(bossName, mergedParsed, boss?.emoji);
  const components = buildParseComponents(bdKey);
  const submitterCount = new Set(group.map(e => e.submittedBy)).size;
  const mergeNote = group.length > 1
    ? `\n*(${group.length} parse submissions merged — ${mergedParsed.players.length} unique players)*`
    : '';

  // Log to Discord thread for persistence (fire-and-forget, but capture msg id)
  logParseToDiscord(interaction.client, bossId, parseEntry).then(msg => {
    if (msg?.id) {
      // Update the stored entry with the discord message id
      const p2 = loadParses();
      if (p2[bossId]) {
        const idx = p2[bossId].findIndex(e => e.timestamp === parseEntry.timestamp && e.submittedBy === parseEntry.submittedBy);
        if (idx !== -1) { p2[bossId][idx].discordMsgId = msg.id; saveParses(p2); }
      }
    }
  }).catch(err => console.warn('[parse] Discord log failed:', err?.message));

  // Auto-kill boss — ONLY for guild instance kills.
  // open_world and pvp parses record stats but must NOT start a respawn timer,
  // since we don't track open-world or PvP spawns on these boards.
  const { getBossState, recordKill } = require('../utils/state');
  const { postKillUpdate } = require('../utils/killops');
  const bossState = getBossState(bossId);
  const now = Date.now();
  if (parseType !== 'instance') {
    // Non-instance parse: stats recorded, no timer change
    // (fall through to reply building below)
  } else if (!bossState || !bossState.killedAt || bossState.nextSpawn <= now) {
    const freshBoss = bosses.find(b => b.id === bossId);
    if (freshBoss) {
      recordKill(bossId, freshBoss.timerHours, interaction.user.id);
      postKillUpdate(interaction.client, process.env.TIMER_CHANNEL_ID, bossId).catch(console.warn);
    }
  } else {
    try {
      await interaction.followUp({
        flags: MessageFlags.Ephemeral,
        content: `ℹ️ **${bossName}** is already marked as killed — timer running.`,
      });
    } catch {}
  }

  // Auto-append to active raid night thread (fire-and-forget)
  const { appendParseToSession } = require('./raidnight');
  appendParseToSession(interaction.client, bossId, mergedParsed, bossName, boss?.emoji).catch(() => {});

  // Post to any active announce/event threads (fire-and-forget)
  postParseToAnnounceThreads(interaction.client, embed, components).catch(() => {});

  // Post publicly in the channel where the command was run — but only when
  // there is no active raid session. When a session is open, appendParseToSession
  // already posts the card to the raid thread; posting here too would duplicate
  // it in the parent channel (e.g. Raid Chat).
  // Edit-in-place dedup: if a card for the same boss was posted within the last
  // 10 minutes in the same channel, edit it instead of posting a new one.
  const { getRaidSession } = require('../utils/state');
  if (!getRaidSession()) {
    const content = mergeNote || undefined;
    const now = Date.now();
    const recent = recentParseCards.get(bossId);
    const canEdit = recent
      && (now - recent.ts) < 10 * 60 * 1000
      && recent.channelId === interaction.channelId;
    if (canEdit) {
      try {
        const existingMsg = await interaction.channel.messages.fetch(recent.messageId);
        await existingMsg.edit({ content: content || null, embeds: [embed], components });
        recentParseCards.set(bossId, { ...recent, ts: now });
      } catch {
        const sent = await interaction.channel.send({ content, embeds: [embed], components }).catch(err => {
          console.warn('[parse] public channel send failed:', err?.message);
          return null;
        });
        if (sent) recentParseCards.set(bossId, { messageId: sent.id, channelId: interaction.channelId, ts: now });
      }
    } else {
      const sent = await interaction.channel.send({ content, embeds: [embed], components }).catch(err => {
        console.warn('[parse] public channel send failed:', err?.message);
        return null;
      });
      if (sent) recentParseCards.set(bossId, { messageId: sent.id, channelId: interaction.channelId, ts: now });
    }
  }

  // ── Build ephemeral reply content ──────────────────────────────────────────
  const typeLabel = parseType === 'pvp' ? ' · 🗡️ PvP' : parseType === 'open_world' ? ' · 🌍 Open World' : '';
  const timerNote = parseType !== 'instance' ? '\n*Stats recorded — no timer started (not a guild instance kill).*' : '';

  let replyLines = [];
  if (group.length > 1) {
    replyLines.push(`✅ Merged **${group.length}** submissions — **${mergedParsed.players.length}** unique players seen${typeLabel}.${timerNote}`);
  } else {
    replyLines.push(`✅ Parse submitted — **${mergedParsed.players.length}** players, **${fmt(mergedParsed.totalDamage)}** dmg${typeLabel}.${timerNote}`);
  }

  // Completeness score from Supabase (only shows when multiple contributors exist)
  if (supabaseResult?.encounterId) {
    try {
      const supabase = require('../utils/supabase');
      const completeness = await supabase.getEncounterCompleteness(supabaseResult.encounterId).catch(() => null);
      if (completeness && completeness.contributor_count > 1) {
        const score  = Math.round((completeness.completeness_score || 0) * 100);
        const filled = Math.floor(score / 10);
        const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
        replyLines.push(
          `\`${bar}\` **${score}%** raid coverage · ` +
          `${completeness.unique_attackers_seen}/${completeness.raid_size_expected} raiders · ` +
          `${completeness.contributor_count} submitter${completeness.contributor_count === 1 ? '' : 's'}`
        );
      }
    } catch {}
  }

  return replyLines.join('\n');
}

// ── Select-menu confirm handler ────────────────────────────────────────────────
async function handleParseConfirm(interaction) {
  const pending = pendingParses.get(interaction.user.id);
  if (!pending) {
    return interaction.update({ content: '❌ Session expired. Run /parse again.', components: [] });
  }
  pendingParses.delete(interaction.user.id);
  const bossId = interaction.values[0];
  delete require.cache[require.resolve('../data/bosses.json')];
  const bosses = require('../data/bosses.json');
  const boss = bosses.find(b => b.id === bossId);
  await interaction.update({ content: `✅ Using **${boss?.name || bossId}**...`, components: [] });
  const reply = await finishParse(interaction, bossId, boss, pending.parsed, pending.parseType ?? 'instance');
  await interaction.editReply({ content: reply }).catch(() => {});
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parse')
    .setDescription('Submit an EQLogParser DPS parse for a boss fight.')
    .addStringOption(opt =>
      opt.setName('data')
        .setDescription('Paste the EQLogParser "Send to EQ" output')
        .setRequired(true)
        .setMaxLength(6000)
    )
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Kill context — instance starts the respawn timer; others record stats only (default: instance)')
        .setRequired(false)
        .addChoices(
          { name: '🏰 Guild Instance (default) — starts respawn timer', value: 'instance'   },
          { name: '🌍 Open World — stats only, no timer',                value: 'open_world' },
          { name: '🗡️ PvP — stats only, no timer',                      value: 'pvp'        },
        )
    ),

  async execute(interaction) {
    const rawData   = interaction.options.getString('data');
    const parseType = interaction.options.getString('type') ?? 'instance';

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    delete require.cache[require.resolve('../data/bosses.json')];
    const bosses = require('../data/bosses.json');

    const parsed = parseEQLog(rawData);
    if (!parsed) {
      return interaction.editReply('❌ Could not parse that input. Paste the EQLogParser "Send to EQ" output directly (e.g. "Boss Name in 397s, 1.54M Damage @3.87K, 1. Player = 78.22K@216 in 362s | ...")');
    }

    const result = findBossWithQuality(parsed.bossName, bosses);

    if (result.none) {
      return interaction.editReply(`❌ Could not identify boss "**${parsed.bossName}**". Use \`/parseboss\` to specify manually.`);
    }

    if (result.exact) {
      const reply = await finishParse(interaction, result.exact.id, result.exact, parsed, parseType);
      return interaction.editReply({ content: reply });
    }

    if (result.partial) {
      const reply = await finishParse(interaction, result.partial.id, result.partial, parsed, parseType);
      return interaction.editReply({ content: `${reply}\n*(auto-matched to **${result.partial.name}** — use /parseboss to override)*` });
    }

    // Multiple candidates — show select menu
    if (result.candidates) {
      pendingParses.set(interaction.user.id, { parsed, rawData, parseType, ts: Date.now() });

      const select = new StringSelectMenuBuilder()
        .setCustomId('parseConfirm')
        .setPlaceholder('Select the correct boss…')
        .addOptions(result.candidates.map(b =>
          new StringSelectMenuOptionBuilder()
            .setLabel(b.name)
            .setDescription(`${b.zone} — ${b.expansion}`)
            .setValue(b.id)
        ));
      const row = new ActionRowBuilder().addComponents(select);

      return interaction.editReply({
        content: `❓ Multiple bosses could match "**${parsed.bossName}**". Which one?`,
        components: [row],
      });
    }
  },

  parseEQLog,
  findBossFromName,
  loadParses,
  saveParses,
  buildParseEmbed,
  logParseToDiscord,
  loadParsesFromDiscord,
  pendingParses,
  handleParseConfirm,
  finishParse,
  postParseToAnnounceThreads,
  aggregateByClass,
  groupKillsBySession,
  mergeKillGroup,
  findSessionForTimestamp,
  storeBreakdown,
  buildParseComponents,
  handleParseBreakdown,
  CLASS_EMOJI,
};
