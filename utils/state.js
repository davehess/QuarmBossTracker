// utils/state.js
// Persists kill/spawn state, board message IDs, and announce message IDs.

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../data/state.json');

// State schema:
// {
//   bosses: {
//     [bossId]: {
//       killedAt:      number,   // ms timestamp of kill
//       nextSpawn:     number,   // ms timestamp of next spawn
//       killedBy:      string,   // Discord user ID
//       killMessageId: string,   // message ID of kill embed in #raid-mobs
//     }
//   },
//   board: {
//     messages: [{ messageId, panelIndex }]
//   },
//   dailyKills: [              // kills recorded today (midnight reset)
//     { bossId, killedAt, killedBy }
//   ],
//   announceMessageIds: [string]  // /announce message IDs to archive at midnight
// }

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const empty = { bosses: {}, board: { messages: [] }, dailyKills: [], announceMessageIds: [] };
    fs.writeFileSync(STATE_FILE, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!raw.bosses && !raw.board) return { bosses: raw, board: { messages: [] }, dailyKills: [], announceMessageIds: [] };
    if (!raw.board)               raw.board = { messages: [] };
    if (!raw.bosses)              raw.bosses = {};
    if (!raw.dailyKills)          raw.dailyKills = [];
    if (!raw.announceMessageIds)  raw.announceMessageIds = [];
    return raw;
  } catch {
    return { bosses: {}, board: { messages: [] }, dailyKills: [], announceMessageIds: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ── Boss kill tracking ────────────────────────────────────────────────────────

function recordKill(bossId, timerHours, killedBy, killMessageId = null) {
  const state     = loadState();
  const killedAt  = Date.now();
  const nextSpawn = killedAt + timerHours * 60 * 60 * 1000;

  state.bosses[bossId] = { killedAt, nextSpawn, killedBy, killMessageId };

  // Also push to daily kills log
  state.dailyKills.push({ bossId, killedAt, killedBy });

  saveState(state);
  return state.bosses[bossId];
}

function setKillMessageId(bossId, killMessageId) {
  const state = loadState();
  if (state.bosses[bossId]) {
    state.bosses[bossId].killMessageId = killMessageId;
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
  setKillMessageId,
  clearKill,
  getBossState,
  getAllState,
  getBoardMessages,
  saveBoardMessages,
  getDailyKills,
  resetDailyKills,
  addAnnounceMessageId,
  getAnnounceMessageIds,
  clearAnnounceMessageIds,
};
