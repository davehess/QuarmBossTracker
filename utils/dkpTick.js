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

  // Bonus / Overtime append a new tick to TODAY's raid — the modern bearer
  // write has no separate-raid create (the legacy path that did is dead).
  // They flow through the unified fill/append below with a non-numeric slot,
  // so the "Tick N" slot match never fires and a fresh tick is appended.

  // ── Resolve today's raid ─────────────────────────────────────────────────
  let raidId = null, raidName = null;
  const allRaids = await getRaids();
  const todayRaid = (Array.isArray(allRaids) ? allRaids : [])
    .filter(r => raidDateStr(r.Timestamp, tz) === today && !isSpecialRaid(r.Name))
    .sort((a, b) => b.RaidId - a.RaidId)[0];
  if (todayRaid) { raidId = todayRaid.RaidId; raidName = todayRaid.Name; }
  if (!raidId) {
    return { ok: false, reason: isRaidDay(tz)
      ? `No raid exists for today on OpenDKP — create it there first, then submit the tick.`
      : `No raid for today and it isn't a raid night (Sun/Wed/Thu) — create the raid on OpenDKP first.` };
  }

  // Resolve attendees against the OpenDKP roster: only real characters are
  // credited, unknowns are surfaced. (The server also resolves by Name, but
  // filtering both avoids sending unknown names and lets us warn the officer.)
  const { matched, unmatched } = await _resolveCharacterIds(players);

  // Load the raid to find the target tick slot and echo its fields back
  // verbatim. Raids carry PRE-CREATED tick slots ("Tick 1 (Raid Start)" …)
  // that you FILL — so match the requested slot number to an existing tick;
  // only append when there's no such slot (e.g. Bonus/OT, or an empty raid).
  const full = await getRaid(raidId);
  const ticks = (Array.isArray(full.Ticks) ? full.Ticks : []).map(t => ({ ...t }));
  const slotRx = new RegExp('^\\s*Tick\\s*' + slotNum + '\\b', 'i');
  let idx = ticks.findIndex(t => slotRx.test(String(t.Description || '')));
  if (idx === -1 && typeof slotNum === 'number' && slotNum >= 1 && slotNum <= ticks.length) idx = slotNum - 1;
  const targetDesc = idx !== -1 ? (ticks[idx].Description || description) : description;

  if (dryRun) {
    return {
      ok: true, dryRun: true,
      action: idx !== -1 ? 'would-fill' : 'would-append',
      raidId, raidName: raidName || full.Name || `${today} Raid`,
      slot, description: targetDesc, count: players.length,
      matched_count: matched.length, unmatched, points,
    };
  }
  if (matched.length === 0) {
    return { ok: false, reason: `None of the ${players.length} attendees matched an OpenDKP character — nothing submitted.` };
  }

  // ── Bearer write (POST /clients/{name}/raids/{id}) — EXACT captured shape ─
  // Characters:[{Name:"lowercasename"}] (server resolves), Pool/Version/
  // ClientId/Attendance/Timestamp/Items echoed back verbatim, and NO
  // UpdatedBy field. Fill in place preserves the slot's TickId/Value/
  // Description; append mirrors the raid's standard tick Value.
  const chars = matched.map(m => ({ Name: String(m.name).toLowerCase() }));
  if (idx !== -1) {
    ticks[idx] = { ...ticks[idx], Characters: chars };
  } else {
    const val = ticks.length && Number.isFinite(ticks[0].Value) ? ticks[0].Value : (Number.isFinite(points) ? points : 1);
    ticks.push({ TickId: null, Value: val, Description: description, Characters: chars });
  }
  const raidObject = {
    Items:      full.Items || [],
    Ticks:      ticks,
    ClientId:   full.ClientId,
    RaidId:     full.RaidId,
    Name:       full.Name,
    Timestamp:  full.Timestamp,
    Attendance: full.Attendance,
    Pool:       full.Pool,
    Version:    full.Version,
  };
  await updateRaidById(raidId, raidObject);

  return {
    ok: true, action: idx !== -1 ? 'filled' : 'appended',
    raidId, raidName: raidName || full.Name, slot, description: targetDesc,
    count: matched.length, unmatched, points,
  };
}

module.exports = { submitRaidTick, isRaidDay, isSpecialRaid, buildTicksPayload, MAX_REGULAR_TICKS };
