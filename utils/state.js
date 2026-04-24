// utils/state.js — Full state persistence
// IMPORTANT: state.json must be stored in a persistent volume, never baked into Docker image.
// See .dockerignore which excludes data/state.json from the image build.

const fs   = require('fs');
const path = require('path');
const STATE_FILE = path.join(__dirname, '../data/state.json');

function _empty() {
  return {
    bosses: {}, expansionBoards: {}, channelSlots: {},
    zoneCards: {}, dailyKills: [], announceMessageIds: [],
  };
}

function loadState() {
  // If file doesn't exist, create it fresh
  if (!fs.existsSync(STATE_FILE)) {
    console.log('[state] state.json not found — creating fresh state');
    const e = _empty();
    fs.writeFileSync(STATE_FILE, JSON.stringify(e, null, 2), 'utf8');
    return e;
  }

  let raw;
  try {
    const text = fs.readFileSync(STATE_FILE, 'utf8');
    raw = JSON.parse(text);
  } catch (err) {
    // Parse error — log it loudly, DO NOT silently wipe state
    console.error('[state] CRITICAL: state.json parse error — keeping current file, returning empty to avoid data loss:', err.message);
    // Return empty in memory but do NOT overwrite the broken file
    return _empty();
  }

  // Validate: if the file is completely empty or just {}
  if (!raw || typeof raw !== 'object') {
    console.warn('[state] state.json is empty or not an object — starting fresh');
    return _empty();
  }

  // Migrate old format: if the file was just a flat { bossId: {...} } map (no top-level keys)
  // Detection: has no known top-level keys at all
  const knownKeys = ['bosses', 'expansionBoards', 'channelSlots', 'zoneCards', 'dailyKills', 'announceMessageIds', 'board'];
  const hasKnownKey = knownKeys.some((k) => k in raw);
  if (!hasKnownKey && Object.keys(raw).length > 0) {
    // Old format: the whole object IS the bosses map
    console.log('[state] Migrating old flat boss state format →', Object.keys(raw).length, 'entries');
    return { ..._empty(), bosses: raw };
  }

  // Normal load — merge with empty defaults so new keys always exist
  const s = _empty();
  if (raw.bosses)             s.bosses             = raw.bosses;
  if (raw.expansionBoards)    s.expansionBoards    = raw.expansionBoards;
  if (raw.channelSlots)       s.channelSlots       = raw.channelSlots;
  if (raw.zoneCards)          s.zoneCards          = raw.zoneCards;
  if (raw.dailyKills)         s.dailyKills         = raw.dailyKills;
  if (raw.announceMessageIds) s.announceMessageIds = raw.announceMessageIds;

  const bossCount = Object.keys(s.bosses).length;
  if (bossCount > 0) {
    console.log(`[state] Loaded state: ${bossCount} active kill(s)`);
  }

  return s;
}

function saveState(state) {
  try {
    // Write to a temp file first, then rename — prevents corruption if process dies mid-write
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('[state] CRITICAL: could not save state.json:', err.message);
  }
}

// ── Boss kills ────────────────────────────────────────────────────────────────
function recordKill(bossId, timerHours, killedBy) {
  const state     = loadState();
  const killedAt  = Date.now();
  const nextSpawn = killedAt + timerHours * 3600000;
  state.bosses[bossId] = { killedAt, nextSpawn, killedBy };
  state.dailyKills.push({ bossId, killedAt, killedBy });
  saveState(state);
  return state.bosses[bossId];
}

function overrideTimer(bossId, nextSpawn) {
  const state = loadState();
  if (!state.bosses[bossId]) return false;
  state.bosses[bossId].nextSpawn = nextSpawn;
  saveState(state);
  return true;
}

function clearKill(bossId) {
  const s = loadState();
  delete s.bosses[bossId];
  saveState(s);
}

function getBossState(bossId) { return loadState().bosses[bossId] || null; }
function getAllState()         { return loadState().bosses; }

// ── Expansion boards ──────────────────────────────────────────────────────────
function getExpansionBoard(expansion)       { return loadState().expansionBoards[expansion] || null; }
function saveExpansionBoard(expansion, ids) {
  const s = loadState();
  s.expansionBoards[expansion] = { messageIds: ids };
  saveState(s);
}

// ── Channel slots ─────────────────────────────────────────────────────────────
// Keys in channelSlots:
//   summary           → Active Cooldowns card (slot 1 in main channel)
//   spawningTomorrow  → Spawning Tomorrow card (slot 2 in main channel)
//   [expansion]       → "Expansion → #thread" link (slot 3+ in main channel, posted ONCE)
//   tc_[expansion]    → Active Cooldowns card at top of each expansion thread

function getChannelSlots()   { return loadState().channelSlots || {}; }

// Slot IDs: prefer env vars (hardcoded once, survive redeploys) then fall back to state
function getSummaryMessageId()  { return process.env.SUMMARY_MESSAGE_ID || loadState().channelSlots?.summary || null; }
function setSummaryMessageId(id){ if (!process.env.SUMMARY_MESSAGE_ID) _setSlot('summary', id); }

function getSpawningTomorrowId()   { return process.env.SPAWNING_TOMORROW_MESSAGE_ID || loadState().channelSlots?.spawningTomorrow || null; }
function setSpawningTomorrowId(id) { if (!process.env.SPAWNING_TOMORROW_MESSAGE_ID) _setSlot('spawningTomorrow', id); }

function getDailySummaryMessageId()   { return process.env.DAILY_SUMMARY_MESSAGE_ID || loadState().channelSlots?.dailySummary || null; }
function setDailySummaryMessageId(id) { if (!process.env.DAILY_SUMMARY_MESSAGE_ID) _setSlot('dailySummary', id); }

function getThreadLinksMessageId()   { return process.env.THREAD_LINKS_MESSAGE_ID || loadState().channelSlots?.threadLinks || null; }
function setThreadLinksMessageId(id) { if (!process.env.THREAD_LINKS_MESSAGE_ID) _setSlot('threadLinks', id); }

function getChannelPlaceholder(expansion)     { return loadState().channelSlots?.[expansion] || null; }
function setChannelPlaceholder(expansion, id) { _setSlot(expansion, id); }

function getThreadCooldownId(expansion)      { return loadState().channelSlots?.[`tc_${expansion}`] || null; }
function setThreadCooldownId(expansion, id)  { _setSlot(`tc_${expansion}`, id); }

function _setSlot(key, id) {
  const s = loadState();
  s.channelSlots[key] = id;
  saveState(s);
}

// ── Zone cards ────────────────────────────────────────────────────────────────
function getZoneCard(zone)                      { return loadState().zoneCards[zone] || null; }
function setZoneCard(zone, messageId, threadId) { const s = loadState(); s.zoneCards[zone] = { messageId, threadId }; saveState(s); }
function clearZoneCard(zone)                    { const s = loadState(); delete s.zoneCards[zone]; saveState(s); }
function getAllZoneCards()                       { return loadState().zoneCards; }

// ── Daily kills ───────────────────────────────────────────────────────────────
function getDailyKills()   { return loadState().dailyKills || []; }
function resetDailyKills() { const s = loadState(); s.dailyKills = []; saveState(s); }

// ── Announce IDs ──────────────────────────────────────────────────────────────
function addAnnounceMessageId(id)    { const s = loadState(); s.announceMessageIds.push(id); saveState(s); }
function getAnnounceMessageIds()     { return loadState().announceMessageIds || []; }
function removeAnnounceMessageId(id) { const s = loadState(); s.announceMessageIds = s.announceMessageIds.filter(x => x !== id); saveState(s); }
function clearAnnounceMessageIds()   { const s = loadState(); s.announceMessageIds = []; saveState(s); }

// ── Spawn alert message tracking (for in-place update to spawned, delete at midnight) ──
function getSpawnAlertMessageId(bossId)      { return loadState().channelSlots?.[`alert_${bossId}`] || null; }
function setSpawnAlertMessageId(bossId, id)  { _setSlot(`alert_${bossId}`, id); }
function clearSpawnAlertMessageId(bossId)    {
  const s = loadState();
  delete s.channelSlots[`alert_${bossId}`];
  saveState(s);
}
function getAllSpawnAlertMessageIds() {
  const slots = loadState().channelSlots || {};
  return Object.entries(slots)
    .filter(([k]) => k.startsWith('alert_'))
    .map(([k, v]) => ({ bossId: k.replace('alert_', ''), messageId: v }));
}

// Legacy compat
function getBoardMessages()  { return []; }
function saveBoardMessages() {}

module.exports = {
  recordKill, overrideTimer, clearKill, getBossState, getAllState,
  getExpansionBoard, saveExpansionBoard,
  getChannelSlots,
  getSummaryMessageId, setSummaryMessageId,
  getSpawningTomorrowId, setSpawningTomorrowId,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getThreadLinksMessageId, setThreadLinksMessageId,
  getChannelPlaceholder, setChannelPlaceholder,
  getThreadCooldownId, setThreadCooldownId,
  getZoneCard, setZoneCard, clearZoneCard, getAllZoneCards,
  getDailyKills, resetDailyKills,
  addAnnounceMessageId, getAnnounceMessageIds, removeAnnounceMessageId, clearAnnounceMessageIds,
  getSpawnAlertMessageId, setSpawnAlertMessageId, clearSpawnAlertMessageId, getAllSpawnAlertMessageIds,
  getDailySummaryMessageId, setDailySummaryMessageId,
  getThreadLinksMessageId, setThreadLinksMessageId,
  getBoardMessages, saveBoardMessages,
};
