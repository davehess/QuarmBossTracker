// utils/state.js
// Persists kill/spawn state and board message IDs to a JSON file

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../data/state.json');

// State schema:
// {
//   bosses: {
//     [bossId]: {
//       killedAt: number,       // ms timestamp
//       nextSpawn: number,      // ms timestamp
//       killedBy: string,       // Discord user ID
//       killMessageId: string,  // ID of the kill embed message in #raid-mobs
//     }
//   },
//   board: {
//     messages: [               // ordered list of board message IDs
//       { messageId: string, type: 'header'|'zone', label: string }
//     ]
//   }
// }

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const empty = { bosses: {}, board: { messages: [] } };
    fs.writeFileSync(STATE_FILE, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Migrate old flat format (pre-board-tracking) gracefully
    if (!raw.bosses && !raw.board) {
      return { bosses: raw, board: { messages: [] } };
    }
    if (!raw.board) raw.board = { messages: [] };
    if (!raw.bosses) raw.bosses = {};
    return raw;
  } catch {
    return { bosses: {}, board: { messages: [] } };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function recordKill(bossId, timerHours, killedBy, killMessageId = null) {
  const state = loadState();
  const killedAt = Date.now();
  const nextSpawn = killedAt + timerHours * 60 * 60 * 1000;
  state.bosses[bossId] = { killedAt, nextSpawn, killedBy, killMessageId };
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
  const state = loadState();
  return state.bosses[bossId] || null;
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

module.exports = {
  recordKill,
  setKillMessageId,
  clearKill,
  getBossState,
  getAllState,
  getBoardMessages,
  saveBoardMessages,
};
