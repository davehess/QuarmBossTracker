// utils/config.js — Centralised expansion → thread ID mapping

const EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP'];

// PoP bosses are locked until this date (hard-coded per product decision).
const POP_UNLOCK_MS = new Date('2026-10-01T00:00:00').getTime();

/** Returns true if the boss is a PoP boss and PoP has not yet unlocked.
 *  Null-safe (#139): a missing/invalid boss is simply "not a PoP boss" rather
 *  than a thrown `Cannot read properties of undefined (reading 'expansion')`.
 *  For a GLOBAL "are we in the pre-PoP era" question with no boss in hand, use
 *  isPopEraLocked() — do NOT call isPopLocked() with no argument. */
function isPopLocked(boss) {
  return !!(boss && boss.expansion === 'PoP') && Date.now() < POP_UNLOCK_MS;
}

/** True while the PoP era is locked platform-wide (before POP_UNLOCK_MS),
 *  independent of any specific boss. Use for global era decisions — e.g. the
 *  spell-catalog's level cap. Calling isPopLocked() with no boss for this used
 *  to throw and 500 the whole spell-catalog endpoint (#139). */
function isPopEraLocked() {
  return Date.now() < POP_UNLOCK_MS;
}

const EXPANSION_META = {
  Classic: { label: '⚔️ Classic EverQuest',   color: 0xaa6622, envKey: 'CLASSIC_THREAD_ID' },
  Kunark:  { label: '🦎 Ruins of Kunark',      color: 0x228822, envKey: 'KUNARK_THREAD_ID'  },
  Velious: { label: '❄️ Scars of Velious',     color: 0x2255aa, envKey: 'VELIOUS_THREAD_ID' },
  Luclin:  { label: '🌙 Shadows of Luclin',    color: 0x882299, envKey: 'LUCLIN_THREAD_ID'  },
  PoP:     { label: '🔥 Planes of Power',      color: 0x8b0000, envKey: 'POP_THREAD_ID'     },
};

/** Return the Discord thread ID for an expansion, or null if not configured. */
function getThreadId(expansion) {
  const meta = EXPANSION_META[expansion];
  return meta ? (process.env[meta.envKey] || null) : null;
}

/** Return all configured thread IDs as a map: { expansion → threadId } */
function getAllThreadIds() {
  const map = {};
  for (const exp of EXPANSION_ORDER) {
    const id = getThreadId(exp);
    if (id) map[exp] = id;
  }
  return map;
}

/** Return which expansion a boss belongs to */
function getBossExpansion(boss) {
  return boss.expansion || 'Luclin';
}

module.exports = { EXPANSION_ORDER, EXPANSION_META, getThreadId, getAllThreadIds, getBossExpansion, isPopLocked, isPopEraLocked, POP_UNLOCK_MS };
