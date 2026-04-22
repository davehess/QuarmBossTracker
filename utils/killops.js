// utils/killops.js
// Shared logic executed after any kill or unkill:
//   1. Refresh expansion board in thread (update button states)
//   2. Update/create zone kill card in thread
//   3. Refresh summary card at top of main channel

const {
  getAllState, getExpansionBoard, saveExpansionBoard,
  getZoneCard, setZoneCard, clearZoneCard,
  getSummaryMessageId, setSummaryMessageId,
} = require('./state');
const { buildExpansionPanels } = require('./board');
const { buildZoneKillCard, buildSummaryCard } = require('./embeds');
const { getThreadId, getBossExpansion } = require('./config');

function getBosses() {
  delete require.cache[require.resolve('../data/bosses.json')];
  return require('../data/bosses.json');
}

/**
 * Full post-kill update:
 *  - Refresh expansion board in thread
 *  - Update zone kill card in thread
 *  - Refresh main-channel summary
 *
 * @param {Client} discordClient
 * @param {string} channelId  — #raid-mobs channel
 * @param {string} bossId     — which boss was just killed/unkilled
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
    refreshSummaryCard(discordClient, channelId, bosses),
  ]);
}

/** Refresh the button board for one expansion inside its thread */
async function refreshExpansionBoard(discordClient, expansion, threadId, bosses) {
  if (!threadId) return;
  try {
    const killState = getAllState();
    const panels    = buildExpansionPanels(expansion, bosses, killState);
    const stored    = getExpansionBoard(expansion);

    if (stored && stored.messageIds.length === panels.length) {
      const thread = await discordClient.channels.fetch(threadId);
      for (let i = 0; i < panels.length; i++) {
        try {
          const msg = await thread.messages.fetch(stored.messageIds[i]);
          await msg.edit(panels[i].payload);
        } catch (_) {}
      }
    }
  } catch (err) { console.warn(`refreshExpansionBoard (${expansion}):`, err?.message); }
}

/** Update or create the zone kill card in the expansion thread */
async function refreshZoneCard(discordClient, boss, threadId, bosses) {
  if (!threadId) return;
  try {
    const killState   = getAllState();
    const now         = Date.now();
    const zoneBosses  = bosses.filter((b) => b.zone === boss.zone);
    const killedInZone = zoneBosses
      .filter((b) => killState[b.id] && killState[b.id].nextSpawn > now)
      .map((b) => ({ boss: b, entry: killState[b.id], killedBy: killState[b.id].killedBy }));

    const thread   = await discordClient.channels.fetch(threadId);
    const existing = getZoneCard(boss.zone);

    if (killedInZone.length === 0) {
      // Nothing killed in zone — delete existing card if present
      if (existing) {
        try { const m = await thread.messages.fetch(existing.messageId); await m.delete(); } catch (_) {}
        clearZoneCard(boss.zone);
      }
      return;
    }

    const embed = buildZoneKillCard(boss.zone, killedInZone);

    if (existing) {
      try {
        const m = await thread.messages.fetch(existing.messageId);
        await m.edit({ embeds: [embed] });
        return;
      } catch {
        // message gone — fall through to post new
      }
    }

    const sent = await thread.send({ embeds: [embed] });
    setZoneCard(boss.zone, sent.id, threadId);
  } catch (err) { console.warn(`refreshZoneCard (${boss.zone}):`, err?.message); }
}

/** Refresh (or post) the summary card at the top of #raid-mobs */
async function refreshSummaryCard(discordClient, channelId, bosses) {
  if (!channelId) return;
  try {
    const killState = getAllState();
    const embed     = buildSummaryCard(bosses, killState);
    const channel   = await discordClient.channels.fetch(channelId);
    const summaryId = getSummaryMessageId();

    if (summaryId) {
      try {
        const msg = await channel.messages.fetch(summaryId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {
        // gone — fall through to post new
      }
    }

    // Post new summary and store its ID
    const sent = await channel.send({ embeds: [embed] });
    setSummaryMessageId(sent.id);
  } catch (err) { console.warn('refreshSummaryCard:', err?.message); }
}

/**
 * Post or update the expansion board in a thread.
 * Called by /board and /cleanup.
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

    // Post fresh
    const ids = [];
    for (const panel of panels) { const m = await thread.send(panel.payload); ids.push(m.id); }
    saveExpansionBoard(expansion, ids);
    return { ok: true, action: 'posted' };
  } catch (err) {
    console.error(`postOrUpdateExpansionBoard (${expansion}):`, err?.message);
    return { ok: false, reason: err?.message };
  }
}

module.exports = { postKillUpdate, refreshExpansionBoard, refreshZoneCard, refreshSummaryCard, postOrUpdateExpansionBoard };
