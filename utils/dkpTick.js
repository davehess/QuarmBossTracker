// utils/dkpTick.js — shared DKP-tick submission used by BOTH the Discord
// /tick command (attachment path) and the Mimic dashboard officer panel
// (live-roster / detected-file path). Extracted 2026-07-16 (Hitya) so the two
// surfaces submit identical payloads to OpenDKP. The Discord command's own
// slot-ordering + 1-hour-overwrite rules live here so they hold everywhere.
//
// A dry-run mode resolves the target raid + computes what WOULD be submitted
// without writing — the dashboard shows that as a preview so a real DKP write
// is always a deliberate second click.

const {
  getRaids, getRaid, createRaid, updateRaid, updateRaidById, getMostRecentRaid, getCharacters,
} = require('./opendkp');

// Resolve player names → OpenDKP CharacterIds via the roster (bearer path —
// the same auth our reads already use; no OPENDKP_CLIENT_ID / OPENDKP_RAIDS_URL
// needed, which is why the modern /clients write path works where the legacy
// /beta/raids path is dead). Walks pages defensively (guild rosters exceed one
// page). Returns { idByName: Map, matched:[{name,id}], unmatched:[name] }.
async function _resolveCharacterIds(names) {
  const idByName = new Map();
  for (let page = 1; page <= 12; page++) {
    let resp;
    try { resp = await getCharacters({ page }); } catch { break; }
    const chars = Array.isArray(resp) ? resp : (Array.isArray(resp?.Characters) ? resp.Characters : []);
    if (chars.length === 0) break;
    for (const c of chars) {
      const nm = c && (c.Name || c.name);
      const id = c && (c.CharacterId ?? c.characterId ?? c.Id ?? c.id);
      if (nm && id != null) idByName.set(String(nm).toLowerCase(), id);
    }
    if (chars.length < 50) break;   // last page (page size ~50)
  }
  const matched = [], unmatched = [];
  for (const n of names) {
    const id = idByName.get(String(n).toLowerCase());
    if (id != null) matched.push({ name: n, id });
    else unmatched.push(n);
  }
  return { idByName, matched, unmatched };
}
const { getRaidNight, saveRaidNight } = require('./state');
const { getDefaultTz } = require('./timezone');

const MAX_REGULAR_TICKS = 4;
const OVERWRITE_MS      = 60 * 60 * 1000;   // 1 hour
const SKIP_KEYWORDS     = ['bonus', 'overtime', 'over time', 'first time kill', 'first kill', 'ftk'];

function isSpecialRaid(name) {
  return SKIP_KEYWORDS.some(k => String(name || '').toLowerCase().includes(k));
}
function todayStr(tz)              { return new Date().toLocaleDateString('en-CA', { timeZone: tz }); }
function raidDateStr(ts, tz)       { return new Date(ts).toLocaleDateString('en-CA', { timeZone: tz }); }

// Sun/Wed/Thu are raid nights — the dashboard only auto-CREATES a raid on
// those days (Hitya 2026-07-16). Any other day, a missing raid is an error the
// officer must resolve on OpenDKP rather than have the tool invent one.
function isRaidDay(tz) {
  const dow = new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' }).toLowerCase();
  return dow === 'sunday' || dow === 'wednesday' || dow === 'thursday';
}

// Carry existing ticks forward; append or overwrite one slot.
function buildTicksPayload(existingTicks, description, value, players, overwriteTickId) {
  const result = (existingTicks || []).map(t => ({
    TickId: t.TickId, Description: t.Description, Value: t.Value, Attendees: t.Attendees || [],
  }));
  if (overwriteTickId != null) {
    const idx = result.findIndex(t => t.TickId === overwriteTickId);
    if (idx !== -1) result[idx] = { TickId: overwriteTickId, Description: description, Value: value, Attendees: players };
    else            result.push({ TickId: null, Description: description, Value: value, Attendees: players });
  } else {
    result.push({ TickId: null, Description: description, Value: value, Attendees: players });
  }
  return result;
}

const SLOT_LABEL = { '1': 'Tick 1', '2': 'Tick 2', '3': 'Tick 3', '4': 'Tick 4', bonus: 'Bonus Tick', ot: 'Overtime' };

// Core. opts: { slot:'1'..'4'|'bonus'|'ot', players:[names], points, description?,
// raidName?, updatedBy, dryRun }. Returns a structured result — NEVER throws for
// business-rule rejections (returns { ok:false, reason }); only network/OpenDKP
// failures reject.
async function submitRaidTick(opts) {
  const slot      = String(opts.slot);
  const players   = Array.isArray(opts.players) ? opts.players.map(s => String(s || '').trim()).filter(Boolean) : [];
  const points    = Number.isFinite(opts.points) ? opts.points : 1;
  const dryRun    = !!opts.dryRun;
  const updatedBy = String(opts.updatedBy || 'Mimic officer');
  const tz        = getDefaultTz();
  const today     = todayStr(tz);
  const poolId    = parseInt(process.env.OPENDKP_POOL_ID || '5', 10);
  const isSpecial = slot === 'bonus' || slot === 'ot';
  const slotNum   = isSpecial ? slot : parseInt(slot, 10);
  const description = opts.description || SLOT_LABEL[slot] || `Tick ${slot}`;
  const isoTimestamp = new Date().toISOString().slice(0, 19);

  if (players.length === 0) return { ok: false, reason: 'No attendees to submit.' };
  if (!isSpecial && !(slotNum >= 1 && slotNum <= 4)) return { ok: false, reason: `Unknown slot "${slot}".` };

  // ── Bonus / Overtime — always a separate raid entry ──────────────────────
  if (isSpecial) {
    const name = opts.raidName || `${today} — ${description}`;
    if (dryRun) return { ok: true, dryRun: true, action: 'create-separate', raidName: name, slot, description, count: players.length, points };
    const result = await createRaid({
      Name: name, Timestamp: isoTimestamp, UpdatedBy: updatedBy,
      Pool: { IdPool: poolId },
      Ticks: [{ TickId: null, Description: description, Value: points, Attendees: players }],
      Items: [],
    });
    return { ok: true, action: 'created-separate', raidId: result.RaidId, raidName: name, slot, description, count: players.length, points };
  }

  // ── Regular tick 1–4 ─────────────────────────────────────────────────────
  let night = getRaidNight();
  if (night?.date !== today) night = null;

  if (night) {
    const highest = Math.max(0, ...Object.keys(night.ticks).map(Number));
    if (slotNum > highest + 1) return { ok: false, reason: `Slot ${slotNum} is out of order — Tick ${highest + 1} hasn't been posted yet tonight.` };
  } else if (slotNum > 1) {
    return { ok: false, reason: 'No ticks posted yet tonight — start with Tick 1.' };
  }

  let overwriteTickId = null;
  if (night?.ticks?.[slotNum]) {
    const prev = night.ticks[slotNum];
    if (Date.now() - prev.postedAt < OVERWRITE_MS) overwriteTickId = prev.tickId;
    else return { ok: false, reason: `Tick ${slotNum} was posted over an hour ago — edit it on OpenDKP directly.` };
  }
  const currentSlots = night ? Object.keys(night.ticks).length : 0;
  if (!overwriteTickId && currentSlots >= MAX_REGULAR_TICKS) {
    return { ok: false, reason: `All ${MAX_REGULAR_TICKS} regular tick slots are full — use Overtime for an extra tick.` };
  }

  // ── Resolve today's raid ────────────────────────────────────────────────
  let raidId = night?.raidId || null;
  let raidName = night?.name || null;
  if (!raidId) {
    const allRaids = await getRaids();
    const todayRaid = (Array.isArray(allRaids) ? allRaids : [])
      .filter(r => raidDateStr(r.Timestamp, tz) === today && !isSpecialRaid(r.Name))
      .sort((a, b) => b.RaidId - a.RaidId)[0];
    if (todayRaid) { raidId = todayRaid.RaidId; raidName = todayRaid.Name; }
  }

  // No raid tonight: only the dashboard's auto-create is gated on raid day.
  const willCreate = !raidId;
  if (willCreate && !isRaidDay(tz)) {
    return { ok: false, reason: `No raid exists for today and it isn't a raid night (Sun/Wed/Thu) — create the raid on OpenDKP first.` };
  }

  // Auto-create today's raid isn't supported on the bearer path (no
  // create-by-id endpoint) — since the guild creates the raid on OpenDKP
  // first, this only matters for the Sun/Wed/Thu auto-create, which we
  // surface as an actionable message rather than falling back to the dead
  // legacy path.
  if (willCreate) {
    return { ok: false, reason: `No raid exists for today on OpenDKP — create it there first (the dashboard can't create raids yet), then submit the tick.` };
  }

  // Resolve attendees → OpenDKP CharacterIds (needed by the /clients write).
  const { matched, unmatched } = await _resolveCharacterIds(players);

  if (dryRun) {
    return {
      ok: true, dryRun: true,
      action: overwriteTickId ? 'would-overwrite' : 'would-append',
      raidId, raidName: raidName || `${today} Raid`,
      slot, description, count: players.length,
      matched_count: matched.length, unmatched,
      points,
    };
  }
  if (matched.length === 0) {
    return { ok: false, reason: `None of the ${players.length} attendees matched an OpenDKP character — nothing submitted.` };
  }

  // ── Bearer write (modern /clients/{name}/raids/{id}) ─────────────────────
  // Fetch the FULL raid and append (or overwrite) exactly ONE tick, preserving
  // every existing tick + item verbatim — so a shape surprise can't corrupt
  // prior attendance. Attendees go in as Characters:[id] (the /clients shape).
  const full = await getRaid(raidId);
  const characterIds = matched.map(m => m.id);
  const ticks = Array.isArray(full.Ticks) ? full.Ticks.slice() : [];
  if (overwriteTickId != null) {
    const idx = ticks.findIndex(t => t.TickId === overwriteTickId);
    const t = { TickId: overwriteTickId, Value: points, Description: description, Characters: characterIds };
    if (idx !== -1) ticks[idx] = { ...ticks[idx], ...t };
    else ticks.push({ TickId: null, Value: points, Description: description, Characters: characterIds });
  } else {
    ticks.push({ TickId: null, Value: points, Description: description, Characters: characterIds });
  }
  const raidObject = { ...full, Ticks: ticks, UpdatedBy: updatedBy };
  const result = await updateRaidById(raidId, raidObject);

  // Resolve the new tickId + persist raid-night state (mirrors /tick).
  const prevTickIds = new Set(Object.values(night?.ticks || {}).map(t => t.tickId).filter(Boolean));
  const newTick = ((result && result.Ticks) || []).find(t => !prevTickIds.has(t.TickId) && !(Array.isArray(full.Ticks) && full.Ticks.some(o => o.TickId === t.TickId)));
  const resolvedTickId = overwriteTickId ?? newTick?.TickId ?? null;
  const updatedNight = { date: today, raidId, name: raidName, poolId, ticks: { ...(night?.ticks || {}) } };
  updatedNight.ticks[slotNum] = { tickId: resolvedTickId, description, postedAt: Date.now(), count: matched.length };
  saveRaidNight(updatedNight);

  return {
    ok: true, action: overwriteTickId ? 'overwritten' : 'appended',
    raidId, raidName, slot, description,
    count: matched.length, unmatched, points,
    slotsUsed: Object.keys(updatedNight.ticks).filter(k => !isNaN(Number(k))).length,
  };
}

module.exports = { submitRaidTick, isRaidDay, isSpecialRaid, buildTicksPayload, MAX_REGULAR_TICKS };
