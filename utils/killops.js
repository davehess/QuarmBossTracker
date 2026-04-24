// utils/killops.js — Shared post-kill update logic

const {
  getAllState, getExpansionBoard, saveExpansionBoard,
  getZoneCard, setZoneCard, clearZoneCard,
  getSummaryMessageId, setSummaryMessageId,
  getSpawningTomorrowId, setSpawningTomorrowId,
  getThreadCooldownId, setThreadCooldownId,
} = require('./state');
const { buildExpansionPanels } = require('./board');
const { buildZoneKillCard, buildSummaryCard, buildSpawningTomorrowCard, buildExpansionCooldownCard } = require('./embeds');
const { getThreadId, getBossExpansion, EXPANSION_META } = require('./config');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/**
 * Full post-kill update: refresh board, zone card, thread cooldown, summary, spawning tomorrow
 */
async function postKillUpdate(discordClient, channelId, bossId) {
  const bosses    = getBosses();
  const boss      = bosses.find((b) => b.id === bossId);
  if (!boss) return;
  const expansion = getBossExpansion(boss);
  const threadId  = getThreadId(expansion);
  await Promise.allSettled([
    refreshExpansionBoard(discordClient, expansion, threadId, bosses),
    refreshZoneCard(discordClient, boss, threadId, bosses),
    refreshThreadCooldownCard(discordClient, expansion, threadId, bosses),
    refreshSummaryCard(discordClient, channelId, bosses),
    refreshSpawningTomorrowCard(discordClient, channelId, bosses),
  ]);
}

// ── Expansion board (buttons) ─────────────────────────────────────────────────
async function refreshExpansionBoard(discordClient, expansion, threadId, bosses) {
  if (!threadId) return;
  try {
    const killState = getAllState();
    const panels    = buildExpansionPanels(expansion, bosses, killState);
    const stored    = getExpansionBoard(expansion);
    if (!stored || stored.messageIds.length !== panels.length) return;
    const thread = await discordClient.channels.fetch(threadId);
    for (let i = 0; i < panels.length; i++) {
      try { const m = await thread.messages.fetch(stored.messageIds[i]); await m.edit(panels[i].payload); } catch (_) {}
    }
  } catch (err) { console.warn(`refreshExpansionBoard (${expansion}):`, err?.message); }
}

// ── Zone kill card ────────────────────────────────────────────────────────────
async function refreshZoneCard(discordClient, boss, threadId, bosses) {
  if (!threadId) return;
  try {
    const killState    = getAllState();
    const now          = Date.now();
    const killedInZone = bosses.filter((b) => b.zone === boss.zone && killState[b.id] && killState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));
    const thread   = await discordClient.channels.fetch(threadId);
    const existing = getZoneCard(boss.zone);
    if (killedInZone.length === 0) {
      if (existing) {
        try { const m = await thread.messages.fetch(existing.messageId); await m.delete(); } catch (_) {}
        clearZoneCard(boss.zone);
      }
      return;
    }
    const embed = buildZoneKillCard(boss.zone, killedInZone);
    if (existing) {
      try { const m = await thread.messages.fetch(existing.messageId); await m.edit({ embeds: [embed] }); return; } catch { /* fall through */ }
    }
    const sent = await thread.send({ embeds: [embed] });
    setZoneCard(boss.zone, sent.id, threadId);
  } catch (err) { console.warn(`refreshZoneCard (${boss.zone}):`, err?.message); }
}

// ── Thread cooldown card ──────────────────────────────────────────────────────
async function refreshThreadCooldownCard(discordClient, expansion, threadId, bosses) {
  if (!threadId) return;
  try {
    const killState = getAllState();
    const embed     = buildExpansionCooldownCard(expansion, bosses, killState);
    const thread    = await discordClient.channels.fetch(threadId);
    const storedId  = getThreadCooldownId(expansion);
    if (storedId) {
      try { const m = await thread.messages.fetch(storedId); await m.edit({ embeds: [embed] }); return; } catch { /* fall through */ }
    }
    const sent = await thread.send({ embeds: [embed] });
    setThreadCooldownId(expansion, sent.id);
  } catch (err) { console.warn(`refreshThreadCooldownCard (${expansion}):`, err?.message); }
}

// ── Main channel summary — ALWAYS posts to TIMER_CHANNEL_ID only ──────────────
async function refreshSummaryCard(discordClient, channelId, bosses) {
  const targetId = process.env.TIMER_CHANNEL_ID || channelId;
  if (!targetId) return;
  try {
    const killState = getAllState();
    const embed     = buildSummaryCard(bosses, killState);
    const channel   = await discordClient.channels.fetch(targetId);
    const id        = getSummaryMessageId();
    if (id) {
      try { const m = await channel.messages.fetch(id); await m.edit({ embeds: [embed] }); return; } catch {}
    }
    const sent = await channel.send({ embeds: [embed] });
    setSummaryMessageId(sent.id);
  } catch (err) { console.warn('refreshSummaryCard:', err?.message); }
}

// ── Spawning Tomorrow — ALWAYS posts to TIMER_CHANNEL_ID only ────────────────
async function refreshSpawningTomorrowCard(discordClient, channelId, bosses) {
  const targetId = process.env.TIMER_CHANNEL_ID || channelId;
  if (!targetId) return;
  try {
    const killState = getAllState();
    const embed     = buildSpawningTomorrowCard(bosses, killState);
    const channel   = await discordClient.channels.fetch(targetId);
    const id        = getSpawningTomorrowId();
    if (id) {
      try { const m = await channel.messages.fetch(id); await m.edit({ embeds: [embed] }); return; } catch {}
    }
    const sent = await channel.send({ embeds: [embed] });
    setSpawningTomorrowId(sent.id);
  } catch (err) { console.warn('refreshSpawningTomorrowCard:', err?.message); }
}

/**
 * Post or update the expansion board in its thread.
 * Priority order for finding existing board messages:
 *   1. State.json stored IDs (fastest, survives redeploys if volume is mounted)
 *   2. Env var IDs (e.g. CLASSIC_BOARD_IDS=id1,id2 — hardcoded, redeploy-proof)
 *   3. Channel scan — scan thread history for earliest bot messages with this expansion's embed title
 *   4. Post fresh (first time only)
 */
async function postOrUpdateExpansionBoard(discordClient, expansion, threadId, bosses) {
  if (!threadId) return { ok: false, reason: 'no thread configured' };
  try {
    const killState = getAllState();
    const panels    = buildExpansionPanels(expansion, bosses, killState);
    const thread    = await discordClient.channels.fetch(threadId);

    // ── 1. Try stored state IDs ───────────────────────────────────────────
    let stored = getExpansionBoard(expansion);
    if (stored && stored.messageIds.length === panels.length) {
      const allEdited = await tryEditPanels(thread, panels, stored.messageIds);
      if (allEdited) return { ok: true, action: 'edited' };
    }

    // ── 2. Try env var IDs ────────────────────────────────────────────────
    const envKey   = `${expansion.toUpperCase()}_BOARD_IDS`;
    const envVal   = process.env[envKey];
    if (envVal) {
      const envIds = envVal.split(',').map((s) => s.trim()).filter(Boolean);
      if (envIds.length === panels.length) {
        const allEdited = await tryEditPanels(thread, panels, envIds);
        if (allEdited) { saveExpansionBoard(expansion, envIds); return { ok: true, action: 'edited (env)' }; }
      }
    }

    // ── 3. Scan thread history for earliest board ─────────────────────────
    const meta        = EXPANSION_META[expansion];
    const anchorTitle = meta ? meta.label : expansion;
    const scannedIds  = await scanThreadForBoard(thread, discordClient.user.id, anchorTitle, panels.length);
    if (scannedIds && scannedIds.length === panels.length) {
      const allEdited = await tryEditPanels(thread, panels, scannedIds);
      if (allEdited) { saveExpansionBoard(expansion, scannedIds); return { ok: true, action: 'edited (scanned)' }; }
    }

    // ── 4. Post fresh (first time) ────────────────────────────────────────
    const ids = [];
    for (const panel of panels) { const m = await thread.send(panel.payload); ids.push(m.id); }
    saveExpansionBoard(expansion, ids);
    return { ok: true, action: 'posted' };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

/** Try to edit all panels in place. Returns true if ALL edits succeeded. */
async function tryEditPanels(thread, panels, messageIds) {
  if (messageIds.length !== panels.length) return false;
  for (let i = 0; i < panels.length; i++) {
    try { const m = await thread.messages.fetch(messageIds[i]); await m.edit(panels[i].payload); }
    catch { return false; }
  }
  return true;
}

/**
 * Scan a thread for the EARLIEST bot messages that look like a board for this expansion.
 * Identifies them by the embed title starting with the expansion's anchor title.
 * Returns an array of message IDs in order, or null if not found.
 */
async function scanThreadForBoard(thread, botId, anchorTitle, expectedPanelCount) {
  try {
    let allMessages = [], lastId = null;
    for (let i = 0; i < 10; i++) {
      const opts = { limit: 50 };
      if (lastId) opts.before = lastId;
      const batch = await thread.messages.fetch(opts);
      if (batch.size === 0) break;
      allMessages = allMessages.concat([...batch.values()]);
      lastId = batch.last().id;
    }
    const botMsgs = allMessages
      .filter((m) => m.author.id === botId)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const startIdx = botMsgs.findIndex((m) =>
      m.embeds.some((e) => e.title && (e.title === anchorTitle || e.title.startsWith(anchorTitle)))
    );
    if (startIdx === -1) return null;

    const candidateMsgs = botMsgs.slice(startIdx, startIdx + expectedPanelCount);
    if (candidateMsgs.length !== expectedPanelCount) return null;

    // Verify these are all board-like messages (have embeds with buttons)
    const allLookLikeBoard = candidateMsgs.every((m) => m.embeds.length > 0 || m.components.length > 0);
    if (!allLookLikeBoard) return null;

    return candidateMsgs.map((m) => m.id);
  } catch { return null; }
}

module.exports = {
  postKillUpdate,
  refreshExpansionBoard, refreshZoneCard, refreshThreadCooldownCard,
  refreshSummaryCard, refreshSpawningTomorrowCard,
  postOrUpdateExpansionBoard,
};
