// utils/state.js — Full state persistence
const fs   = require('fs');
const path = require('path');
const STATE_FILE = path.join(__dirname, '../data/state.json');

function _empty() {
  return {
    bosses: {}, expansionBoards: {}, channelSlots: {},
    zoneCards: {}, dailyKills: [], announceMessageIds: [],
    announces: {}, pvpKills: {}, liveKills: {}, quake: null, pvpAlerts: {},
    seenWelcome: [], raidSession: null, raidNight: null, hateBoards: {}, ari: null, quarmyLinks: {},
  };
}

function loadState() {
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
    console.error('[state] CRITICAL: state.json parse error — keeping current file, returning empty to avoid data loss:', err.message);
    return _empty();
  }
  if (!raw || typeof raw !== 'object') {
    console.warn('[state] state.json is empty or not an object — starting fresh');
    return _empty();
  }
  const knownKeys = ['bosses', 'expansionBoards', 'channelSlots', 'zoneCards', 'dailyKills', 'announceMessageIds', 'announces', 'pvpKills', 'liveKills', 'quake', 'pvpAlerts', 'board', 'hateBoards'];
  const hasKnownKey = knownKeys.some((k) => k in raw);
  if (!hasKnownKey && Object.keys(raw).length > 0) {
    console.log('[state] Migrating old flat boss state format →', Object.keys(raw).length, 'entries');
    return { ..._empty(), bosses: raw };
  }
  const s = _empty();
  if (raw.bosses)             s.bosses             = raw.bosses;
  if (raw.expansionBoards)    s.expansionBoards    = raw.expansionBoards;
  if (raw.channelSlots)       s.channelSlots       = raw.channelSlots;
  if (raw.zoneCards)          s.zoneCards          = raw.zoneCards;
  if (raw.dailyKills)         s.dailyKills         = raw.dailyKills;
  if (raw.announceMessageIds) s.announceMessageIds = raw.announceMessageIds;
  if (raw.announces)          s.announces          = raw.announces;
  if (raw.pvpKills)           s.pvpKills           = raw.pvpKills;
  if (raw.liveKills)          s.liveKills          = raw.liveKills;
  if (raw.quake !== undefined) s.quake             = raw.quake;
  if (raw.pvpAlerts)          s.pvpAlerts          = raw.pvpAlerts;
  if (raw.seenWelcome)        s.seenWelcome        = raw.seenWelcome;
  if (raw.raidSession)        s.raidSession        = raw.raidSession;
  if (raw.raidNight)          s.raidNight          = raw.raidNight;
  if (raw.hateBoards)         s.hateBoards         = raw.hateBoards;
  if (raw.ari !== undefined)  s.ari                = raw.ari;
  if (raw.quarmyLinks)        s.quarmyLinks        = raw.quarmyLinks;
  const bossCount = Object.keys(s.bosses).length;
  if (bossCount > 0) console.log(`[state] Loaded state: ${bossCount} active kill(s)`);
  return s;
}

function saveState(state) {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('[state] CRITICAL: could not save state.json:', err.message);
  }
}

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
function clearKill(bossId) { const s = loadState(); delete s.bosses[bossId]; saveState(s); }
function getBossState(bossId) { return loadState().bosses[bossId] || null; }
function getAllState()         { return loadState().bosses; }

function getExpansionBoard(expansion)       { return loadState().expansionBoards[expansion] || null; }
function saveExpansionBoard(expansion, ids) {
  const s = loadState(); s.expansionBoards[expansion] = { messageIds: ids }; saveState(s);
}

function getChannelSlots() { return loadState().channelSlots || {}; }
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
function getThreadCooldownId(expansion) {
  const envKey = expansion.toUpperCase() + '_COOLDOWN_ID';
  return process.env[envKey] || loadState().channelSlots?.['tc_' + expansion] || null;
}
function setThreadCooldownId(expansion, id) {
  const envKey = expansion.toUpperCase() + '_COOLDOWN_ID';
  if (!process.env[envKey]) _setSlot('tc_' + expansion, id);
}
function _setSlot(key, id) { const s = loadState(); s.channelSlots[key] = id; saveState(s); }

function getZoneCard(zone)                      { return loadState().zoneCards[zone] || null; }
function setZoneCard(zone, messageId, threadId) { const s = loadState(); s.zoneCards[zone] = { messageId, threadId }; saveState(s); }
function clearZoneCard(zone)                    { const s = loadState(); delete s.zoneCards[zone]; saveState(s); }
function getAllZoneCards()                       { return loadState().zoneCards; }

function getDailyKills()   { return loadState().dailyKills || []; }
function resetDailyKills() { const s = loadState(); s.dailyKills = []; saveState(s); }

function addAnnounceMessageId(id)    { const s = loadState(); s.announceMessageIds.push(id); saveState(s); }
function getAnnounceMessageIds()     { return loadState().announceMessageIds || []; }
function removeAnnounceMessageId(id) { const s = loadState(); s.announceMessageIds = s.announceMessageIds.filter(x => x !== id); saveState(s); }
function clearAnnounceMessageIds()   { const s = loadState(); s.announceMessageIds = []; saveState(s); }

function getSpawnAlertMessageId(bossId)      { return loadState().channelSlots?.[`alert_${bossId}`] || null; }
function setSpawnAlertMessageId(bossId, id)  { _setSlot(`alert_${bossId}`, id); }
function clearSpawnAlertMessageId(bossId) {
  const s = loadState(); delete s.channelSlots[`alert_${bossId}`]; saveState(s);
}
function getAllSpawnAlertMessageIds() {
  const slots = loadState().channelSlots || {};
  return Object.entries(slots)
    .filter(([k]) => k.startsWith('alert_'))
    .map(([k, v]) => ({ bossId: k.replace('alert_', ''), messageId: v }));
}

function saveAnnounce(msgId, data) {
  const s = loadState();
  s.announces[msgId] = data;
  if (!s.announceMessageIds.includes(msgId)) s.announceMessageIds.push(msgId);
  saveState(s);
}
function getAnnounce(msgId)    { return loadState().announces[msgId] || null; }
function removeAnnounce(msgId) {
  const s = loadState();
  delete s.announces[msgId];
  s.announceMessageIds = s.announceMessageIds.filter(id => id !== msgId);
  saveState(s);
}
function getAllAnnounces()      { return loadState().announces || {}; }
function getAnnounceByThreadId(threadId) {
  const announces = loadState().announces || {};
  const entry = Object.entries(announces).find(([, d]) => d.threadId === threadId);
  return entry ? { messageId: entry[0], ...entry[1] } : null;
}
function updateAnnounceTargets(msgId, targets) {
  const s = loadState();
  if (!s.announces[msgId]) return false;
  s.announces[msgId].targets = targets; saveState(s); return true;
}
function updateAnnounceTime(msgId, plannedTimeMs, plannedTimeStr) {
  const s = loadState();
  if (!s.announces[msgId]) return false;
  s.announces[msgId].plannedTimeMs  = plannedTimeMs;
  s.announces[msgId].plannedTimeStr = plannedTimeStr;
  saveState(s); return true;
}
function updateAnnounceEasterEgg(msgId, level) {
  const s = loadState();
  if (!s.announces[msgId]) return false;
  s.announces[msgId].easterEggLevel = level; saveState(s); return true;
}

function pvpMobKey(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
function recordPvpKill(name, timerHours, killedBy, bossId = null, timerUnknown = false, killedAt = null) {
  const s = loadState();
  const key = bossId || pvpMobKey(name);
  killedAt = killedAt || Date.now();
  const baseMs = timerHours * 3600000;
  const nextSpawn = timerUnknown ? null : (killedAt + baseMs * 0.8);
  const nextSpawnLatest = timerUnknown ? null : (killedAt + baseMs * 1.2);
  const entry = { name, killedAt, nextSpawn, nextSpawnLatest, timerHours, killedBy, bossId: key, threadMessageId: null };
  if (timerUnknown) entry.timerUnknown = true;
  s.pvpKills[key] = entry; saveState(s); return key;
}
function setPvpKillThreadMessageId(key, messageId) {
  const s = loadState();
  if (s.pvpKills[key]) { s.pvpKills[key].threadMessageId = messageId; saveState(s); }
}
function clearPvpKill(key) { const s = loadState(); delete s.pvpKills[key]; saveState(s); }
function getAllPvpKills() { return loadState().pvpKills || {}; }
function applyQuakeToAllPvpKills(quakeTimeMs) {
  const s = loadState();
  for (const key of Object.keys(s.pvpKills)) {
    s.pvpKills[key].nextSpawn = quakeTimeMs;
    s.pvpKills[key].killedAt  = quakeTimeMs - s.pvpKills[key].timerHours * 3600000;
  }
  saveState(s);
}

function getPvpAlertHowlers(messageId) { return loadState().pvpAlerts?.[messageId]?.howlers || []; }
function addPvpAlertHowler(messageId, userId) {
  const s = loadState();
  if (!s.pvpAlerts) s.pvpAlerts = {};
  if (!s.pvpAlerts[messageId]) s.pvpAlerts[messageId] = { howlers: [] };
  if (!s.pvpAlerts[messageId].howlers.includes(userId)) s.pvpAlerts[messageId].howlers.push(userId);
  saveState(s);
  return s.pvpAlerts[messageId].howlers;
}
function clearPvpAlert(messageId) {
  const s = loadState(); if (s.pvpAlerts) delete s.pvpAlerts[messageId]; saveState(s);
}

function getQuake()      { return loadState().quake || null; }
function saveQuake(data) { const s = loadState(); s.quake = data; saveState(s); }
function clearQuake()    { const s = loadState(); s.quake = null; saveState(s); }

function hasSeenWelcome(userId) { return (loadState().seenWelcome || []).includes(userId); }
function markWelcomeSeen(userId) {
  const s = loadState();
  if (!s.seenWelcome) s.seenWelcome = [];
  if (!s.seenWelcome.includes(userId)) { s.seenWelcome.push(userId); saveState(s); }
}

function getRaidSession()       { return loadState().raidSession || null; }
function saveRaidSession(data)  { const s = loadState(); s.raidSession = data; saveState(s); }
function clearRaidSession()     { const s = loadState(); s.raidSession = null; saveState(s); }

function getRaidNight()      { return loadState().raidNight || null; }
function saveRaidNight(data) { const s = loadState(); s.raidNight = data; saveState(s); }
function clearRaidNight()    { const s = loadState(); s.raidNight = null; saveState(s); }

function getAri()      { return loadState().ari || null; }
function setAri(data)  { const s = loadState(); s.ari = data; saveState(s); }
function clearAri()    { const s = loadState(); s.ari = null; saveState(s); }

function recordLiveKill(bossId, bossName, timerHours, killedBy, timerUnknown = false, killedAt = null) {
  const s = loadState();
  killedAt = killedAt || Date.now();
  const nextSpawn = timerUnknown ? null : (killedAt + timerHours * 3600000);
  const entry = { bossId, name: bossName, killedAt, nextSpawn, timerHours, killedBy, channelMessageId: null };
  if (timerUnknown) entry.timerUnknown = true;
  s.liveKills[bossId] = entry; saveState(s);
}
function setLiveKillMessageId(bossId, messageId) {
  const s = loadState();
  if (s.liveKills[bossId]) { s.liveKills[bossId].channelMessageId = messageId; saveState(s); }
}
function clearLiveKill(bossId) { const s = loadState(); delete s.liveKills[bossId]; saveState(s); }
function getAllLiveKills()      { return loadState().liveKills || {}; }

function getHateBoardMessageId(type) {
  const envKey = type === 'live' ? 'LIVE_HATE_BOARD_ID' : 'PVP_HATE_BOARD_ID';
  return process.env[envKey] || loadState().hateBoards?.[type] || null;
}
function setHateBoardMessageId(type, id) {
  const envKey = type === 'live' ? 'LIVE_HATE_BOARD_ID' : 'PVP_HATE_BOARD_ID';
  if (process.env[envKey]) return;
  const s = loadState(); s.hateBoards[type] = id; saveState(s);
}
function setLiveKillTimerUnknown(key) {
  const s = loadState();
  if (!s.liveKills[key]) return;
  s.liveKills[key].timerUnknown = true; s.liveKills[key].nextSpawn = null; saveState(s);
}
function setPvpKillTimerUnknown(key) {
  const s = loadState();
  if (!s.pvpKills[key]) return;
  s.pvpKills[key].timerUnknown = true; s.pvpKills[key].nextSpawn = null; s.pvpKills[key].nextSpawnLatest = null; saveState(s);
}

function getQuarmyLink(name) { return loadState().quarmyLinks?.[name.toLowerCase()] || null; }
function setQuarmyLink(name, url) {
  const s = loadState(); s.quarmyLinks[name.toLowerCase()] = url; saveState(s);
}
function clearQuarmyLink(name) {
  const s = loadState(); delete s.quarmyLinks[name.toLowerCase()]; saveState(s);
}

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
  hasSeenWelcome, markWelcomeSeen,
  saveAnnounce, getAnnounce, removeAnnounce, getAllAnnounces,
  getAnnounceByThreadId, updateAnnounceTargets, updateAnnounceTime, updateAnnounceEasterEgg,
  recordPvpKill, clearPvpKill, getAllPvpKills, applyQuakeToAllPvpKills, pvpMobKey, setPvpKillThreadMessageId,
  recordLiveKill, setLiveKillMessageId, clearLiveKill, getAllLiveKills,
  getHateBoardMessageId, setHateBoardMessageId,
  setLiveKillTimerUnknown, setPvpKillTimerUnknown,
  getQuake, saveQuake, clearQuake,
  getPvpAlertHowlers, addPvpAlertHowler, clearPvpAlert,
  getRaidSession, saveRaidSession, clearRaidSession,
  getRaidNight, saveRaidNight, clearRaidNight,
  getAri, setAri, clearAri,
  getQuarmyLink, setQuarmyLink, clearQuarmyLink,
};
