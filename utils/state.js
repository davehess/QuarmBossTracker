// utils/state.js — Full state persistence
// IMPORTANT: state.json must be stored in a persistent volume, never baked into Docker image.
// See .dockerignore which excludes data/state.json from the image build.

const fs   = require('fs');
const path = require('path');
const { normalizeClass } = require('./classTitles');
const STATE_FILE = path.join(__dirname, '../data/state.json');

function _empty() {
  return {
    bosses: {}, expansionBoards: {}, channelSlots: {},
    zoneCards: {}, dailyKills: [], announceMessageIds: [],
    announces: {}, pvpKills: {}, liveKills: {}, quake: null, pvpAlerts: {},
    pvpNight: { permanent: [], tonight: {}, boardMsg: null },
    seenWelcome: [], raidSession: null, raidNight: null, hateBoards: {}, ari: null, quarmyLinks: {},
    auditEntries: [],
    agentTestCards: {}, agentSessionCardId: null,
    petOwners: {},
    whoData: {},
    pendingLoot: {},
  };
}

// Memoized snapshot — the file is read + JSON.parse'd ONCE and the same
// object is returned until saveState replaces it or the file's mtime changes
// (an out-of-band edit). Before this, EVERY loadState() call synchronously
// re-read and re-parsed the whole (forever-growing) state.json — and hot
// paths like /api/agent/who-lookup called it up to 80× per request via
// getWhoEntry, blocking the event loop for all agents (2026-07-07 efficiency
// review, finding H1). Callers already follow load→mutate→save, so handing
// back the cached object is semantics-preserving; parse-error paths stay
// UNCACHED so a corrupted file keeps being retried instead of pinning an
// empty state in memory.
let _stateCache = null;
let _stateCacheMtimeMs = 0;
function _cacheState(s) {
  try { _stateCacheMtimeMs = fs.statSync(STATE_FILE).mtimeMs; } catch { _stateCacheMtimeMs = 0; }
  _stateCache = s;
  return s;
}

function loadState() {
  if (_stateCache) {
    try {
      if (fs.statSync(STATE_FILE).mtimeMs === _stateCacheMtimeMs) return _stateCache;
    } catch { /* file vanished — fall through to the fresh-create path */ }
  }
  // If file doesn't exist, create it fresh
  if (!fs.existsSync(STATE_FILE)) {
    console.log('[state] state.json not found — creating fresh state');
    const e = _empty();
    fs.writeFileSync(STATE_FILE, JSON.stringify(e, null, 2), 'utf8');
    return _cacheState(e);
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
  const knownKeys = ['bosses', 'expansionBoards', 'channelSlots', 'zoneCards', 'dailyKills', 'announceMessageIds', 'announces', 'pvpKills', 'liveKills', 'quake', 'pvpAlerts', 'board', 'hateBoards'];
  const hasKnownKey = knownKeys.some((k) => k in raw);
  if (!hasKnownKey && Object.keys(raw).length > 0) {
    // Old format: the whole object IS the bosses map
    console.log('[state] Migrating old flat boss state format →', Object.keys(raw).length, 'entries');
    return _cacheState({ ..._empty(), bosses: raw });
  }

  // Normal load — merge with empty defaults so new keys always exist
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
  if (raw.serverQuake !== undefined) s.serverQuake = raw.serverQuake;
  if (raw.pvpAlerts)          s.pvpAlerts          = raw.pvpAlerts;
  if (raw.pvpNight)           s.pvpNight           = raw.pvpNight;
  if (raw.seenWelcome)        s.seenWelcome        = raw.seenWelcome;
  if (raw.raidSession)        s.raidSession        = raw.raidSession;
  if (raw.raidNight)          s.raidNight          = raw.raidNight;
  if (raw.hateBoards)         s.hateBoards         = raw.hateBoards;
  if (raw.ari !== undefined)  s.ari                = raw.ari;
  if (raw.quarmyLinks)        s.quarmyLinks        = raw.quarmyLinks;
  if (raw.auditEntries)       s.auditEntries       = raw.auditEntries;
  if (raw.agentTestCards)     s.agentTestCards     = raw.agentTestCards;
  if (raw.agentSessionCardId != null) s.agentSessionCardId = raw.agentSessionCardId;
  if (raw.petOwners)          s.petOwners          = raw.petOwners;
  if (raw.whoData)            s.whoData            = raw.whoData;
  if (raw.pendingLoot)        s.pendingLoot        = raw.pendingLoot;

  const bossCount = Object.keys(s.bosses).length;
  if (bossCount > 0) {
    console.log(`[state] Loaded state: ${bossCount} active kill(s)`);
  }

  return _cacheState(s);
}

function saveState(state) {
  try {
    // Write to a temp file first, then rename — prevents corruption if process dies mid-write
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
    _cacheState(state);
  } catch (err) {
    console.error('[state] CRITICAL: could not save state.json:', err.message);
  }
}

// ── Boss kills ──────────────────────────────────────────────────────────────────────────────
function recordKill(bossId, timerHours, killedBy, killedAtOverride) {
  const state     = loadState();
  const killedAt  = killedAtOverride || Date.now();
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
function restoreBossState(bossId, prev) {
  if (!prev) return;
  const s = loadState();
  s.bosses[bossId] = { killedAt: prev.killedAt, nextSpawn: prev.nextSpawn, killedBy: prev.killedBy };
  saveState(s);
}

// ── Expansion boards ─────────────────────────────────────────────────────────────────────
function getExpansionBoard(expansion)       { return loadState().expansionBoards[expansion] || null; }
function saveExpansionBoard(expansion, ids) {
  const s = loadState();
  s.expansionBoards[expansion] = { messageIds: ids };
  saveState(s);
}

// ── Channel slots ─────────────────────────────────────────────────────────────────────────
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

function getThreadCooldownId(expansion) {
  const envKey = expansion.toUpperCase() + '_COOLDOWN_ID';
  return process.env[envKey] || loadState().channelSlots?.['tc_' + expansion] || null;
}
function setThreadCooldownId(expansion, id) {
  const envKey = expansion.toUpperCase() + '_COOLDOWN_ID';
  if (!process.env[envKey]) _setSlot('tc_' + expansion, id);
}

function _setSlot(key, id) {
  const s = loadState();
  s.channelSlots[key] = id;
  saveState(s);
}

// ── Zone cards ───────────────────────────────────────────────────────────────────────────────
function getZoneCard(zone)                      { return loadState().zoneCards[zone] || null; }
function setZoneCard(zone, messageId, threadId) { const s = loadState(); s.zoneCards[zone] = { messageId, threadId }; saveState(s); }
function clearZoneCard(zone)                    { const s = loadState(); delete s.zoneCards[zone]; saveState(s); }
function getAllZoneCards()                       { return loadState().zoneCards; }

// ── Daily kills ─────────────────────────────────────────────────────────────────────────────
function getDailyKills()   { return loadState().dailyKills || []; }
function resetDailyKills() { const s = loadState(); s.dailyKills = []; saveState(s); }

// ── Announce IDs ────────────────────────────────────────────────────────────────────────────
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

// ── Announce events (full data) ───────────────────────────────────────────────────────────────
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
  s.announces[msgId].targets = targets;
  saveState(s);
  return true;
}
function updateAnnounceTime(msgId, plannedTimeMs, plannedTimeStr) {
  const s = loadState();
  if (!s.announces[msgId]) return false;
  s.announces[msgId].plannedTimeMs  = plannedTimeMs;
  s.announces[msgId].plannedTimeStr = plannedTimeStr;
  saveState(s);
  return true;
}
function updateAnnounceEasterEgg(msgId, level) {
  const s = loadState();
  if (!s.announces[msgId]) return false;
  s.announces[msgId].easterEggLevel = level;
  saveState(s);
  return true;
}

// ── PVP kills ────────────────────────────────────────────────────────────────────────────────
function pvpMobKey(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '_'); }
function recordPvpKill(name, timerHours, killedBy, bossId = null, timerUnknown = false, killedAt = null) {
  const s = loadState();
  const key = bossId || pvpMobKey(name);
  killedAt            = killedAt || Date.now();
  const baseMs        = timerHours * 3600000;
  const nextSpawn     = timerUnknown ? null : (killedAt + baseMs * 0.8);
  const nextSpawnLatest = timerUnknown ? null : (killedAt + baseMs * 1.2);
  const entry = { name, killedAt, nextSpawn, nextSpawnLatest, timerHours, killedBy, bossId: key, threadMessageId: null };
  if (timerUnknown) entry.timerUnknown = true;
  s.pvpKills[key] = entry;
  saveState(s);
  return key;
}
function setPvpKillThreadMessageId(key, messageId) {
  const s = loadState();
  if (s.pvpKills[key]) { s.pvpKills[key].threadMessageId = messageId; saveState(s); }
}
function clearPvpKill(key) {
  const s = loadState();
  delete s.pvpKills[key];
  saveState(s);
}
function getAllPvpKills() { return loadState().pvpKills || {}; }

// Quake reset. A quake repops every PVP mob, so its spawn window opens
// immediately: set the EARLIEST spawn (nextSpawn) to the quake time — for an
// immediate quake that reads "available now". We deliberately PRESERVE killedAt
// and nextSpawnLatest so each row's kill date + latest-spawn window stay intact
// ("timers can still stay there"); only the early edge moves. (Previously this
// also rewrote killedAt, which shifted the whole window and lost the original
// latest spawn.)
function applyQuakeToAllPvpKills(quakeTimeMs) {
  const s = loadState();
  for (const key of Object.keys(s.pvpKills)) {
    s.pvpKills[key].nextSpawn = quakeTimeMs;
  }
  saveState(s);
}

// ── PVP alert howlers ──────────────────────────────────────────────────────────────────────────
function getPvpAlertHowlers(messageId) { return loadState().pvpAlerts?.[messageId]?.howlers || []; }
function addPvpAlertHowler(messageId, userId) {
  const s = loadState();
  if (!s.pvpAlerts) s.pvpAlerts = {};
  if (!s.pvpAlerts[messageId]) s.pvpAlerts[messageId] = { howlers: [] };
  if (!s.pvpAlerts[messageId].howlers.includes(userId))
    s.pvpAlerts[messageId].howlers.push(userId);
  saveState(s);
  return s.pvpAlerts[messageId].howlers;
}
function clearPvpAlert(messageId) {
  const s = loadState();
  if (s.pvpAlerts) delete s.pvpAlerts[messageId];
  saveState(s);
}

// ── PVP overnight-ping opt-in list ──────────────────────────────────────────
// During PvP quiet hours, automated @PVP pings are muted for the role at large
// and instead go ONLY to users who opted in here. Two tiers:
//   permanent: [userId]            — always pinged overnight
//   tonight:   { userId: expiresAt } — pinged until expiresAt (next 8am)
// boardMsg holds the anchor message id of the opt-in board (so /pvpnightpings
// refreshes in place instead of duplicating).
function _pvpNight(s) {
  if (!s.pvpNight || typeof s.pvpNight !== 'object') s.pvpNight = { permanent: [], tonight: {}, boardMsg: null };
  if (!Array.isArray(s.pvpNight.permanent)) s.pvpNight.permanent = [];
  if (!s.pvpNight.tonight || typeof s.pvpNight.tonight !== 'object') s.pvpNight.tonight = {};
  return s.pvpNight;
}
function getPvpNight() { return _pvpNight(loadState()); }
// Active overnight-ping users right now: permanent ∪ (tonight not yet expired).
// Prunes expired "tonight" entries as a side effect so the list stays tidy.
function getActivePvpNightUserIds(now = Date.now()) {
  const s = loadState();
  const n = _pvpNight(s);
  let changed = false;
  for (const [uid, exp] of Object.entries(n.tonight)) {
    if (!exp || exp <= now) { delete n.tonight[uid]; changed = true; }
  }
  if (changed) saveState(s);
  const set = new Set(n.permanent);
  for (const uid of Object.keys(n.tonight)) set.add(uid);
  return [...set];
}
function addPvpNightTonight(userId, expiresAt) {
  const s = loadState(); const n = _pvpNight(s);
  n.tonight[userId] = expiresAt;
  // Opting in "tonight" while already permanent is a no-op on permanent.
  saveState(s);
  return n;
}
function addPvpNightPermanent(userId) {
  const s = loadState(); const n = _pvpNight(s);
  if (!n.permanent.includes(userId)) n.permanent.push(userId);
  delete n.tonight[userId];   // permanent supersedes a tonight entry
  saveState(s);
  return n;
}
function removePvpNight(userId) {
  const s = loadState(); const n = _pvpNight(s);
  n.permanent = n.permanent.filter(u => u !== userId);
  delete n.tonight[userId];
  saveState(s);
  return n;
}
function getPvpNightBoardMsg()        { return _pvpNight(loadState()).boardMsg || null; }
function setPvpNightBoardMsg(msgId)   { const s = loadState(); _pvpNight(s).boardMsg = msgId || null; saveState(s); }

// ── Quake state ────────────────────────────────────────────────────────────────────────────────
function getQuake()              { return loadState().quake || null; }
function saveQuake(data)         { const s = loadState(); s.quake = data; saveState(s); }
function clearQuake()            { const s = loadState(); s.quake = null; saveState(s); }

// Server-wide PvP EARTHQUAKE (distinct from the officer /quake reset above).
// { next_quake_at, detected_at, source_text, messageId } — parsed from the
// in-game "The next earthquake will begin in…" line by the agent.
function getServerQuake()       { return loadState().serverQuake || null; }
function saveServerQuake(data)  { const s = loadState(); s.serverQuake = data; saveState(s); }

// ── Welcome card seen tracking ────────────────────────────────────────────────────────────────────
function hasSeenWelcome(userId) { return (loadState().seenWelcome || []).includes(userId); }
function markWelcomeSeen(userId) {
  const s = loadState();
  if (!s.seenWelcome) s.seenWelcome = [];
  if (!s.seenWelcome.includes(userId)) { s.seenWelcome.push(userId); saveState(s); }
}

// ── Raid session ───────────────────────────────────────────────────────────────────────────────
// { date, threadId, channelId, summaryMessageId, openedAt, sessionDamage: { lowerName: { name, damage, duration, encounters } } }
function getRaidSession()       { return loadState().raidSession || null; }
function saveRaidSession(data)  { const s = loadState(); s.raidSession = data; saveState(s); }
function clearRaidSession()     { const s = loadState(); s.raidSession = null; saveState(s); }

// Zero out the per-player session damage map without ending the session.
// Used by /parsereset to wipe stale leaderboard data after testing.
function clearSessionDamage() {
  const s = loadState();
  if (s.raidSession) { s.raidSession.sessionDamage = {}; saveState(s); }
}

// Targets list for the raid session — mirrors the /announce target list so
// /addtarget + /removetarget work inside the raid-night thread too. Each
// entry is a boss id (matches data/bosses.json).
function getRaidSessionTargets() {
  const s = loadState();
  return s.raidSession?.targets || [];
}
function addRaidSessionTarget(bossId) {
  const s = loadState();
  if (!s.raidSession) return false;
  const list = s.raidSession.targets || [];
  if (list.includes(bossId)) return false;
  list.push(bossId);
  s.raidSession.targets = list;
  saveState(s);
  return true;
}
function removeRaidSessionTarget(bossId) {
  const s = loadState();
  if (!s.raidSession) return false;
  const list = s.raidSession.targets || [];
  const idx = list.indexOf(bossId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  s.raidSession.targets = list;
  saveState(s);
  return true;
}

// Accumulate per-player damage into the active raid session (called after every agent encounter upload).
// players = [{ name, damage, duration }] — same shape as parses.json players array.
// No-ops if no session is active.
function accumulateSessionDamage(players, encounterDuration) {
  if (!Array.isArray(players) || players.length === 0) return;
  const s = loadState();
  if (!s.raidSession) return;
  if (!s.raidSession.sessionDamage) s.raidSession.sessionDamage = {};
  const sd = s.raidSession.sessionDamage;
  for (const p of players) {
    const key = p.name.toLowerCase();
    if (sd[key]) {
      sd[key].damage     += p.damage;
      sd[key].duration   += encounterDuration;
      sd[key].encounters++;
    } else {
      sd[key] = { name: p.name, damage: p.damage, duration: encounterDuration, encounters: 1 };
    }
  }
  saveState(s);
}

// ── Raid night (DKP tick tracking) ──────────────────────────────────────────────────────────────────
// { date, raidId, name, poolId, ticks: { 1:{ tickId, description, postedAt, count }, ... } }
function getRaidNight()        { return loadState().raidNight || null; }
function saveRaidNight(data)   { const s = loadState(); s.raidNight = data; saveState(s); }
function clearRaidNight()      { const s = loadState(); s.raidNight = null; saveState(s); }

// ── Auto-raid invite (ARI) state ───────────────────────────────────────────────────────────────
// Stores { character: string, password: string, setBy: userId } or null
function getAri()          { return loadState().ari || null; }
function setAri(data)      { const s = loadState(); s.ari = data; saveState(s); _mirrorAriToSupabase(data); }
function clearAri()        { const s = loadState(); s.ari = null; saveState(s); _mirrorAriToSupabase(null); }

// Mirror to public.ari_state so wolfpack.quest can render the MIC banner
// without round-tripping through the bot. Fire-and-forget — local state
// remains canonical. Falls through silently if Supabase isn't configured.
function _mirrorAriToSupabase(ari) {
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return;
    const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
    const row = {
      guild_id:    guildId,
      character:   ari?.character   || null,
      password:    ari?.password    || null,
      set_by_id:   ari?.setBy       || null,
      set_by_name: ari?.setByName   || null,
      set_at:      ari?.setAt ? new Date(ari.setAt).toISOString() : null,
      updated_at:  new Date().toISOString(),
    };
    supabase.upsert('ari_state', [row], 'guild_id')
      .catch(err => console.warn('[ari] mirror failed:', err?.message));
  } catch { /* non-fatal */ }
}

// ── Live kill tracking (exact timers, no variance) ───────────────────────────────────────────
function recordLiveKill(bossId, bossName, timerHours, killedBy, timerUnknown = false, killedAt = null) {
  const s = loadState();
  killedAt = killedAt || Date.now();
  const nextSpawn = timerUnknown ? null : (killedAt + timerHours * 3600000);
  const entry = { bossId, name: bossName, killedAt, nextSpawn, timerHours, killedBy, channelMessageId: null };
  if (timerUnknown) entry.timerUnknown = true;
  s.liveKills[bossId] = entry;
  saveState(s);
}

function setLiveKillMessageId(bossId, messageId) {
  const s = loadState();
  if (s.liveKills[bossId]) { s.liveKills[bossId].channelMessageId = messageId; saveState(s); }
}

function clearLiveKill(bossId)  { const s = loadState(); delete s.liveKills[bossId]; saveState(s); }
function getAllLiveKills()       { return loadState().liveKills || {}; }

// ── Hate board message IDs ────────────────────────────────────────────────────────────────────────────
// type = 'live' | 'pvp'
function getHateBoardMessageId(type) {
  const envKey = type === 'live' ? 'LIVE_HATE_BOARD_ID' : 'PVP_HATE_BOARD_ID';
  return process.env[envKey] || loadState().hateBoards?.[type] || null;
}
function setHateBoardMessageId(type, id) {
  const envKey = type === 'live' ? 'LIVE_HATE_BOARD_ID' : 'PVP_HATE_BOARD_ID';
  if (process.env[envKey]) return;
  const s = loadState();
  s.hateBoards[type] = id;
  saveState(s);
}

// Message IDs for the hidden hate state data embeds (used for Discord persistence)
function getHateStateMessageId(type) {
  return loadState().hateBoards?.[`${type}StateMsg`] || null;
}
function setHateStateMessageId(type, id) {
  const s = loadState();
  if (!s.hateBoards) s.hateBoards = {};
  s.hateBoards[`${type}StateMsg`] = id;
  saveState(s);
}

// Bulk setters used when restoring hate state from Discord on startup
function setAllLiveKills(kills) { const s = loadState(); s.liveKills = kills; saveState(s); }
function setAllPvpKills(kills)  { const s = loadState(); s.pvpKills  = kills; saveState(s); }

// Mark a live kill entry as timer-unknown (from hate board "Unknown" button)
function setLiveKillTimerUnknown(key) {
  const s = loadState();
  if (!s.liveKills[key]) return;
  s.liveKills[key].timerUnknown = true;
  s.liveKills[key].nextSpawn = null;
  saveState(s);
}

// Mark a PVP kill entry as timer-unknown
function setPvpKillTimerUnknown(key) {
  const s = loadState();
  if (!s.pvpKills[key]) return;
  s.pvpKills[key].timerUnknown = true;
  s.pvpKills[key].nextSpawn = null;
  s.pvpKills[key].nextSpawnLatest = null;
  saveState(s);
}

// ── Quarmy links ────────────────────────────────────────────────────────────────────────────────
function getQuarmyLink(name) { return loadState().quarmyLinks?.[name.toLowerCase()] || null; }
function setQuarmyLink(name, url) {
  const s = loadState();
  s.quarmyLinks[name.toLowerCase()] = url;
  saveState(s);
}
function clearQuarmyLink(name) {
  const s = loadState();
  delete s.quarmyLinks[name.toLowerCase()];
  saveState(s);
}

// ── Parse leaderboard message ID ───────────────────────────────────────────────────────────────
function getParseLeaderboardMsgId()   { return process.env.PARSE_LEADERBOARD_MSG_ID || loadState().channelSlots?.parseLeaderboard || null; }
function setParseLeaderboardMsgId(id) { if (!process.env.PARSE_LEADERBOARD_MSG_ID) _setSlot('parseLeaderboard', id); }

// ── Audit trail entries ─────────────────────────────────────────────────────────────────────────
function getAuditEntries()    { return loadState().auditEntries || []; }
function getAuditEntry(id)    { return (loadState().auditEntries || []).find(e => e.id === id) || null; }

function addAuditEntry(entry) {
  const s = loadState();
  s.auditEntries = [...(s.auditEntries || []), entry].slice(-200);
  saveState(s);
}

function updateAuditEntryMsgId(id, auditMsgId) {
  const s = loadState();
  const e = (s.auditEntries || []).find(e => e.id === id);
  if (e) { e.auditMsgId = auditMsgId; saveState(s); }
}

function markAuditEntryUndone(id) {
  const s = loadState();
  const e = (s.auditEntries || []).find(e => e.id === id);
  if (e) { e.undone = true; saveState(s); }
}

function findLatestActiveAuditEntry(bossId, action) {
  const entries = loadState().auditEntries || [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].bossId === bossId && entries[i].action === action && !entries[i].undone) {
      return entries[i];
    }
  }
  return null;
}

// ── Agent test thread tracking ────────────────────────────────────────────────
// agentTestCards: { bossKey: { messageId, timestamp, perspectives, players, duration, totalDamage } }
// Tracks the most recent mob card in AUTOPARSE_TEST_THREAD_ID for edit-in-place dedup.
// agentSessionCardId: messageId of the all-night session leaderboard card (edited in place).
// Both are cleared at midnight (fresh thread/session each night).
function getAgentTestCard(bossKey)  { return loadState().agentTestCards?.[bossKey] || null; }
function getAllAgentTestCards()     { return loadState().agentTestCards || {}; }

// agentActivity tracks which characters have uploaded parses, when, and what.
// Used by /parseagents to show recent uploaders. Bounded to last 50 chars by
// timestamp — older entries get evicted on each new upload from a fresh char.
// Schema: { lowercaseName: { name, lastUpload, totalUploads, lastBoss, lastEventCount } }
// petOwners is the cross-encounter, cross-parser map of pet-name → [owner, …].
// Built from the agent's encounter.pet_leaders uploads (which come from
// "PetName says, 'My leader is OwnerName.'" lines in the EQ log). Once any
// parser captures the declaration, every subsequent upload from any agent
// benefits. Cleared at midnight — pet names are randomised at re-summon.
//
// Schema: { petNameLower: [ownerName, …] }
// Multiple owners arise when a charmed mob was owned by different enchanters in
// the same encounter (same pet name, different /pet leader lines).  Pet damage
// is divided equally across all known owners so each enchanter gets fair credit.
//
// Migration: old entries stored a bare string; the helpers below normalise on
// first read/write so the format converges to the array schema silently.
function _petNormalise(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val) return [val];
  return [];
}
function getPetOwners() { return loadState().petOwners || {}; }
function addPetOwners(petLeadersMap) {
  if (!petLeadersMap || Object.keys(petLeadersMap).length === 0) return;
  const s = loadState();
  if (!s.petOwners) s.petOwners = {};
  for (const [pet, owner] of Object.entries(petLeadersMap)) {
    if (!pet || !owner) continue;
    const key  = pet.toLowerCase();
    const list = _petNormalise(s.petOwners[key]);
    if (!list.includes(owner)) list.push(owner);
    s.petOwners[key] = list;
  }
  saveState(s);
}
function setPetOwner(pet, owner) {
  const s = loadState();
  if (!s.petOwners) s.petOwners = {};
  const key  = pet.toLowerCase();
  const list = _petNormalise(s.petOwners[key]);
  if (!list.includes(owner)) list.push(owner);
  s.petOwners[key] = list;
  saveState(s);
}
function clearPetOwners() { const s = loadState(); s.petOwners = {}; saveState(s); }

// whoData is a persistent map of every character we've seen in any /who output
// uploaded by an agent. Used by /whois, /markzek, and the /parsestats embed to
// label players with their class even when they aren't in the OpenDKP roster.
//
// Schema per entry:
//   { name, class, level, race, guild, anonymous, gm, is_zek, firstSeen, lastSeen }
//
// This map is NEVER cleared at midnight — we keep observed players forever.
// Manual cleanup must go through clearWhoData() (no UI for that yet by design).
function getWhoData()      { return loadState().whoData || {}; }
function getWhoEntry(name) {
  if (!name) return null;
  const e = loadState().whoData?.[String(name).toLowerCase()] || null;
  if (!e) return null;
  // Fold the stored class to its base — older rows captured the raw level title
  // (e.g. "Savage Lord", "Overlord"). Return a copy so we don't mutate the
  // cached state object; callers are read-only.
  return e.class ? { ...e, class: normalizeClass(e.class) } : e;
}

// In-memory mirror of who_overrides (officer-curated class + Zek edited on the
// web /admin/who page). Overrides WIN over fresh /who observations so a curated
// class/Zek isn't clobbered by the next anon sighting. Populated at startup +
// on a periodic refresh from Supabase (see index.js) and kept in sync locally
// when /markzek flips a flag.
const _whoOverrides = new Map();   // lower(name) → { name, class|null, is_zek|null }

// Replace the override cache from a batch of who_overrides rows and stamp them
// onto state.whoData so /whois reflects them immediately (creating a minimal
// entry for an overridden character we've never seen in a /who). Returns the
// count applied.
function applyWhoOverrides(rows) {
  if (!Array.isArray(rows)) return 0;
  _whoOverrides.clear();
  for (const r of rows) {
    if (!r || !r.character) continue;
    _whoOverrides.set(String(r.character).toLowerCase(), {
      name:   r.character,
      class:  (r.class != null && r.class !== '') ? r.class : null,
      is_zek: (r.is_zek === true || r.is_zek === false) ? r.is_zek : null,
    });
  }
  const s = loadState();
  if (!s.whoData) s.whoData = {};
  const now = new Date().toISOString();
  for (const [k, ov] of _whoOverrides) {
    const e = s.whoData[k] || { name: ov.name, firstSeen: now, lastSeen: now };
    if (ov.class  != null) e.class  = ov.class;
    if (ov.is_zek != null) e.is_zek = ov.is_zek;
    if (!e.name) e.name = ov.name;
    s.whoData[k] = e;
  }
  saveState(s);
  return _whoOverrides.size;
}
function mergeWhoData(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const s = loadState();
  if (!s.whoData) s.whoData = {};
  const now = new Date().toISOString();
  for (const r of rows) {
    if (!r || !r.name) continue;
    // Threat-focused capture: L50+ only. The /who registry is for PVP target
    // selection — low-level chars (bank alts, leveling toons, trade chars in EC/
    // WC) are noise. Anonymous rows (level = null) are explicitly KEPT — could
    // be a hidden L60 raider; a future de-anon may fill in their real class.
    if (r.level !== null && r.level !== undefined && r.level < 50) continue;
    const k   = r.name.toLowerCase();
    const old = s.whoData[k] || {};
    // Sticky is_zek: once a character is flagged, they stay flagged unless
    // an officer explicitly clears it via /markzek. Also auto-flag anyone
    // whose observed guild contains "Zek" anywhere — catches "Zek",
    // "Rise of Zek", "Pulse of Zek", etc., not just the bare guild name.
    const autoZek = (r.guild && /^(zek|rise of zek)$/i.test(r.guild)) ? true : false;
    s.whoData[k] = {
      name:       r.name,
      // Fold level titles ("Savage Lord" → "Beastlord") to the base class so
      // storage is canonical regardless of source (agent /who, /whoimport).
      class:      (r.class && r.class !== 'ANONYMOUS') ? normalizeClass(r.class) : (old.class || null),
      level:      r.level ?? old.level ?? null,
      race:       r.race  ?? old.race  ?? null,
      guild:      r.guild ?? old.guild ?? null,
      anonymous:  !!r.anonymous,
      gm:         !!r.gm || !!old.gm,
      // Zone only comes from /who all — preserve last known when absent.
      zone:       r.zone ?? old.zone ?? null,
      is_zek:     old.is_zek || autoZek,
      // Guild rank (Member / Officer / Leader) from /guildstatus — survives
      // /anon and persists once seen (a later plain /who row carries no rank).
      // Lets /whois surface guild leaders ("X is the leader of <Guild>").
      guildRank:  r.guildRank ?? old.guildRank ?? null,
      firstSeen:  old.firstSeen || r.observedAt || now,
      lastSeen:   r.observedAt || now,
    };
    // Officer-curated override wins over the fresh observation so a manually
    // set class / Zek flag (web /admin/who or /markzek) survives the next /who.
    const ov = _whoOverrides.get(k);
    if (ov) {
      if (ov.class  != null) s.whoData[k].class  = ov.class;
      if (ov.is_zek != null) s.whoData[k].is_zek = ov.is_zek;
    }
  }
  saveState(s);
}
function setZekFlag(name, isZek) {
  const s = loadState();
  if (!s.whoData) s.whoData = {};
  const k = String(name).toLowerCase();
  if (!s.whoData[k]) s.whoData[k] = { name, firstSeen: new Date().toISOString() };
  s.whoData[k].is_zek = !!isZek;
  s.whoData[k].lastSeen = s.whoData[k].lastSeen || new Date().toISOString();
  // Keep the in-memory override cache in lockstep so a subsequent /who merge
  // doesn't immediately revert the flag before the next Supabase refresh.
  const cur = _whoOverrides.get(k) || { name: s.whoData[k].name || name };
  cur.is_zek = !!isZek;
  _whoOverrides.set(k, cur);
  saveState(s);
  return s.whoData[k];
}

// Apply a batch of community-tipped Zek affiliations. Conservative merge:
//   - If the existing whoData entry has a non-Zek guild, we trust the
//     observed data and skip this tip entirely (avoids mis-flagging
//     friendlies someone confused with a Zek character of similar name).
//   - Otherwise stamp guild='Zek', is_zek=true, and backfill class/race
//     when the tip carries them and we don't already know.
//
// Idempotent — re-running produces the same end state, since we never
// overwrite a non-Zek guild and the Zek flag is a set-true operation.
// Returns { applied, skipped, examples } so the caller can log a summary.
function applyKnownZekTips(tips) {
  if (!Array.isArray(tips) || tips.length === 0) {
    return { applied: 0, skipped: 0, examples: [] };
  }
  const s = loadState();
  if (!s.whoData) s.whoData = {};
  const now = new Date().toISOString();
  let applied = 0, skipped = 0;
  const examples = { applied: [], skipped: [] };
  for (const t of tips) {
    if (!t?.name) continue;
    const k = String(t.name).toLowerCase();
    const old = s.whoData[k] || {};
    // Preserve a prior observation only when the existing guild is clearly
    // NOT Zek-aligned. Treat any guild containing "Zek" (Rise of Zek,
    // Pulse of Zek, etc.) as Zek and let the tip overwrite.
    if (old.guild && !/^(zek|rise of zek)$/i.test(old.guild)) {
      skipped++;
      if (examples.skipped.length < 5) examples.skipped.push(`${t.name} (already <${old.guild}>)`);
      continue;
    }
    s.whoData[k] = {
      name:       old.name      || t.name,
      class:      old.class     || t.class || null,
      level:      old.level     || null,
      race:       old.race      || t.race  || null,
      guild:      'Zek',
      anonymous:  !!old.anonymous,
      gm:         !!old.gm,
      is_zek:     true,
      firstSeen:  old.firstSeen || now,
      lastSeen:   old.lastSeen  || now,
    };
    applied++;
    if (examples.applied.length < 5) examples.applied.push(t.name);
  }
  saveState(s);
  return { applied, skipped, examples };
}
function setGuildOverride(name, guild) {
  const s = loadState();
  if (!s.whoData) s.whoData = {};
  const k = String(name).toLowerCase();
  if (!s.whoData[k]) s.whoData[k] = { name, firstSeen: new Date().toISOString() };
  s.whoData[k].guild = guild || null;
  if (guild && /^zek$/i.test(guild)) s.whoData[k].is_zek = true;
  saveState(s);
  return s.whoData[k];
}
function clearWhoData() { const s = loadState(); s.whoData = {}; saveState(s); }

// pendingLoot: in-progress /loot batches waiting for officer confirmation.
// Keyed by the Discord message ID of the loot announcement embed.
// Cleared on Post / Cancel button press, and bulk-cleared at midnight to
// reap orphans where the officer abandoned without clicking either button.
//
// Entry shape:
//   { messageId, channelId, officerId, items: [...enrichedLootItem],
//     bossName, bidMinutes, createdAt }
function getPendingLoot(messageId)  { return loadState().pendingLoot?.[messageId] || null; }
function getAllPendingLoot()         { return loadState().pendingLoot || {}; }
function setPendingLoot(messageId, data) {
  const s = loadState();
  if (!s.pendingLoot) s.pendingLoot = {};
  s.pendingLoot[messageId] = data;
  saveState(s);
}
function removePendingLootItem(messageId, gameItemId) {
  const s = loadState();
  const entry = s.pendingLoot?.[messageId];
  if (!entry) return null;
  entry.items = entry.items.filter(i => String(i.gameItemId) !== String(gameItemId));
  saveState(s);
  return entry;
}
function clearPendingLoot(messageId) {
  const s = loadState();
  if (s.pendingLoot) { delete s.pendingLoot[messageId]; saveState(s); }
}
function clearAllPendingLoot() {
  const s = loadState();
  s.pendingLoot = {};
  saveState(s);
}

function recordAgentUpload(character, bossName, eventCount) {
  if (!character) return;
  const s = loadState();
  if (!s.agentActivity) s.agentActivity = {};
  const k = character.toLowerCase();
  const prev = s.agentActivity[k] || { name: character, totalUploads: 0 };
  s.agentActivity[k] = {
    name:           character,
    lastUpload:     Date.now(),
    totalUploads:   (prev.totalUploads || 0) + 1,
    lastBoss:       bossName || prev.lastBoss || null,
    lastEventCount: eventCount,
  };
  // Cap at 50 entries — drop the oldest by lastUpload
  const entries = Object.entries(s.agentActivity);
  if (entries.length > 50) {
    const sorted = entries.sort((a, b) => (b[1].lastUpload || 0) - (a[1].lastUpload || 0));
    s.agentActivity = Object.fromEntries(sorted.slice(0, 50));
  }
  saveState(s);
}
function getAgentActivity() { return loadState().agentActivity || {}; }
function clearAgentActivity() { const s = loadState(); s.agentActivity = {}; saveState(s); }
function setAgentTestCard(bossKey, data) {
  const s = loadState();
  if (!s.agentTestCards) s.agentTestCards = {};
  s.agentTestCards[bossKey] = data;
  saveState(s);
}
function clearAgentTestCards() {
  const s = loadState();
  s.agentTestCards = {};
  saveState(s);
}
function getAgentSessionCardId()   { return loadState().agentSessionCardId || null; }
function setAgentSessionCardId(id) { const s = loadState(); s.agentSessionCardId = id; saveState(s); }
function clearAgentSessionCardId() { const s = loadState(); s.agentSessionCardId = null; s.agentSessionCardChannelId = null; saveState(s); }

// Last agent version we posted a release announcement for. Used by the
// startup-time release-announcement check to fire at most once per
// (bot, agent) version pair. Cleared by no one in normal operation; an
// officer would only edit it manually to re-announce a version.
function getLastAnnouncedAgentVersion()        { return loadState().lastAnnouncedAgentVersion || null; }
function setLastAnnouncedAgentVersion(version) { const s = loadState(); s.lastAnnouncedAgentVersion = version; saveState(s); }

// Channel the session card lives in. Tracked separately from the message ID
// because the target channel can change between posts (e.g., raidnight thread
// vs RAID_CHAT_CHANNEL_ID vs AUTOPARSE_TEST_THREAD_ID). When the target
// changes between two upload events, the prior message ID is stale — try to
// edit it would 404 against the wrong channel.
function getAgentSessionCardChannelId()        { return loadState().agentSessionCardChannelId || null; }
function setAgentSessionCardChannelId(channelId) { const s = loadState(); s.agentSessionCardChannelId = channelId; saveState(s); }

// Legacy compat
function getBoardMessages()  { return []; }
function saveBoardMessages() {}

module.exports = {
  recordKill, overrideTimer, clearKill, getBossState, getAllState, restoreBossState,
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
  getHateStateMessageId, setHateStateMessageId,
  setAllLiveKills, setAllPvpKills,
  setLiveKillTimerUnknown, setPvpKillTimerUnknown,
  getQuake, saveQuake, clearQuake,
  getServerQuake, saveServerQuake,
  getPvpAlertHowlers, addPvpAlertHowler, clearPvpAlert,
  getPvpNight, getActivePvpNightUserIds, addPvpNightTonight, addPvpNightPermanent,
  removePvpNight, getPvpNightBoardMsg, setPvpNightBoardMsg,
  getRaidSession, saveRaidSession, clearRaidSession, accumulateSessionDamage, clearSessionDamage,
  getRaidSessionTargets, addRaidSessionTarget, removeRaidSessionTarget,
  getRaidNight, saveRaidNight, clearRaidNight,
  getAri, setAri, clearAri,
  getQuarmyLink, setQuarmyLink, clearQuarmyLink,
getParseLeaderboardMsgId, setParseLeaderboardMsgId,
  getAuditEntries, getAuditEntry, addAuditEntry, updateAuditEntryMsgId, markAuditEntryUndone, findLatestActiveAuditEntry,
  getAgentTestCard, getAllAgentTestCards, setAgentTestCard, clearAgentTestCards,
  getAgentSessionCardId, setAgentSessionCardId, clearAgentSessionCardId,
  getAgentSessionCardChannelId, setAgentSessionCardChannelId,
  getLastAnnouncedAgentVersion, setLastAnnouncedAgentVersion,
  recordAgentUpload, getAgentActivity, clearAgentActivity,
  getPetOwners, addPetOwners, setPetOwner, clearPetOwners,
  getWhoData, getWhoEntry, mergeWhoData, setZekFlag, setGuildOverride, clearWhoData,
  applyKnownZekTips, applyWhoOverrides,
  getPendingLoot, getAllPendingLoot, setPendingLoot, removePendingLootItem,
  clearPendingLoot, clearAllPendingLoot,
};
