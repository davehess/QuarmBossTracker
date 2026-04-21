// utils/state.js
// Persists kill/spawn state to a JSON file so data survives restarts

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../data/state.json');

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({}), 'utf8');
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Record a boss kill. Returns the updated boss state entry.
 * @param {string} bossId
 * @param {number} timerHours
 * @param {string} killedBy - Discord user tag
 */
function recordKill(bossId, timerHours, killedBy) {
  const state = loadState();
  const killedAt = Date.now();
  const nextSpawn = killedAt + timerHours * 60 * 60 * 1000;

  state[bossId] = {
    killedAt,
    nextSpawn,
    killedBy,
  };

  saveState(state);
  return state[bossId];
}

/**
 * Clear a boss's kill record (mark as unknown / not killed)
 */
function clearKill(bossId) {
  const state = loadState();
  delete state[bossId];
  saveState(state);
}

/**
 * Get the state entry for a single boss
 */
function getBossState(bossId) {
  const state = loadState();
  return state[bossId] || null;
}

/**
 * Get full state map
 */
function getAllState() {
  return loadState();
}

module.exports = {
  recordKill,
  clearKill,
  getBossState,
  getAllState,
};
