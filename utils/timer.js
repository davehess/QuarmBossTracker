// utils/timer.js
// Helpers for spawn time calculation and formatting

/**
 * Calculate next spawn timestamp from kill time and timer in hours
 * @param {number} killedAt - Unix timestamp (ms) of kill
 * @param {number} timerHours - Spawn timer in fractional hours
 * @returns {number} Unix timestamp (ms) of next spawn
 */
function calcNextSpawn(killedAt, timerHours) {
  return killedAt + timerHours * 60 * 60 * 1000;
}

/**
 * Format a duration in ms into a human-readable string
 * e.g. "6d 12h 30m" or "45m" or "SPAWNED"
 */
function formatDuration(ms) {
  if (ms <= 0) return '**SPAWNED**';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

/**
 * Format a Date into a readable timestamp string
 */
function formatTimestamp(date) {
  const { getDefaultTz } = require('./timezone');
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: getDefaultTz(),
  });
}

/**
 * Return a Discord relative timestamp string <t:unix:R>
 */
function discordRelativeTime(ms) {
  const unixSeconds = Math.floor(ms / 1000);
  return `<t:${unixSeconds}:R>`;
}

/**
 * Return a Discord absolute timestamp <t:unix:f>
 */
function discordAbsoluteTime(ms) {
  const unixSeconds = Math.floor(ms / 1000);
  return `<t:${unixSeconds}:f>`;
}

/**
 * Status emoji based on time remaining
 */
function statusEmoji(nextSpawnMs) {
  const remaining = nextSpawnMs - Date.now();
  if (remaining <= 0) return '🔴'; // spawned / available
  if (remaining < 2 * 60 * 60 * 1000) return '🟡'; // less than 2h
  return '🟢'; // still on cooldown
}

/**
 * Parse a human-readable time string → milliseconds.
 * Handles:
 *   Short:  "3d4h30m20s", "2h30m", "45m", "1d"
 *   Long:   "3 days, 4 hours, 30 minutes, and 20 seconds"
 *   PQDI:   "Expires in 1 Day, 4 Hours, 55 Minutes, and 38 Seconds"
 *   EQ SLL: "2 Days, 14 Hours, 22 Minutes, 5 Seconds Remaining"
 *           "2 Days 14 Hours 22 Minutes"
 * Returns ms or null if unparseable.
 */
function parseTimeString(str) {
  if (!str) return null;
  const s = str.trim()
    .replace(/expires in\s*/i, '')
    .replace(/remaining/i, '')
    .replace(/\band\b/gi, '')
    .trim();

  // Short compact: 3d4h30m20s
  const shortMatch = s.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (shortMatch && (shortMatch[1] || shortMatch[2] || shortMatch[3] || shortMatch[4])) {
    const d = parseInt(shortMatch[1] || 0);
    const h = parseInt(shortMatch[2] || 0);
    const m = parseInt(shortMatch[3] || 0);
    const sec = parseInt(shortMatch[4] || 0);
    const ms = ((d * 24 + h) * 60 + m) * 60000 + sec * 1000;
    return ms > 0 ? ms : null;
  }

  // Long / PQDI / EQ SLL format: "X Days, Y Hours, Z Minutes, W Seconds"
  let ms = 0;
  const dayM  = s.match(/(\d+)\s*days?/i);
  const hourM = s.match(/(\d+)\s*hours?/i);
  const minM  = s.match(/(\d+)\s*min(?:utes?)?/i);
  const secM  = s.match(/(\d+)\s*sec(?:onds?)?/i);
  if (dayM)  ms += parseInt(dayM[1])  * 86400000;
  if (hourM) ms += parseInt(hourM[1]) * 3600000;
  if (minM)  ms += parseInt(minM[1])  * 60000;
  if (secM)  ms += parseInt(secM[1])  * 1000;
  return ms > 0 ? ms : null;
}

module.exports = {
  calcNextSpawn,
  formatDuration,
  formatTimestamp,
  discordRelativeTime,
  discordAbsoluteTime,
  statusEmoji,
  parseTimeString,
};
