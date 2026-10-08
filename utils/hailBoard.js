// utils/hailBoard.js — the hail board: who in the raid still has to hail the NPC a boss's death spawns.
//
// The guild lead, 2026-10-05: "Upon boss death and spawn of a creature that needs to be hailed, we should
// have that as an available slot in command center to track who has not yet hailed and who has already. If
// we know they've already completed that section we do not need to track them for needing to hail."
// Picked as option A: ONE shared board. Every raider's Command Center shows the same list, filled from every
// Mimic in the raid, and any raider can tap a name to mark it hailed.
//
// What it is: when a boss that spawns a hail NPC is recorded dead, a WINDOW opens for as long as that NPC
// stays (a Planar Projection: 20 minutes since the 2026-10-04 Quarm patch; Giwin Mirakon and Tylis Newleaf
// still depop at 10 in their scripts). The raid at the kill is snapshotted into it. Read time then sorts every
// name into one of four places, from what we already collect:
//   already_flagged — their pop_flags progress already holds the step this hail gives (nothing to track).
//   hailed          — a flag or checklist grant landed after the kill ('flag'), a hail was witnessed ('seen'),
//                     or somebody tapped the name ('marked', with who).
//   still           — everyone else in the kill roster. prior_missing is set when we KNOW they lack the step
//                     the hail needs first, so the hail would only give them a checklist flag.
//
// Each window also says how many flags its NPC can still give (flag_cap / flags_granted / flags_left — the
// script's own cap, counted from the grants we saw) and when the NPC leaves (expires_at, ms_left).
//
// Only the raid at the kill can get credit (the NPC answers the group or raid holding the kill credit), so
// the board is the raid roster at the kill and nobody else.
//
// ⚠ State lives in bot_kv (key `hail_windows`), never state.json: it is keyed per kill and state.json does
// not survive a Railway deploy (CLAUDE.md). The in-memory copy is authoritative once loaded — one bot replica
// — so an idle board costs ZERO queries per poll, which matters because every Mimic in the raid polls it.
//
// Every script fact below was read from eqemu_quest_scripts on 2026-10-05 (the projection scripts were synced
// 2026-10-04, after the patch). Agnarr is NOT here on purpose: Karana wants a phrase, not a hail.
'use strict';

const popFlagStages = require('./popFlagStages');

const MIN = 60_000;
const WINDOW_MS      = 20 * MIN;   // a Planar Projection's stay
const KEEP_AFTER_MS  = 10 * MIN;   // a late mark is still taken this long after the NPC is gone
const ROSTER_FRESH_MS = 15 * MIN;  // raid_roster rows older than this are stale (same as the raid tick)
const FLAG_SLACK_MS  = 90 * 1000;  // log clocks vs the kill's clock: a grant this far BEFORE the kill still counts
const CACHE_MS       = 5_000;      // the computed board, shared by every poller
const BASELINE_MS    = 60_000;     // progress history (what they held before the kill) moves slowly
const LOAD_RETRY_MS  = 30_000;
const MAX_WINDOWS    = 12;
const MAX_NAMES      = 150;
const KV_KEY         = 'hail_windows';
const SAME_KILL_MS   = 30 * MIN;   // two relays of one death land this close together

const PROJECTION = ['planar projection', 'projection'];

// One row per boss. `done` = flag keys (stage names and the catalog keys STAGE_IMPLIES derives) that prove
// this hail's step, or a LATER step of the same series, is held — a series only shows its latest value.
// `checklist` = the cl_ key a hail gives when the step before it is missing. `prior` = requirements, each a
// list of keys of which any one meets it; ONLY steps the Seer's recital also reports (RECITAL_STAGES) are
// listed, because a missing prerequisite is only claimed for a raider whose recital we hold.
//
// `flagCap` = the most grants the NPC's script hands out per spawn (read from eqemu_quest_scripts,
// 2026-10-07; a row whose script states none gets none). Every script keeps a counter `flags` that resets on
// spawn and rises once per flag ACTUALLY granted — a real flag or a checklist flag; a hail that grants nothing
// does not count. The comparison differs per script (`<` stops at the cap, `<=` lets one more through), noted
// on each row. `flagTicks` = how many counter ticks one raider's hail can burn when it grants (1 unless a
// script says otherwise); the board's cap is the script's number divided by it, so it reads in raiders and
// is the worst case (a raider who already holds the extra global burns fewer).
//   Cap 72, depop 20 min (the Planar Projections, all `<` unless noted):
//     Bertoxxulous (codecay) — one gate over the whole hail, `flags < FLAG_LIMIT`.
//     Terris-Thule (nightmareb) — real flag `flags < FLAG_LIMIT`, checklist flag `flags <= FLAG_LIMIT`.
//     Aerin`Dar (povalor), Saryrn (potorment), Solusek Ro (solrotower), Tallon / Vallon / Rallos (potactics,
//     npc ids 214323 / 214324 / 214322) — one gate over the whole hail, `flags < FLAG_LIMIT`.
//   Cap 72 × 2, depop 20 min — Grummus (podisease) and Lord Mithaniel Marr (hohonorb) declare
//     `FLAG_LIMIT = 72 * 2` because one hail can tick twice (the flag or checklist flag, then a second global);
//     one gate over the whole hail, `flags <= FLAG_LIMIT`.
//   Cap 72, depop 10 min: Tylis Newleaf (real flag and checklist flag both `flags <= FLAG_LIMIT`) and
//     Giwin Mirakon (real flag `flags <= FLAG_LIMIT`, checklist flag `flags < FLAG_LIMIT`).
//   Cap 54 — the Arbitor of Earth has no FLAG_LIMIT but `MAX_KEYS = 54` (`keys < MAX_KEYS`): the NPC depops at
//     once when the 54th key goes out, and its 20-minute timer is paused while it is in combat.
const HAIL_BOSSES = [
  { id: 'grummus', name: 'Grummus', names: ['grummus'], zone: 'Plane of Disease', zoneShort: 'podisease',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 144, flagTicks: 2,
    // Moves fuirstel 1 → 2 (and silently sets the Crypt of Decay `grummus` global, which is why grummus_dead
    // is NOT a done key: a raider who hailed it without the ward holds that and still needs the step).
    done: ['fuirstel_2', 'fuirstel_3', 'fuirstel_4', 'fuirstel_5'], checklist: 'cl_grummus', prior: [['fuirstel_1']] },
  { id: 'bertoxxulous', name: 'Bertoxxulous', names: ['bertoxxulous'], zone: 'The Crypt of Decay', zoneShort: 'codecay',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    // fuirstel 3 → 4, and only with the Tarkil Adan key (not in the recital, so not claimed as a prior).
    done: ['fuirstel_4', 'fuirstel_5', 'bert_dead'], checklist: 'cl_bertox', prior: [['fuirstel_3']] },
  { id: 'terris_thule', name: 'Terris-Thule', names: ['terris thule'], zone: 'The Lair of Terris Thule', zoneShort: 'nightmareb',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['thelin_3', 'thelin_4', 'tthule_dead'], checklist: 'cl_terris', prior: [['thelin_2', 'hedge_event']] },
  { id: 'aerin_dar', name: 'Aerin`Dar', names: ['aerin`dar', 'aerin dar'], zone: 'Plane of Valor', zoneShort: 'povalor',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    // Silent: sets the `aerindar` global with no grant line, so only the Seer or a witnessed hail shows it.
    done: ['aerindar_2', 'aerindar_dead'], checklist: null, prior: [['mavuin_3', 'trial_justice']] },
  { id: 'saryrn', name: 'Saryrn', names: ['saryrn'], zone: 'Plane of Torment', zoneShort: 'potorment',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    // Real flag only at tylis 2; the cipher replaces it, so cipher_1 counts as done.
    done: ['saryrn_1', 'saryrn_dead', 'cipher_1'], checklist: 'cl_saryrn', prior: [['tylis_2', 'keeper_dead']] },
  { id: 'keeper_of_sorrows', name: 'The Keeper of Sorrows', names: ['the keeper of sorrows', 'keeper of sorrows'],
    zone: 'Plane of Torment', zoneShort: 'potorment',
    npc: 'Tylis Newleaf', npcKeys: ['tylis newleaf', 'tylis'], minutes: 10, flagCap: 72,   // Tylis depops at 10 minutes
    done: ['tylis_2', 'keeper_dead'], checklist: 'cl_keeper', prior: [['tylis_1']] },
  { id: 'lord_mithaniel_marr', name: 'Lord Mithaniel Marr', names: ['lord mithaniel marr', 'mithaniel marr'],
    zone: 'Temple of Marr', zoneShort: 'hohonorb',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 144, flagTicks: 2,
    done: ['mmarr_1', 'marr_dead', 'cipher_1'], checklist: 'cl_mmarr', prior: [['hohtrials_111', 'hoh_trials']] },
  { id: 'manaetic_behemoth', name: 'Manaetic Behemoth', names: ['manaetic behemoth'],
    zone: 'Plane of Innovation', zoneShort: 'poinnovation',
    npc: 'Giwin Mirakon', npcKeys: ['giwin mirakon', 'giwin'], minutes: 10, flagCap: 72,   // Giwin depops at 10 minutes
    // The real flag needs zeks 1 (Giwin's earlier hail), which the recital does not report: no prior claimed.
    done: ['behemoth_dead', 'zeks_2', 'zeks_3', 'zeks_4', 'zeks_5', 'zeks_6', 'zeks_7'], checklist: 'cl_behemoth', prior: [] },
  { id: 'tallon_zek', name: 'Tallon Zek', names: ['tallon zek'], zone: 'Plane of Tactics', zoneShort: 'potactics',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['tallon_dead', 'zeks_4', 'zeks_5', 'zeks_6', 'zeks_7'], checklist: 'cl_tallon',
    prior: [['zeks_2', 'zeks_3', 'behemoth_dead']] },
  { id: 'vallon_zek', name: 'Vallon Zek', names: ['vallon zek'], zone: 'Plane of Tactics', zoneShort: 'potactics',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['vallon_dead', 'zeks_3', 'zeks_5', 'zeks_6', 'zeks_7'], checklist: 'cl_vallon',
    prior: [['zeks_2', 'zeks_4', 'behemoth_dead']] },
  { id: 'rallos_zek_warlord', name: 'Rallos Zek the Warlord', names: ['rallos zek the warlord', 'rallos zek'],
    zone: 'Plane of Tactics', zoneShort: 'potactics',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['zeks_7', 'rallos_dead'], checklist: 'cl_rallos', prior: [['zeks_6']] },
  { id: 'solusek_ro', name: 'Solusek Ro', names: ['solusek ro'], zone: 'Tower of Solusek Ro', zoneShort: 'solrotower',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    // Says nothing at all until all five rooms are done (sol_room 11111); then pofire 1 and zeks 7 decide
    // between the real flag and the checklist one.
    done: ['pofire_2', 'solro_dead'], checklist: 'cl_solusek',
    prior: [['pofire_1'], ['zeks_7'], ['sol_room_1'], ['sol_room_2'], ['sol_room_3'], ['sol_room_4'], ['sol_room_5']] },
  { id: 'arbitor_of_earth', name: 'A Mystical Arbitor of Earth',
    names: ['a mystical arbitor of earth', 'the arbitor of earth', 'arbitor of earth'],
    zone: 'Plane of Earth', zoneShort: 'poeartha',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 54,
    // No step before it, and 54 keys per spawn.
    done: ['earthb_key_1', 'arbitor_dead'], checklist: null, prior: [] },
];

// A catalog name ("#Aerin`Dar", "Terris_Thule") and a log name ("Terris Thule") are the same boss.
function bossKey(name) {
  return String(name || '').trim().replace(/^#/, '').replace(/[_-]/g, ' ').replace(/'/g, '`')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const BY_ID = new Map(HAIL_BOSSES.map(b => [b.id, b]));
const BY_NAME = new Map();
for (const b of HAIL_BOSSES) for (const n of b.names) BY_NAME.set(bossKey(n), b);

// The hail row for a boss kill, or null. The board's own id wins; the name covers bosses the board does not
// carry (Mithaniel Marr, Solusek Ro, the Keeper, the Behemoth, the Arbitor).
function hailFor({ bossId, bossName } = {}) {
  return (bossId && BY_ID.get(bossId)) || BY_NAME.get(bossKey(bossName)) || null;
}

const enc = encodeURIComponent;
const iso = (ms) => new Date(ms).toISOString();
const lc = (s) => String(s || '').toLowerCase();
const byName = (a, b) => (lc(a.name || a) < lc(b.name || b) ? -1 : lc(a.name || a) > lc(b.name || b) ? 1 : 0);
// A character name, as the bot validates one elsewhere (Quarmy ingest): letters only.
const isCharName = (s) => /^[A-Za-z]{2,24}$/.test(String(s || '').trim());

// "Hail, a planar projection" / "Hail, Giwin": the NPC the way a raider typed it, minus the article.
function npcKey(s) { return lc(s).replace(/^(a|an|the)\s+/, '').replace(/[^a-z` ]/g, '').replace(/\s+/g, ' ').trim(); }

// ── The pure part ──────────────────────────────────────────────────────────────────────────────────
// windows: the stored windows. data: { rows, known } — pop_flags rows ({character, flag_key, source, npc,
// zone, earned_at}) for the roster, and the lower-case names we hold a Seer recital for.
// Returns one view per window, in the contract's shape.
function buildViews(windows, data, nowMs) {
  const rows = (data && data.rows) || [];
  const known = (data && data.known) || new Set();
  const byChar = new Map();
  for (const r of rows) {
    const k = lc(r.character);
    if (!byChar.has(k)) byChar.set(k, []);
    byChar.get(k).push({ ...r, t: Date.parse(r.earned_at) });
  }
  // A witnessed hail says only "hailed A Planar Projection" — never WHICH projection. When two windows could
  // own one hail row, the earliest window takes the earliest unused hail, so a raider's second hail is what
  // credits the second window. Zone narrows it where the agent sent one.
  const usedHail = new Set();
  const ordered = windows.slice().sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
  const views = new Map();
  for (const w of ordered) {
    const cfg = BY_ID.get(w.boss_id);
    if (!cfg) continue;
    const opened = Date.parse(w.opened_at), expires = Date.parse(w.expires_at);
    const cutoff = opened - FLAG_SLACK_MS, until = expires + FLAG_SLACK_MS;
    const still = [], hailed = [], already = [];
    const feeders = new Set(w.uploaders || []);
    for (const name of w.roster) {
      const k = lc(name);
      const mine = byChar.get(k) || [];
      const keys = new Set(mine.map(r => r.flag_key));
      // Even a raider settled some other way takes their hail row, so it cannot credit the next window.
      const hailRow = mine.find(r => r.flag_key === 'hail' && !usedHail.has(r)
        && npcKey(r.npc) && cfg.npcKeys.includes(npcKey(r.npc))
        && (!r.zone || popFlagStages.zoneShort(r.zone) === cfg.zoneShort)
        && r.t >= cutoff && r.t <= until);
      if (hailRow) usedHail.add(hailRow);
      const grant = (r) => r.t >= cutoff && r.t <= until && (r.source === 'event' || r.source === 'checklist');
      const doneRows = mine.filter(r => cfg.done.includes(r.flag_key));
      // Held before the kill — or reported by the Seer, which proves the state and not when it began.
      const before = doneRows.some(r => r.source === 'recital' || r.t < cutoff);
      const flagNow = doneRows.some(grant) || (cfg.checklist && mine.some(r => r.flag_key === cfg.checklist && grant(r)));
      if (mine.some(grant)) feeders.add('c:' + k);
      if (before) { already.push(name); continue; }
      if (flagNow) { hailed.push({ name, how: 'flag' }); continue; }
      if (hailRow) { hailed.push({ name, how: 'seen' }); continue; }
      const mark = w.marks && w.marks[k];
      if (mark) { hailed.push(mark.by ? { name, how: 'marked', by: mark.by } : { name, how: 'marked' }); continue; }
      // Unknown is not missing: a prerequisite is claimed absent only for a raider whose recital we hold.
      const missing = known.has(k) && cfg.prior.some(any => !any.some(key => keys.has(key)));
      still.push({ name, prior_missing: missing });
    }
    // The NPC's flag cap (see HAIL_BOSSES), in raiders. `flags_granted` is the raiders on THIS board whose
    // grant landed after the kill ('flag' — a witnessed hail or a tap is not proof anything was granted).
    // ⚠ A LOWER BOUND on what the NPC has handed out: a raider without Mimic, a hail by somebody outside the
    // kill roster, or a grant whose log line never reached us is not counted, so `flags_left` is an UPPER bound.
    const cap = cfg.flagCap ? Math.floor(cfg.flagCap / (cfg.flagTicks || 1)) : null;
    const granted = hailed.filter(h => h.how === 'flag').length;
    views.set(w.id, {
      id: w.id, boss_id: w.boss_id, boss_name: w.boss_name, npc_name: w.npc_name, zone: w.zone,
      opened_at: w.opened_at, expires_at: w.expires_at,
      flag_cap: cap, flags_granted: granted, flags_left: cap == null ? null : Math.max(0, cap - granted),
      still: still.sort(byName), hailed: hailed.sort(byName), already_flagged: already.sort(byName),
      // Roster feeders plus raiders whose own Mimic reported a grant. One person can be both, so this reads
      // as "at least this many Mimics", not an exact count: the two id spaces cannot be joined here.
      seen_by: feeders.size,
    });
  }
  return views;
}

// ── The board ──────────────────────────────────────────────────────────────────────────────────────
// `supabase` is utils/supabase (or a stand-in), `guildId` a string or a function, `now` the clock.
function create({ supabase, guildId, now = Date.now, log = console } = {}) {
  const gid = () => (typeof guildId === 'function' ? guildId() : guildId) || 'wolfpack';
  let windows = [];
  let loaded = false, loadedAt = 0, dirty = false;
  let version = 0;                     // bumped on every change: a mark never waits out the 5 s cache
  let cache = null;
  let base = null;                     // { key, at, rows } — what each raider held, refreshed every minute
  const known = new Set();             // lower-case names we hold a Seer recital for
  const asked = new Map();             // lower-case name → when we last asked
  let chain = Promise.resolve();
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  const enabled = () => !!(supabase && supabase.isEnabled());

  async function load() {
    if (loaded) return true;
    if (!enabled()) return false;
    if (loadedAt && now() - loadedAt < LOAD_RETRY_MS) return false;
    loadedAt = now();
    const rows = await supabase.select('bot_kv',
      `guild_id=eq.${enc(gid())}&key=eq.${KV_KEY}&select=value&limit=1`).catch(() => null);
    if (!Array.isArray(rows)) return false;       // a failed read is not an empty store
    const stored = rows[0] && rows[0].value && Array.isArray(rows[0].value.windows) ? rows[0].value.windows : [];
    const have = new Set(windows.map(w => w.id));
    windows = [...stored.filter(w => w && w.id && BY_ID.has(w.boss_id) && Array.isArray(w.roster) && !have.has(w.id)), ...windows]
      .sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
    loaded = true;
    if (dirty) await save();
    return true;
  }

  // Never writes what it could not read first: that would drop windows another deploy left open.
  async function save() {
    if (!enabled() || !loaded) { dirty = true; return; }
    dirty = false;
    await supabase.upsert('bot_kv', [{ guild_id: gid(), key: KV_KEY, value: { windows }, updated_at: iso(now()) }], 'guild_id,key')
      .catch(err => log.warn('[hail-board] save failed:', err && err.message));
  }

  function prune() {
    const t = now();
    const keep = windows.filter(w => Date.parse(w.expires_at) + KEEP_AFTER_MS > t).slice(-MAX_WINDOWS);
    if (keep.length === windows.length) return false;
    windows = keep; version++;
    return true;
  }

  async function snapshotRoster(killedAtMs) {
    const rows = await supabase.selectAllPaged('raid_roster',
      `guild_id=eq.${enc(gid())}&captured_at=gte.${enc(iso(killedAtMs - ROSTER_FRESH_MS))}` +
      '&select=name,uploaded_by_discord_id', 'uploaded_by_discord_id.asc,name').catch(() => null);
    const names = new Map(), uploaders = new Set();
    for (const r of rows || []) {
      if (!isCharName(r.name)) continue;
      const nm = String(r.name).trim();
      if (!names.has(lc(nm))) names.set(lc(nm), nm);
      if (r.uploaded_by_discord_id) uploaders.add(String(r.uploaded_by_discord_id));
    }
    return { names: [...names.values()].slice(0, MAX_NAMES), uploaders: [...uploaders] };
  }

  // Open the window for a kill, or fold a second report of the same kill into the one already open.
  // → the stored window, or null (not a hail boss / already expired / nobody to track).
  function openWindow({ bossId, bossName, killedAtMs, participants } = {}) {
    const cfg = hailFor({ bossId, bossName });
    if (!cfg || !enabled()) return Promise.resolve(null);
    const t = now();
    const killed = Math.min(Number.isFinite(killedAtMs) ? killedAtMs : t, t);
    const expires = killed + (cfg.minutes ? cfg.minutes * MIN : WINDOW_MS);
    if (expires <= t) return Promise.resolve(null);
    return serial(async () => {
      await load();
      prune();
      const same = windows.find(w => w.boss_id === cfg.id && Math.abs(Date.parse(w.opened_at) - killed) < SAME_KILL_MS);
      if (same) {
        // The earliest report of the death is the true one (the death line beats the upload that follows it).
        if (killed < Date.parse(same.opened_at) - 5000) {
          same.opened_at = iso(killed); same.expires_at = iso(expires);
          version++; await save();
        }
        return same;
      }
      let { names, uploaders } = await snapshotRoster(killed);
      if (!names.length) names = [...new Set((participants || []).filter(isCharName).map(s => String(s).trim()))].slice(0, MAX_NAMES);
      if (!names.length) return null;
      const w = {
        id: `${cfg.id}:${Math.floor(killed / 1000)}`, boss_id: cfg.id, boss_name: cfg.name, npc_name: cfg.npc,
        zone: cfg.zone, opened_at: iso(killed), expires_at: iso(expires),
        roster: names, uploaders, marks: {},
      };
      windows.push(w); version++;
      prune();
      await save();
      return w;
    });
  }

  // The data a view is built from. A failed read leaves that part empty (nobody is claimed settled or missing).
  async function loadData(ws) {
    const names = [...new Set(ws.flatMap(w => w.roster))].slice(0, MAX_NAMES * 2);
    const inList = `in.(${names.map(enc).join(',')})`;
    const keys = [...new Set(ws.flatMap(w => {
      const c = BY_ID.get(w.boss_id);
      return c ? [...c.done, ...(c.checklist ? [c.checklist] : []), ...c.prior.flat()] : [];
    }))].sort();
    const baseKey = names.join(',') + '|' + keys.join(',');
    if (!base || base.key !== baseKey || now() - base.at > BASELINE_MS) {
      const rows = await supabase.selectAllPaged('pop_flags',
        `guild_id=eq.${enc(gid())}&character=${inList}&flag_key=in.(${keys.join(',')})&select=character,flag_key,source,earned_at`, 'id')
        .catch(() => null);
      base = { key: baseKey, at: now(), rows: rows || (base && base.key === baseKey ? base.rows : []) };
    }
    const since = iso(Math.min(...ws.map(w => Date.parse(w.opened_at))) - FLAG_SLACK_MS);
    const recent = await supabase.selectAllPaged('pop_flags',
      `guild_id=eq.${enc(gid())}&character=${inList}&earned_at=gte.${enc(since)}&flag_key=neq.unmapped` +
      '&select=character,flag_key,source,npc,zone,earned_at', 'id').catch(() => null);
    // A recital, once held, stays true; only names not yet known are asked about, once a minute at most.
    const ask = names.filter(n => !known.has(lc(n)) && now() - (asked.get(lc(n)) || 0) > BASELINE_MS);
    if (ask.length) {
      for (const n of ask) asked.set(lc(n), now());
      const rec = await supabase.selectAllPaged('pop_flags',
        `guild_id=eq.${enc(gid())}&source=eq.recital&character=in.(${ask.map(enc).join(',')})&select=character`, 'id')
        .catch(() => null);
      for (const r of rec || []) known.add(lc(r.character));
    }
    return { rows: [...base.rows, ...(recent || [])], known };
  }

  function computeAll() {
    const t = now();
    if (cache && cache.version === version && t - cache.at < CACHE_MS) return cache.promise;
    const ws = windows.slice();
    const promise = (async () => buildViews(ws, ws.length ? await loadData(ws) : null, t))();
    cache = { at: t, version, promise };
    promise.catch(() => { if (cache && cache.promise === promise) cache = null; });
    return promise;
  }

  // `expires_at` is when the NPC leaves; `ms_left` is the same moment as a duration at the instant of the
  // response, so a Mimic whose clock is off can still count down (the cached view itself is up to 5 s old).
  const withClock = (v, t) => ({ ...v, ms_left: Math.max(0, Date.parse(v.expires_at) - t) });

  // GET /api/agent/hail-board. Idle = no query at all.
  async function getBoard() {
    if (!enabled()) return { windows: [] };
    await load();
    if (prune()) serial(save).catch(() => {});
    const t = now();
    const open = windows.filter(w => Date.parse(w.expires_at) > t);
    if (!open.length) return { windows: [] };
    const views = await computeAll();
    return { windows: open.map(w => views.get(w.id)).filter(Boolean).map(v => withClock(v, t)) };
  }

  // POST /api/agent/hail-mark. → { window } | { status, error }
  function markHailed({ windowId, name, hailed, by } = {}) {
    if (!enabled()) return Promise.resolve({ status: 503, error: 'service unavailable' });
    return serial(async () => {
      await load();
      prune();
      const w = windows.find(x => x.id === windowId);
      if (!w) return { status: 404, error: 'unknown or expired window' };
      const k = lc(String(name || '').trim());
      const canon = w.roster.find(n => lc(n) === k);
      if (!canon) return { status: 400, error: 'not in the kill roster' };
      w.marks = w.marks || {};
      if (hailed === false) delete w.marks[k];
      else w.marks[k] = { name: canon, by: by || null, at: iso(now()) };
      version++;
      await save();
      const views = await computeAll();
      return { window: withClock(views.get(w.id), now()) };
    });
  }

  return { openWindow, getBoard, markHailed, _windows: () => windows };
}

module.exports = {
  create, hailFor, buildViews, bossKey, HAIL_BOSSES,
  WINDOW_MS, KEEP_AFTER_MS, FLAG_SLACK_MS, ROSTER_FRESH_MS, KV_KEY,
};
