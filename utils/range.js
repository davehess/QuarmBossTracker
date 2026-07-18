// utils/range.js — position-based buff-range awareness (advisory, #117).
//
// The Zeal pipe surfaces each client's Position (loc {x,y,z} + heading);
// character_live_state persists loc_x/loc_y/loc_z from the live-state upload.
// This helper answers ONE question for the raid-buff-queue: is a same-zone
// target likely too far from the buffer to reach right now?
//
// Everything here is ADVISORY and FAILS OPEN:
//   • positions are stale by up to the live-state heartbeat cadence, so a
//     verdict is "likely", never authoritative;
//   • an unknown position on EITHER side returns "in range" so we never hide
//     or demote a real target on missing data.
// Spell range varies wildly (group buffs ~100, single-target ~200, some
// clarity/aego lines further), so v1 uses a single heuristic threshold and the
// overlay wording ("likely out of range") owns the imprecision.

// Beyond this many EQ world units from the buffer, a SAME-ZONE target is
// flagged "likely out of range". 200 is a deliberate mid-range heuristic —
// tune here if the raid finds it too tight/loose.
const BUFF_RANGE_UNITS = 200;

function _num(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

// 3D distance between two { x, y, z } points, or null when either point can't
// supply at least X and Y. Z is optional (older rows / partial pipe payloads
// may omit it) — when absent on either side it's treated as coplanar.
function distance(a, b) {
  if (!a || !b) return null;
  const ax = _num(a.x), ay = _num(a.y), az = _num(a.z);
  const bx = _num(b.x), by = _num(b.y), bz = _num(b.z);
  if (ax == null || ay == null || bx == null || by == null) return null;
  const dz = (az != null && bz != null) ? az - bz : 0;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + dz ** 2);
}

// Advisory "likely out of range" verdict. Returns false (assume reachable)
// whenever distance can't be computed — the fail-open contract above. The
// caller is responsible for only asking this about SAME-ZONE pairs (cross-zone
// is unreachable but is already handled by the queue's same_zone signal).
function isLikelyOutOfRange(bufferLoc, targetLoc, units = BUFF_RANGE_UNITS) {
  const d = distance(bufferLoc, targetLoc);
  if (d == null) return false;
  return d > units;
}

module.exports = { BUFF_RANGE_UNITS, distance, isLikelyOutOfRange };
