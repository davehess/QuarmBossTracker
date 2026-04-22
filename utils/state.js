// utils/state.js — Full state persistence
// New schema supports per-expansion thread boards, summary card, and zone cards in threads.

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../data/state.json');

// Schema:
// {
//   bosses: { [bossId]: { killedAt, nextSpawn, killedBy } },
//
//   // Per-expansion board: button panels live in each thread
//   expansionBoards: {
//     [expansion]: { messageIds: [string, ...] }
//   },
//
//   // "." placeholder messages in the main channel (one per expansion + summary)
//   channelSlots: {
//     summary:  string,           // messageId of top-of-channel summary card
//     [expansion]: string         // messageId of "." placeholder for each expansion
//   },
//
//   // Zone kill cards: live in the expansion thread, not the main channel
//   zoneCards: { [zone]: { messageId: string, threadId: string } },
//
//   dailyKills:        [{ bossId, killedAt, killedBy }],
//   announceMessageIds: [string],
// }

function _empty() {
  return {
    bosses:          {},
    expansionBoards: {},
    channelSlots:    {},
    zoneCards:       {},
    dailyKills:      [],
    announceMessageIds: [],
  };
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const e = _empty();
    fs.writeFileSync(STATE_FILE, JSON.stringify(e, null, 2), 'utf8');
    return e;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Migrate old formats
    if (!raw.bosses && !raw.board) return { ..._empty(), bosses: raw };
    const s = _empty();
    s.bosses             = raw.bosses             || {};
    s.expansionBoards    = raw.expansionBoards     || {};
    s.channelSlots       = raw.channelSlots        || {};
    s.zoneCards          = raw.zoneCards           || {};
    s.dailyKills         = raw.dailyKills          || [];
    s.announceMessageIds = raw.announceMessageIds  || [];
    return s;
  } catch {
    return _empty();
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ── Boss kills ────────────────────────────────────────────────────────────────

function recordKill(bossId, timerHours, killedBy) {
  const state    = loadState();
  const killedAt = Date.now();
  const nextSpawn = killedAt + timerHours * 3600000;
  state.bosses[bossId] = { killedAt, nextSpawn, killedBy };
  state.dailyKills.push({ bossId, killedAt, killedBy });
  saveState(state);
  return state.bosses[bossId];
}

function overrideTimer(bossId, nextSpawn) {
  const state = loadState();
  if (state.bosses[bossId]) {
    state.bosses[bossId].nextSpawn = nextSpawn;
    saveState(state);
    return true;
  }
  return false;
}

function clearKill(bossId) {
  const state = loadState();
  delete state.bosses[bossId];
  saveState(state);
}

function getBossState(bossId)  { return loadState().bosses[bossId] || null; }
function getAllState()          { return loadState().bosses; }

// ── Expansion boards (per-thread) ────────────────────────────────────────────

function getExpansionBoard(expansion) {
  return loadState().expansionBoards[expansion] || null;
}

function saveExpansionBoard(expansion, messageIds) {
  const state = loadState();
  if (!state.expansionBoards) state.expansionBoards = {};
  state.expansionBoards[expansion] = { messageIds };
  saveState(state);
}

// ── Channel slots (summary + "." placeholders) ────────────────────────────────

function getChannelSlots()         { return loadState().channelSlots || {}; }
function getSummaryMessageId()     { return loadState().channelSlots?.summary || null; }
function setSummaryMessageId(id)   { const s = loadState(); s.channelSlots = s.channelSlots || {}; s.channelSlots.summary = id; saveState(s); }
function getChannelPlaceholder(expansion)      { return loadState().channelSlots?.[expansion] || null; }
function setChannelPlaceholder(expansion, id)  { const s = loadState(); s.channelSlots = s.channelSlots || {}; s.channelSlots[expansion] = id; saveState(s); }

// ── Zone cards (live in expansion threads) ────────────────────────────────────

function getZoneCard(zone)                     { return loadState().zoneCards[zone] || null; }
function setZoneCard(zone, messageId, threadId){ const s = loadState(); s.zoneCards[zone] = { messageId, threadId }; saveState(s); }
function clearZoneCard(zone)                   { const s = loadState(); delete s.zoneCards[zone]; saveState(s); }
function getAllZoneCards()                      { return loadState().zoneCards; }

// ── Daily kills ───────────────────────────────────────────────────────────────

function getDailyKills()  { return loadState().dailyKills || []; }
function resetDailyKills(){ const s = loadState(); s.dailyKills = []; saveState(s); }

// ── Announce IDs ──────────────────────────────────────────────────────────────

function addAnnounceMessageId(id)    { const s = loadState(); s.announceMessageIds.push(id); saveState(s); }
function getAnnounceMessageIds()     { return loadState().announceMessageIds || []; }
function removeAnnounceMessageId(id) { const s = loadState(); s.announceMessageIds = s.announceMessageIds.filter(x => x !== id); saveState(s); }
function clearAnnounceMessageIds()   { const s = loadState(); s.announceMessageIds = []; saveState(s); }

// Legacy compat (old code may call these)
function getBoardMessages()          { return []; }
function saveBoardMessages()         {}

module.exports = {
  recordKill, overrideTimer, clearKill, getBossState, getAllState,
  getExpansionBoard, saveExpansionBoard,
  getChannelSlots, getSummaryMessageId, setSummaryMessageId,
  getChannelPlaceholder, setChannelPlaceholder,
  getZoneCard, setZoneCard, clearZoneCard, getAllZoneCards,
  getDailyKills, resetDailyKills,
  addAnnounceMessageId, getAnnounceMessageIds, removeAnnounceMessageId, clearAnnounceMessageIds,
  getBoardMessages, saveBoardMessages,
};
