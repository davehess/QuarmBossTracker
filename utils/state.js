// utils/state.js — Full state persistence

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../data/state.json');

// State schema:
// {
//   bosses: {
//     [bossId]: { killedAt, nextSpawn, killedBy, zoneCardMessageId }
//   },
//   board: { messages: [{ messageId, panelIndex }] },
//   zoneCards: {
//     [zone]: { messageId }   // the single consolidated kill card per zone
//   },
//   dailyKills: [{ bossId, killedAt, killedBy }],
//   announceMessageIds: [string]
// }

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const empty = { bosses: {}, board: { messages: [] }, zoneCards: {}, dailyKills: [], announceMessageIds: [] };
    fs.writeFileSync(STATE_FILE, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!raw.bosses && !raw.board) return { bosses: raw, board: { messages: [] }, zoneCards: {}, dailyKills: [], announceMessageIds: [] };
    if (!raw.board)               raw.board = { messages: [] };
    if (!raw.bosses)              raw.bosses = {};
    if (!raw.zoneCards)           raw.zoneCards = {};
    if (!raw.dailyKills)          raw.dailyKills = [];
    if (!raw.announceMessageIds)  raw.announceMessageIds = [];
    return raw;
  } catch {
    return { bosses: {}, board: { messages: [] }, zoneCards: {}, dailyKills: [], announceMessageIds: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ── Boss kill tracking ────────────────────────────────────────────────────────

function recordKill(bossId, timerHours, killedBy) {
  const state     = loadState();
  const killedAt  = Date.now();
  const nextSpawn = killedAt + timerHours * 60 * 60 * 1000;
  state.bosses[bossId] = { killedAt, nextSpawn, killedBy, zoneCardMessageId: null };
  state.dailyKills.push({ bossId, killedAt, killedBy });
  saveState(state);
  return state.bosses[bossId];
}

function setZoneCardMessageId(bossId, messageId) {
  const state = loadState();
  if (state.bosses[bossId]) {
    state.bosses[bossId].zoneCardMessageId = messageId;
    saveState(state);
  }
}

function clearKill(bossId) {
  const state = loadState();
  delete state.bosses[bossId];
  saveState(state);
}

function getBossState(bossId) {
  return loadState().bosses[bossId] || null;
}

function getAllState() {
  return loadState().bosses;
}

// ── Zone card tracking ────────────────────────────────────────────────────────
// One message per zone containing all current kills in that zone

function getZoneCard(zone) {
  return loadState().zoneCards[zone] || null;
}

function setZoneCard(zone, messageId) {
  const state = loadState();
  state.zoneCards[zone] = { messageId };
  saveState(state);
}

function clearZoneCard(zone) {
  const state = loadState();
  delete state.zoneCards[zone];
  saveState(state);
}

function getAllZoneCards() {
  return loadState().zoneCards;
}

// ── Board message tracking ────────────────────────────────────────────────────

function getBoardMessages() {
  return loadState().board.messages || [];
}

function saveBoardMessages(messages) {
  const state = loadState();
  state.board.messages = messages;
  saveState(state);
}

// ── Daily kills log ───────────────────────────────────────────────────────────

function getDailyKills() {
  return loadState().dailyKills || [];
}

function resetDailyKills() {
  const state = loadState();
  state.dailyKills = [];
  saveState(state);
}

// ── Announce message IDs ──────────────────────────────────────────────────────

function addAnnounceMessageId(messageId) {
  const state = loadState();
  state.announceMessageIds.push(messageId);
  saveState(state);
}

function getAnnounceMessageIds() {
  return loadState().announceMessageIds || [];
}

function clearAnnounceMessageIds() {
  const state = loadState();
  state.announceMessageIds = [];
  saveState(state);
}

module.exports = {
  recordKill,
  setZoneCardMessageId,
  clearKill,
  getBossState,
  getAllState,
  getZoneCard,
  setZoneCard,
  clearZoneCard,
  getAllZoneCards,
  getBoardMessages,
  saveBoardMessages,
  getDailyKills,
  resetDailyKills,
  addAnnounceMessageId,
  getAnnounceMessageIds,
  clearAnnounceMessageIds,
};
