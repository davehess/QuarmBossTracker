// utils/potimeCycle.js — the Plane of Time cycle ledger (the guild lead, 2026-10-19; DECISIONS §369 and §383).
//
// Quarm's October 18 patch made the Plane of Time ONE fixed 6 day 18 hour (162 h) cycle that starts at the
// guild's FIRST ENTRY. A kill no longer extends it, so "kill + 162 h" (the old board rule) is the wrong
// meaning. The guild lead picked the HYBRID model (Decision Desk, §383, `potime-model` C):
//
//   • INFERRED  — until the server tells us, the cycle start is the first PoTime activity we saw for the guild
//                 after the previous cycle ended (a member in zone 219/223 in the live-state upload, or a kill
//                 in the Plane of Time), and the cycle runs 162 h from it. source = 'inferred' ("estimated").
//   • OBSERVED  — a value the server stated (a `#timelockout` reply, or an /sll Quarm lockout) replaces the
//                 inference outright, and a later observed value replaces an earlier one. source = 'observed',
//                 `via` records which line it came from.
//
// The board's Quarm timer is the cycle END, not kill + 162 h (utils/state.js recordKill wrapper asks
// endForKill). Slow mode's 18 h never applies to Quarm either (§369).
//
// The ledger lives in bot_kv (key `potime_cycle`), NOT state.json, because state.json does not survive a
// Railway deploy. Kills are timed in SYNC code, so reads come from a module-level copy that loadPotimeCycle()
// fills at boot and the setters keep current; the bot_kv write is fire-and-forget.
//
// ⚠ Shape of the ledger (all ms epoch):
//   { startMs, endMs, source: 'inferred'|'observed', via: 'zone-in'|'kill'|'timelockout'|'sll', setAt, prevEndMs }
// `prevEndMs` is the end of the cycle BEFORE this one, so a late-relayed event from that earlier cycle cannot
// drag a new cycle's start backwards.

const POTIME_KEY = 'potime_cycle';
const BOSS_ID = 'quarm';
const CYCLE_MS = 162 * 3600000;                 // 6 days 18 hours
const ZONE_IDS = new Set([219, 223]);           // potimea, potimeb (utils/popFlagStages.js)
const OBSERVED_SLACK_MS = 3600000;              // an observed end may run an hour past a full cycle from now

let _ledger = null;

function getCycle() { return _ledger; }
function isPotimeBoss(bossId) { return bossId === BOSS_ID; }
function isPotimeZone(zoneId) { return ZONE_IDS.has(Number(zoneId)); }

// ── persistence ─────────────────────────────────────────────────────────────
function _kvQuery(supabase) {
  return `guild_id=eq.${encodeURIComponent(supabase.guildId())}&key=eq.${POTIME_KEY}`;
}

// Boot: pull the stored ledger into memory. Never throws; a failed read leaves the ledger as it was.
async function loadPotimeCycle() {
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return _ledger;
    const rows = await supabase.select('bot_kv', `${_kvQuery(supabase)}&select=value&limit=1`);
    const v = Array.isArray(rows) && rows[0] && rows[0].value;
    if (v && Number.isFinite(v.startMs) && Number.isFinite(v.endMs) && (v.source === 'inferred' || v.source === 'observed')) _ledger = v;
  } catch (err) {
    console.warn('[potime] load failed:', err?.message);
  }
  return _ledger;
}

// Fire-and-forget by design (callers are sync kill paths); returns the promise so a test can await it.
function persist() {
  const snapshot = _ledger;
  return (async () => {
    try {
      const supabase = require('./supabase');
      if (!supabase.isEnabled() || !snapshot) return false;
      const res = await supabase.upsert('bot_kv',
        [{ guild_id: supabase.guildId(), key: POTIME_KEY, value: snapshot, updated_at: new Date().toISOString() }], 'guild_id,key');
      return Array.isArray(res);
    } catch (err) {
      console.warn('[potime] persist failed:', err?.message);
      return false;
    }
  })();
}

// ── the board ───────────────────────────────────────────────────────────────
// When the ledger moves, a Quarm timer already on the board follows it. No entry is CREATED here: a cycle
// running is not a kill, and Quarm is only "on cooldown" once he has died.
let _boardForTests = null;   // a test stands in for utils/state.js (which reads the real data/state.json)
function _syncBoard() {
  try {
    const state = _boardForTests || require('./state');
    const entry = state.getBossState(BOSS_ID);
    if (entry && _ledger && entry.nextSpawn !== _ledger.endMs) state.overrideTimer(BOSS_ID, _ledger.endMs);
  } catch (err) {
    console.warn('[potime] board sync failed:', err?.message);
  }
}

function _set(next) {
  _ledger = next;
  _syncBoard();
  persist();
}

// ── inference ───────────────────────────────────────────────────────────────
// THE inference rule. `kind` is 'zone-in' or 'kill'. Returns true when the ledger changed.
//   • no ledger, or the activity is at/after the current cycle's end → a NEW cycle starts at the activity
//     (this also replaces an observed cycle that has run out);
//   • the activity is inside the current cycle → nothing changes (a kill never extends it);
//   • the activity is BEFORE an inferred cycle's start, but after the previous cycle's end and less than one
//     cycle earlier → the start moves back to it (an earlier-timestamped report of the same first entry);
//   • before an observed cycle's start → ignored (the server's number stands).
function noteActivity(atMs, kind = 'zone-in') {
  if (!Number.isFinite(atMs)) return false;
  const cur = _ledger;
  if (!cur || atMs >= cur.endMs) {
    _set({ startMs: atMs, endMs: atMs + CYCLE_MS, source: 'inferred', via: kind, setAt: Date.now(), prevEndMs: cur ? cur.endMs : 0 });
    return true;
  }
  if (atMs >= cur.startMs) return false;
  if (cur.source === 'inferred' && atMs >= (cur.prevEndMs || 0) && cur.startMs - atMs < CYCLE_MS) {
    _set({ ...cur, startMs: atMs, endMs: atMs + CYCLE_MS, via: kind, setAt: Date.now() });
    return true;
  }
  return false;
}

// ── observation ─────────────────────────────────────────────────────────────
// THE ONE entry point for a server-stated cycle/lockout end. Anything that parses such a value calls this
// and nothing else writes an 'observed' ledger. `via` names the source line ('timelockout' | 'sll').
//
// TODO(real capture needed): no `#timelockout` reply has been captured yet, so there is NO regex for it
// here — and none is invented. Once the guild lead's capture exists, the parser belongs next to
// slowMode.parseSlowModeLine, reads the reply into an end time (ms epoch), and calls this with via
// 'timelockout'. The only live caller today is the /sll relay for Quarm (index.js _handleAgentLockout),
// whose structured { bossName, remainingMs } needs no regex.
//
// Rejects a value that is not a plausible cycle end: not a number, already past, or further out than one
// full cycle (+1 h). Observed wins over inferred ALWAYS, and a newer observed value replaces an older one.
function applyObservedCycleEnd(endsAtMs, via, nowMs = Date.now()) {
  if (!Number.isFinite(endsAtMs)) return { changed: false, reason: 'bad-time' };
  if (via !== 'timelockout' && via !== 'sll') return { changed: false, reason: 'bad-source' };
  if (endsAtMs <= nowMs) return { changed: false, reason: 'already-over' };
  if (endsAtMs > nowMs + CYCLE_MS + OBSERVED_SLACK_MS) return { changed: false, reason: 'too-far' };
  const cur = _ledger;
  // Every raider's agent hears the same lines: the same value again changes nothing.
  if (cur && cur.source === 'observed' && cur.via === via && Math.abs(cur.endMs - endsAtMs) < 60000) {
    return { changed: false, reason: 'unchanged' };
  }
  const startMs = endsAtMs - CYCLE_MS;
  const prevEndMs = cur ? (cur.endMs <= startMs ? cur.endMs : cur.prevEndMs || 0) : 0;
  _set({ startMs, endMs: endsAtMs, source: 'observed', via, setAt: nowMs, prevEndMs });
  return { changed: true, ledger: _ledger };
}

// ── the kill timer ──────────────────────────────────────────────────────────
// recordKill's entry point (utils/state.js). Notes the kill as activity, then answers when the cycle ends:
// the Quarm timer's nextSpawn. null for every other boss, so the caller keeps its own rule. A kill the ledger
// cannot place (older than the current cycle) falls back to the old kill + 162 h.
function endForKill(bossId, killedAtMs) {
  if (!isPotimeBoss(bossId)) return null;
  noteActivity(killedAtMs, 'kill');
  if (_ledger && killedAtMs >= _ledger.startMs && killedAtMs < _ledger.endMs) return _ledger.endMs;
  return killedAtMs + CYCLE_MS;
}

// ── the board's label ───────────────────────────────────────────────────────
// A short tag for Quarm's board line, only when the timer on the board IS the ledger's end (a manual
// /updatetimer or a pre-deploy entry carries no tag rather than a wrong one).
function boardTag(bossId, entry) {
  if (!isPotimeBoss(bossId) || !_ledger || !entry || Math.abs(entry.nextSpawn - _ledger.endMs) > 60000) return '';
  if (_ledger.source === 'inferred') return ' • ⏳ estimated';
  return _ledger.via === 'timelockout' ? ' • ⏳ from #timelockout' : ' • ⏳ from /sll';
}

function _resetForTests(ledger = null, board = null) { _ledger = ledger; _boardForTests = board; }

module.exports = {
  POTIME_KEY, BOSS_ID, CYCLE_MS,
  getCycle, isPotimeBoss, isPotimeZone,
  loadPotimeCycle, persist,
  noteActivity, applyObservedCycleEnd, endForKill, boardTag,
  _resetForTests,
};
