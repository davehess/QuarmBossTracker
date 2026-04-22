// utils/config.js — Centralised expansion → thread ID mapping

const EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP'];

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

module.exports = { EXPANSION_ORDER, EXPANSION_META, getThreadId, getAllThreadIds, getBossExpansion };
