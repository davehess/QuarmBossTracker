// utils/popStatus.js — the `pop` stream of GET /api/agent/poll: where each of a member's OWN characters stands on the
// Planes of Power flags, and what to do next (the guild lead, 2026-10-27: "A then B" for the per-character flags
// checklist in Mimic; "build in this sort of logic and put the flags checklist per character into motion").
//
// Two halves, both here:
//   buildStatus   PURE. What a character holds (flag keys) -> the status the Flags mode of Mimic's PoP overlay draws.
//                 Every rule is the website's, read from utils/popEngine.js, which scripts/sync-pop-engine.js generates
//                 from web/lib/pop*.ts. Nothing about progression is written down in this file: the next step per line,
//                 what blocks it, the Seer's pending memories and the per-plane state all come out of the engine.
//   create        The service the poll calls: who the caller's own characters are, what each one holds (the same three
//                 sources the website merges in web/lib/raidPreflags.ts loadHeld: pop_flags rows, the owner's own ticks,
//                 /who proof), a short per-character cache, and a version so an unchanged answer costs a few bytes.
//
// SCOPE: only the caller's own characters. The caller is the Mimic session's discord_id (requireAgentAuth); its
// characters are the `characters` rows linked to that id. The agent's watched list (`characters=`) can only NARROW
// that set, never widen it, so naming someone else's character returns nothing about it. A character with
// exclude_from_stats is left out (the same rule /me follows).
//
// The payload carries KEYS, not prose: stage keys ('fuirstel_1'), guide step keys ('flag_grummus'), checklist keys
// ('cl_grummus'), plane keys ('disease'), catalog flags. The overlay turns them into words and links from its own
// generated tables (apps/mimic/pop-quests.js: the quests, and `anchors` for key -> step), so a newer bot and an older
// overlay (and the other way round) only ever disagree about a key they do not know, which draws as plain text.
'use strict';

const engine = require('./popEngine');

const MAX_CHARACTERS = 12;
const CACHE_MS = 2 * 60_000;     // a tick saved on the website reaches no bot hook, so a cached status is re-read this often
const MAX_STEPS_PER_LINE = 3;    // the line's next steps that can be done now; the card shows the first
const MAX_TOP = 3;

// The keys and doors a member asks about by name ("the Factory door"). Authored here and checked by
// test/pop-status-bot.test.js: each must be a step in POP_STEPS.
const DOOR_STEPS = ['poi_door_1', 'grummus_1', 'bertox_key_1', 'earthb_key_1'];

const STEP_BY_KEY = new Map();
const ZONE_OF_STEP = new Map();
for (const [zone, steps] of Object.entries(engine.POP_STEPS)) {
  for (const s of steps) { STEP_BY_KEY.set(s.key, s); ZONE_OF_STEP.set(s.key, zone); }
}
const TOTAL_STEPS = STEP_BY_KEY.size;
const ZONE_BY_KEY = new Map(engine.POP_ZONES.map(z => [z.key, z]));
// The step each checklist memory grants, for the memory's name ('Kill Grummus, hail the Planar Projection').
const GIVES = new Map(engine.PENDING_MEMORIES.map(m => [m.key, m.gives]));

const lc = (s) => String(s || '').toLowerCase();

/**
 * One character's status. `flagKeys` is everything the character is known to hold: pop_flags keys (stage keys, catalog
 * flags, 'cl_*' checklist memories), the flags the owner ticked and the flags /who proves.
 * Pure: same keys, same answer, so the poll can hash it.
 */
function buildStatus(name, flagKeys) {
  const raw = [...flagKeys];
  const held = engine.heldClosure(raw);
  const lines = engine.nextSteps({ done: [], flags: held });
  const top = engine.topNext(lines, MAX_TOP);

  const zones = engine.zoneViews(held).map(v => {
    const total = (engine.POP_STEPS[v.zone.key] || []).length;
    const done = (engine.POP_STEPS[v.zone.key] || []).filter(s => held.has(s.key)).length;
    return {
      key: v.zone.key, name: v.zone.name, short: v.zone.short, tier: v.zone.tier,
      state: total > 0 && done === total ? 'done' : (done > 0 ? 'part' : 'none'),
      done, total, open: v.open, missing: v.missing,
    };
  });

  // What stops a step the engine's lines know: the line's own blockers, and (one level down) what the line each of
  // those comes from is waiting on. Rallos Zek's pending memory waits on Maelin's reading of the Zek notes, which waits
  // on the cipher (Grand_Librarian_Maelin.lua:65), which waits on the Saryrn half and the Marr half.
  const brief = (b) => ({ flag: b.flag, label: b.label, line: b.line });
  const waitsOn = (stage) => {
    const guide = engine.STEP_GUIDE[stage];
    const line = guide && lines.find(l => l.state === 'blocked' && l.steps.some(s => s.key === guide));
    if (!line) return [];
    return line.blockedOn.map(b => {
      const from = b.line && lines.find(l => l.line === b.line && l.state === 'blocked');
      return { ...brief(b), via: from ? from.blockedOn.map(brief) : [] };
    });
  };

  const pendingKeys = raw.filter(k => GIVES.has(k));
  const pending = engine.pendingNext(pendingKeys, held)
    .filter(p => p.state !== 'moot')
    .map(p => {
      const gives = GIVES.get(p.key);
      return {
        key: p.key,
        state: p.state,                                     // ready | blocked
        gives,                                              // the stage the Seer's 'unlock memories' writes
        label: (STEP_BY_KEY.get(gives) || {}).label || gives,
        step: p.step,                                       // the stage to do next (blocked: the missing one; ready: = gives)
        text: p.text,
        waits_on: p.state === 'blocked' ? waitsOn(p.step) : [],   // what the step above itself waits on, when it is not doable yet
      };
    });

  const doneSteps = [...STEP_BY_KEY.keys()].filter(k => held.has(k));
  return {
    character: String(name),
    steps: { done: doneSteps.length, total: TOTAL_STEPS },
    held: doneSteps,
    top: top.map(t => ({ line: t.line.line, step: t.step.key })),
    next: lines.map(l => ({
      line: l.line, label: l.label, short: l.short, state: l.state, done: l.done, total: l.total,
      steps: l.state === 'done' ? [] : l.steps.slice(0, MAX_STEPS_PER_LINE).map(s => ({
        key: s.key, title: s.title, who: s.who, must: s.must, zone: s.zone, verify: s.verify,
      })),
      blocked_on: l.blockedOn.map(b => ({ flag: b.flag, label: b.label, line: b.line })),
      skipped: l.skipped,
    })),
    pending,
    zones,
    doors: DOOR_STEPS.filter(k => STEP_BY_KEY.has(k)).map(k => {
      const s = STEP_BY_KEY.get(k);
      return { step: k, zone: ZONE_OF_STEP.get(k), label: s.label, note: s.note || null, held: held.has(k) };
    }),
  };
}

// Cheap stable version (same djb2 as the tuning bundle's), so the poll can answer `{ version, unchanged: true }`.
function versionOf(obj) {
  let s;
  try { s = JSON.stringify(obj); } catch { s = String(Date.now()); }
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const enc = encodeURIComponent;

/**
 * The service. `supabase` is utils/supabase.js (or a fake with isEnabled/select/selectAllPaged/rpc).
 * `guildId` is a string or a function returning one; `now` is injectable for tests.
 */
function create({ supabase, guildId, now = Date.now, cacheMs = CACHE_MS }) {
  const gid = () => (typeof guildId === 'function' ? guildId() : guildId);
  const cache = new Map();                // lower-cased name -> { at, status }

  /** A character's flags changed (a pop_flags upsert landed): the next read rebuilds it. */
  function invalidate(names) {
    for (const n of (Array.isArray(names) ? names : [])) cache.delete(lc(n));
  }

  // The caller's own characters: [{ name }], or null when the database would not answer.
  async function ownCharacters(discordId) {
    const rows = await supabase.select('characters',
      `guild_id=eq.${enc(gid())}&discord_id=eq.${enc(discordId)}&select=name,exclude_from_stats&limit=100`).catch(() => null);
    if (!Array.isArray(rows)) return null;
    return rows.filter(r => r && r.name && !r.exclude_from_stats).map(r => ({ name: String(r.name) }));
  }

  // What each named character holds: Map(lower name -> Set(flag keys)), or null if any source failed to answer.
  async function load(names) {
    const g = gid();
    const inList = names.map(enc).join(',');
    const [flagRows, tickRows, sights] = await Promise.all([
      supabase.selectAllPaged('pop_flags',
        `guild_id=eq.${enc(g)}&character=in.(${inList})&flag_key=not.in.(unmapped,hail)&select=character,flag_key`, 'id').catch(() => null),
      supabase.selectAllPaged('pop_guide_ticks',
        `guild_id=eq.${enc(g)}&character_name=in.(${inList})&select=character_name,item_key`, 'character_name,item_key').catch(() => null),
      Promise.resolve(supabase.rpc('pop_who_sightings', { p_guild_id: g, p_names: names.map(lc), p_zones: engine.WHO_ZONE_NAMES })).catch(() => null),
    ]);
    if (!Array.isArray(flagRows) || !Array.isArray(tickRows) || !Array.isArray(sights)) return null;
    const out = new Map(names.map(n => [lc(n), new Set()]));
    for (const r of flagRows) { const s = out.get(lc(r.character)); if (s && r.flag_key) s.add(r.flag_key); }
    for (const [k, fs] of engine.selfFlagsFromTicks(tickRows)) { const s = out.get(k); if (s) for (const f of fs) s.add(f); }
    const by = new Map();
    for (const r of sights) {
      if (!by.has(r.character_key)) by.set(r.character_key, []);
      by.get(r.character_key).push(r);
    }
    for (const [k, rows] of by) { const s = out.get(k); if (s) for (const f of engine.flagsFromSightings(rows).keys()) s.add(f); }
    return out;
  }

  /**
   * The stream's payload for one caller. `wanted` = the agent's watched characters (may be empty = all of the
   * caller's own). Never throws. The poll compares `version` with the agent's `pop_ver` and answers `unchanged`.
   * -> { version, characters: { <lower name>: status }, unlinked: [name] }
   */
  async function streamFor({ discordId, wanted }) {
    if (!supabase || !supabase.isEnabled() || !discordId) return { version: versionOf({}), characters: {}, unlinked: [] };
    const own = await ownCharacters(String(discordId));
    if (!own) return { version: null, characters: {}, unlinked: [], error: 'database unavailable' };
    const want = (Array.isArray(wanted) ? wanted : []).map(lc).filter(Boolean);
    const ownByLc = new Map(own.map(c => [lc(c.name), c.name]));
    const pick = want.length ? want.filter(n => ownByLc.has(n)) : [...ownByLc.keys()];
    const names = [...new Set(pick)].slice(0, MAX_CHARACTERS).map(k => ownByLc.get(k));
    const unlinked = want.filter(n => !ownByLc.has(n)).slice(0, MAX_CHARACTERS);

    const t = now();
    const stale = names.filter(n => { const c = cache.get(lc(n)); return !c || t - c.at >= cacheMs; });
    if (stale.length) {
      const held = await load(stale).catch(() => null);
      if (held) {
        for (const n of stale) cache.set(lc(n), { at: t, status: buildStatus(n, held.get(lc(n)) || []) });
      }
      // A failed read leaves the previous status (if any) in place and serves it; a character never read is left out.
    }
    const characters = {};
    for (const n of names) { const c = cache.get(lc(n)); if (c) characters[lc(n)] = c.status; }
    return { version: versionOf({ characters, unlinked }), characters, unlinked };
  }

  return { streamFor, invalidate, _cache: cache };
}

module.exports = { buildStatus, create, versionOf, DOOR_STEPS, MAX_CHARACTERS, CACHE_MS };
