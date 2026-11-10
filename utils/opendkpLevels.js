// utils/opendkpLevels.js — plan OpenDKP level updates from levels seen in /who.
//
// Pure: no I/O. The command (commands/opendkplevels.js) fetches the roster and the
// /who levels, calls planLevelUpdates(), previews, and on Apply writes each
// `raise` entry back with buildUpdateRecord(). Only Level is ever changed.
// Levels only go UP automatically (EverQuest characters do not lose levels); a
// lower /who level is reported for an officer to look at, never written.

const WINDOW_DAYS = 180;
const MIN_LEVEL = 1;
const MAX_LEVEL = 65;

function _isDeleted(row) { return row.Deleted === 1 || row.Deleted === true; }

// OpenDKP saves the WHOLE record an update sends (captured from its UI, 2026-11-10), so a row missing any of these keys
// would blank that field (rank, the linked account, ...). Such a row is never planned or written: it is counted as
// skipped.incomplete and left for an officer to fix by hand.
const RECORD_KEYS = ['ClientId', 'CharacterId', 'AssociatedId', 'Active', 'Name', 'Rank', 'Class', 'Level', 'Race',
  'Gender', 'Guild', 'MainChange', 'Deleted', 'User', 'CreatedDate'];
function isCompleteRecord(row) {
  return !!row && typeof row === 'object' && RECORD_KEYS.every(k => Object.prototype.hasOwnProperty.call(row, k));
}

// roster: OpenDKP character rows. seen: Map/obj keyed by lowercase name ->
// { level, seenAt (ISO or ms) }. nowMs injectable for tests.
function planLevelUpdates(roster, seen, nowMs = Date.now()) {
  const get = (name) => (seen instanceof Map ? seen.get(name) : seen?.[name]);
  const cutoff = nowMs - WINDOW_DAYS * 86400000;
  const out = { raise: [], lower: [], same: 0, unseen: 0, skipped: { deleted: 0, badLevel: 0, stale: 0, noId: 0, incomplete: 0 } };
  for (const row of Array.isArray(roster) ? roster : []) {
    if (!row || typeof row.Name !== 'string') continue;
    if (_isDeleted(row)) { out.skipped.deleted++; continue; }
    if (!isCompleteRecord(row)) { out.skipped.incomplete++; continue; }
    if (!Number.isFinite(row.CharacterId)) { out.skipped.noId++; continue; }
    const obs = get(row.Name.toLowerCase());
    if (!obs || obs.level == null) { out.unseen++; continue; }
    const seenMs = typeof obs.seenAt === 'number' ? obs.seenAt : Date.parse(obs.seenAt);
    if (!Number.isFinite(seenMs) || seenMs < cutoff) { out.skipped.stale++; continue; }
    const to = Number(obs.level);
    if (!Number.isInteger(to) || to < MIN_LEVEL || to > MAX_LEVEL) { out.skipped.badLevel++; continue; }
    const from = Number(row.Level);
    const entry = { characterId: row.CharacterId, name: row.Name, from, to, seenAt: new Date(seenMs).toISOString() };
    if (!Number.isFinite(from)) { out.skipped.badLevel++; continue; }
    if (to > from) out.raise.push(entry);
    else if (to < from) out.lower.push(entry);
    else out.same++;
  }
  const byGap = (a, b) => (b.to - b.from) - (a.to - a.from) || a.name.localeCompare(b.name);
  out.raise.sort(byGap);
  out.lower.sort(byGap);
  return out;
}

// The whole roster row with ONLY Level replaced (every other key preserved as-is).
function buildUpdateRecord(row, level) {
  if (!isCompleteRecord(row)) throw new Error('OpenDKP character record is incomplete; refusing to send a partial record');
  return { ...row, Level: level };
}

// "3 days ago" for preview lines.
function agoText(iso, nowMs = Date.now()) {
  const d = Math.floor((nowMs - Date.parse(iso)) / 86400000);
  if (!(d >= 1)) return 'today';
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

module.exports = { planLevelUpdates, buildUpdateRecord, isCompleteRecord, RECORD_KEYS, agoText, WINDOW_DAYS };
