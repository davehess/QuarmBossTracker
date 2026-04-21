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
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'America/New_York',
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

module.exports = {
  calcNextSpawn,
  formatDuration,
  formatTimestamp,
  discordRelativeTime,
  discordAbsoluteTime,
  statusEmoji,
};
