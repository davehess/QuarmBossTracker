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
const { getThreadId, getBossExpansion } = require('./config');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/**
 * Full post-kill update for a single boss kill/unkill:
 *   1. Refresh expansion board buttons in thread
 *   2. Update zone kill card in thread
 *   3. Update thread cooldown card (top of thread)
 *   4. Refresh main channel summary (Active Cooldowns)
 *   5. Refresh main channel Spawning Tomorrow card
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

// ── Zone kill card (in expansion thread) ──────────────────────────────────────
async function refreshZoneCard(discordClient, boss, threadId, bosses) {
  if (!threadId) return;
  try {
    const killState    = getAllState();
    const now          = Date.now();
    const zoneBosses   = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses
      .filter((b) => killState[b.id] && killState[b.id].nextSpawn > now)
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
      try { const m = await thread.messages.fetch(existing.messageId); await m.edit({ embeds: [embed] }); return; }
      catch { /* fall through to post new */ }
    }
    const sent = await thread.send({ embeds: [embed] });
    setZoneCard(boss.zone, sent.id, threadId);
  } catch (err) { console.warn(`refreshZoneCard (${boss.zone}):`, err?.message); }
}

// ── Thread cooldown card (top of expansion thread) ────────────────────────────
async function refreshThreadCooldownCard(discordClient, expansion, threadId, bosses) {
  if (!threadId) return;
  try {
    const killState = getAllState();
    const embed     = buildExpansionCooldownCard(expansion, bosses, killState);
    const thread    = await discordClient.channels.fetch(threadId);
    const storedId  = getThreadCooldownId(expansion);

    if (storedId) {
      try { const m = await thread.messages.fetch(storedId); await m.edit({ embeds: [embed] }); return; }
      catch { /* gone — post new */ }
    }
    const sent = await thread.send({ embeds: [embed] });
    setThreadCooldownId(expansion, sent.id);
  } catch (err) { console.warn(`refreshThreadCooldownCard (${expansion}):`, err?.message); }
}

// ── Main channel summary (all expansions) ─────────────────────────────────────
async function refreshSummaryCard(discordClient, channelId, bosses) {
  if (!channelId) return;
  try {
    const killState = getAllState();
    const embed     = buildSummaryCard(bosses, killState);
    const channel   = await discordClient.channels.fetch(channelId);
    const id        = getSummaryMessageId();
    if (id) {
      try { const m = await channel.messages.fetch(id); await m.edit({ embeds: [embed] }); return; } catch {}
    }
    const sent = await channel.send({ embeds: [embed] });
    setSummaryMessageId(sent.id);
  } catch (err) { console.warn('refreshSummaryCard:', err?.message); }
}

// ── Main channel: Spawning Tomorrow ──────────────────────────────────────────
async function refreshSpawningTomorrowCard(discordClient, channelId, bosses) {
  if (!channelId) return;
  try {
    const killState = getAllState();
    const embed     = buildSpawningTomorrowCard(bosses, killState);
    const channel   = await discordClient.channels.fetch(channelId);
    const id        = getSpawningTomorrowId();
    if (id) {
      try { const m = await channel.messages.fetch(id); await m.edit({ embeds: [embed] }); return; } catch {}
    }
    const sent = await channel.send({ embeds: [embed] });
    setSpawningTomorrowId(sent.id);
  } catch (err) { console.warn('refreshSpawningTomorrowCard:', err?.message); }
}

/**
 * Post or update expansion board in thread (used by /board and /cleanup).
 */
async function postOrUpdateExpansionBoard(discordClient, expansion, threadId, bosses) {
  if (!threadId) return { ok: false, reason: 'no thread configured' };
  try {
    const killState = getAllState();
    const panels    = buildExpansionPanels(expansion, bosses, killState);
    const stored    = getExpansionBoard(expansion);
    const thread    = await discordClient.channels.fetch(threadId);

    if (stored && stored.messageIds.length === panels.length) {
      let allOk = true;
      for (let i = 0; i < panels.length; i++) {
        try { const m = await thread.messages.fetch(stored.messageIds[i]); await m.edit(panels[i].payload); }
        catch { allOk = false; break; }
      }
      if (allOk) return { ok: true, action: 'edited' };
    }

    const ids = [];
    for (const panel of panels) { const m = await thread.send(panel.payload); ids.push(m.id); }
    saveExpansionBoard(expansion, ids);
    return { ok: true, action: 'posted' };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}

module.exports = {
  postKillUpdate,
  refreshExpansionBoard, refreshZoneCard, refreshThreadCooldownCard,
  refreshSummaryCard, refreshSpawningTomorrowCard,
  postOrUpdateExpansionBoard,
};
