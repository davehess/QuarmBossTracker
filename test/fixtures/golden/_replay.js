// test/fixtures/golden/_replay.js — the ONE replay harness shared by the
// golden-log test and the `npm run golden:update` regenerator.
//
// #75. Both the test and the updater must drive the agent through the exact
// same code path, or "update the golden" would bake in a different pipeline
// than the one under assertion. So the pipeline lives here, once.
//
// The pipeline mirrors the shipped watch-tail in
// packages/wolfpack-logsync/index.js (`if (!shouldKeep(...)) return; const ev =
// parseEvent(line, ts); if (ev) b.builder.add(ev);`) — the same three calls in
// the same order, with the same default pattern arrays. Nothing is re-implemented.
//
// NOT a spec file (no `.test.`/`.spec.`) — vitest won't collect it.

const fs   = require('node:fs');
const path = require('node:path');

// ── Determinism: pin the clock's timezone BEFORE the agent is required ──────
// parseEqTimestamp() does `new Date("Sun Aug 02 20:41:00 2026")`, which JS
// resolves in the PROCESS timezone. Every derived number that compares two
// timestamps is TZ-invariant, but `is_raid_window` is not — it re-projects the
// absolute instant into America/New_York. CI runs in UTC and a developer's box
// does not, so without this the golden would differ per machine.
process.env.TZ = 'America/New_York';

const FIXTURE_DIR = __dirname;
const AGENT_PATH  = path.resolve(__dirname, '..', '..', '..',
  'packages', 'wolfpack-logsync', 'index.js');

// Requiring the agent is safe: it only runs main() when invoked as a CLI
// (`require.main === module`), and it exports its internals for exactly this.
const agent = require(AGENT_PATH);

// ── The trigger gate, sliced from source (not re-implemented) ───────────────
// There are TWO filters a line passes through, and they have OPPOSITE defaults:
//   shouldKeep()         — default DROP. Gates parse + upload. Exported.
//   triggerVisibleLine() — default KEEP. Gates the local trigger/callout engine,
//                          so the privacy DROP list is the only thing standing
//                          between a /tell and a trigger fire. NOT exported.
// Recording only shouldKeep would make the golden blind to a privacy
// regression: deleting a drop pattern doesn't change shouldKeep's verdict
// (nothing in KEEP_PATTERNS matches a tell either), but it does open the
// trigger gate. So we slice the real function and the real PRIORITY_KEEP array
// out of the shipped source and eval them — same fidelity tier as
// test/privacy-filter.test.js, and zero edits to the agent.
const _agentSrc = fs.readFileSync(AGENT_PATH, 'utf8');

function _sliceBlock(start, end) {
  const a = _agentSrc.indexOf(start);
  if (a < 0) throw new Error(`golden: source marker not found: ${JSON.stringify(start)}`);
  const b = _agentSrc.indexOf(end, a);
  if (b < 0) throw new Error(`golden: source end marker not found: ${JSON.stringify(end)}`);
  return _agentSrc.slice(a, b + end.length);
}

// `const PRIORITY_KEEP_PATTERNS = [ … \n];` — bounded on '\n];' so a ']' inside
// a regex character class doesn't close it early.
const PRIORITY_KEEP_PATTERNS = (() => {
  const decl  = _agentSrc.indexOf('const PRIORITY_KEEP_PATTERNS');
  const open  = _agentSrc.indexOf('[', decl);
  const close = _agentSrc.indexOf('\n];', open);
  if (decl < 0 || open < 0 || close < 0) throw new Error('golden: PRIORITY_KEEP_PATTERNS not found');
  // eslint-disable-next-line no-new-func
  return new Function('return ' + _agentSrc.slice(open, close) + '\n]')();
})();

// The real function body. Its parameter defaults reference module-scope arrays
// that don't exist in this eval, so both are ALWAYS passed explicitly below.
const triggerVisibleLine = new Function(
  _sliceBlock('function triggerVisibleLine(line, drops', '\n  return true;\n}') +
  '\nreturn triggerVisibleLine;',
)();

const LOGS = {
  'raid-pull.log':    path.join(FIXTURE_DIR, 'raid-pull.log'),
  'line-families.log': path.join(FIXTURE_DIR, 'line-families.log'),
};

function readLog(name) {
  if (!LOGS[name]) throw new Error(`golden: unknown fixture log ${name}`);
  return fs.readFileSync(LOGS[name], 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
}

// ── Tier A: per-line filter + parse ─────────────────────────────────────────
// One row per log line: what the privacy/combat filter decided, and what the
// parser made of it. `keep` and `event` are the two shipped functions' verbatim
// return values — no post-processing, so a changed field value shows up.
function parseLines(logName) {
  return readLog(logName).map((line, i) => {
    const ts = agent.parseEqTimestamp(line);
    return {
      i,
      line,
      keep: agent.shouldKeep(line),
      // The trigger/callout gate. `false` here is the privacy guarantee: the
      // line can never reach a trigger, a TTS callout, or a trigger relay.
      trigger_visible: triggerVisibleLine(line, agent.DEFAULT_DROP_PATTERNS, PRIORITY_KEEP_PATTERNS),
      event: agent.parseEvent(line, ts) || null,
    };
  });
}

// ── Tier B: full encounter replay ───────────────────────────────────────────
// Drives EncounterBuilder exactly as the watch-tail does and returns the
// flushed upload payload (the object the bot's /api/agent/encounter receives).
function replayEncounter(logName, { character = 'Sylvarra' } = {}) {
  const payloads = [];
  const builder = new agent.EncounterBuilder({
    character,
    onFlush: (p) => payloads.push(p),
    silent:  true,   // no live-dashboard side-effects; upload path is identical
  });
  for (const line of readLog(logName)) {
    if (!agent.shouldKeep(line)) continue;
    const ts = agent.parseEqTimestamp(line);
    const ev = agent.parseEvent(line, ts);
    if (ev) builder.add(ev);
  }
  builder.flush();
  return payloads;
}

// ── The encounter DIGEST ────────────────────────────────────────────────────
// A projection WE own, not the raw payload. Rationale (see
// docs/DESIGN-75-golden-log.md): snapshotting the whole payload would break on
// every additive field and on `agent_version`, so the golden would get
// "updated" reflexively and stop being read. The digest keeps exactly the
// numbers a parser regression would move — event counts by type, per-attacker
// damage, tank/heal/charm aggregates, kill attribution — and drops everything
// volatile (agent_version, wall-clock `observedAt`, raw event array).
//
// Additive change to the payload  → digest unchanged → test still green.
// Changed parse result / arithmetic → digest changes  → test goes red.
// Non-finite numbers stringify to `null`, which would make a NaN in the payload
// indistinguishable from a legitimately-absent field — and NaN in this payload
// is a real thing (see the charm-session duration gap in
// docs/DESIGN-75-golden-log.md). Render them as "NaN"/"Infinity" so the golden
// file SHOWS the defect instead of hiding it, and so the file round-trips
// through JSON.parse unchanged (otherwise the test compares NaN to null).
function _jsonSafe(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return v.map(_jsonSafe);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, _jsonSafe(x)]));
  }
  return v;
}

function digestEncounter(payload) {
  const enc = payload.encounter;
  const byType = {};
  for (const ev of enc.events) byType[ev.type] = (byType[ev.type] || 0) + 1;

  const damageByAttacker = {};
  const damageByDefender = {};
  for (const ev of enc.events) {
    if (ev.type !== 'damage') continue;
    const amt = Number(ev.amount) || 0;
    const atk = ev.attacker == null ? '__SELF__' : ev.attacker;
    damageByAttacker[atk] = (damageByAttacker[atk] || 0) + amt;
    if (ev.defender != null) {
      damageByDefender[ev.defender] = (damageByDefender[ev.defender] || 0) + amt;
    }
  }

  const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

  return _jsonSafe({
    character:        payload.character,
    boss_name:        enc.boss_name,
    confirmed_kill:   enc.confirmed_kill,
    kill_slayer:      enc.kill_slayer ?? null,
    kill_credit:      enc.kill_credit ?? null,
    is_raid_window:   enc.is_raid_window ?? false,
    active_duration_s: enc.active_duration_s,
    started_at:       enc.started_at,
    ended_at:         enc.ended_at,
    boss_max_melee:   enc.boss_max_melee ?? null,
    event_count:      enc.events.length,
    events_by_type:   sortKeys(byType),
    damage_by_attacker: sortKeys(damageByAttacker),
    damage_by_defender: sortKeys(damageByDefender),
    pet_leaders:      enc.pet_leaders ?? null,
    defenders: (enc.defenders || [])
      .map((d) => ({
        name: d.name, hits: d.hits ?? 0, damageTaken: d.damageTaken ?? 0,
        misses: d.misses ?? 0, dodges: d.dodges ?? 0, parries: d.parries ?? 0,
        ripostes: d.ripostes ?? 0, blocks: d.blocks ?? 0, invulns: d.invulns ?? 0,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    healers: (enc.healers || [])
      .map((h) => ({ name: h.name, healed: h.healed, ticks: h.ticks, targets: [...h.targets].sort() }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    heals_received: enc.heals_received
      ? { name: enc.heals_received.name, total: enc.heals_received.total, ticks: enc.heals_received.ticks }
      : null,
    deaths: (enc.deaths || [])
      .map((d) => ({ name: d.name, riposteDeath: !!d.riposteDeath }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
    ds_reflects: enc.ds_reflects
      ? sortKeys(Object.fromEntries(Object.entries(enc.ds_reflects)
          .map(([k, v]) => [k, { count: v.count, total: v.total, min: v.min, max: v.max }])))
      : null,
    charm_sessions: (enc.charm_sessions || [])
      .map((c) => ({ pet: c.pet ?? null, owner: c.owner ?? null, end_reason: c.end_reason ?? null,
                     duration_sec: c.duration_sec ?? null, damage: c.damage ?? null }))
      .sort((a, b) => ((a.pet + String(a.duration_sec)) < (b.pet + String(b.duration_sec)) ? -1 : 1)),
    rollup: enc.rollup
      ? sortKeys(Object.fromEntries(Object.entries(enc.rollup.by_char).map(([name, b]) => [name, {
          total_hits: b.total_hits, total_damage: b.total_damage,
          self_attack_count: b.self_attack_count, by_skill: sortKeys(b.by_skill),
        }])))
      : null,
    // /who rows carry a wall-clock `observedAt` — keep the identity fields only.
    who_data: (enc.who_data || [])
      .map((w) => ({ name: w.name, level: w.level ?? null, class: w.class ?? null,
                     race: w.race ?? null, guild: w.guild ?? null,
                     anonymous: !!w.anonymous, gm: !!w.gm, zone: w.zone ?? null }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  });
}

module.exports = {
  agent, LOGS, readLog, parseLines, replayEncounter, digestEncounter,
  triggerVisibleLine, PRIORITY_KEEP_PATTERNS,
};
