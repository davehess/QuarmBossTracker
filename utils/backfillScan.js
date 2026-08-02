// utils/backfillScan.js — outcome-driven backfill requests (#f3).
//
// Hitya, 2026-08-02: "backfill requests based on outcomes where we have bad
// data would be great. if one player reported 200% of a mobs HP was taken while
// others had less, we should look for the bystanders that were there from the
// tick that we saw doing melee damage, ideally tanks or those that did not die."
//
// Two halves, and BOTH of them are the point:
//
//   DETECT — find the fights where the data is demonstrably wrong, from
//            evidence, not from a hunch. Grounded in the 2026-07-30 incident
//            (docs/STATUS.md, `state.petOwners` night-accumulation): one
//            uploader per fight carried stale charm residue and reported far
//            more damage than the mob could possibly have — Hawkner 380k on a
//            200k Blood of Ssraeshza, Bardtholemu 3.05M on the Emperor,
//            Uilnayar 338k on Rhag`Mozdezh.
//
//   TARGET — ask the two or three people whose log would actually SETTLE it,
//            not everyone who was in the zone. The 92 stale `pending` rows in
//            `agent_backfill_requests` are the counter-example: filed at 58
//            characters, of whom **50 have never uploaded a contribution in
//            their life**. They will sit pending forever. That backlog isn't a
//            lifecycle bug, it's a targeting bug.
//
// This module GENERATES rows for the existing `agent_backfill_requests`
// pipeline (bot `GET /api/agent/backfill-requests` + the `/poll` bundle → the
// agent dashboard's 📋 banner). It builds no new mechanism, and it never
// DMs anybody — delivery stays pull-based, exactly as it is today.
//
// NOTHING HERE FIRES ON A TIMER. `/backfillscan` previews by default and only
// writes when an officer passes `apply:true`. Automatic filing needs Hitya's
// sign-off first — see docs/DESIGN-outcome-backfill.md §"Why officer-triggered".
//
// Layers (so the whole thing is unit-testable with no Supabase and no Discord —
// see test/backfill-scan.test.js, whose fixtures are the verbatim 2026-07-30
// night):
//     pure   resolveHpPool / findInflated / findCoverageGap / rankAskCandidates
//            buildRequestRows / renderScanEmbeds / expirySweepIds
//     fetch  collectScanData / scanWindow
//     write  applyProposals / expireStale        (officer-triggered only)

const { EmbedBuilder } = require('discord.js');
const mobSpecials = require('./mobSpecials');
const { dedupParseDeaths } = require('./parseDeaths');

// ── Thresholds ───────────────────────────────────────────────────────────────
// Every number here was tuned against the live corpus (3,281 contributions /
// 1,494 encounters, 2026-05-28 → 2026-08-02). The derivation and the measured
// hit rates are in docs/DESIGN-outcome-backfill.md §"Thresholds".

// A fight needs a real consensus before one upload can be called the odd one
// out. Below this the "median of the others" is one or two numbers.
const MIN_CONTRIBS = 4;

// Damage vs the mob's catalog HP pool. Measured: across 224 confirmed kills
// with >= 4 uploads, the CONSENSUS (median upload) never exceeded 1.13x the
// pool and sits at 0.90-1.00 for the mode. 1.30 leaves 15% headroom over
// anything the corpus has ever produced legitimately.
const HP_RATIO = 1.30;

// Damage vs the median of the OTHER uploads on the same fight. On its own this
// fires on 21% of uploads (a wider view is normal); paired with the HP anchor
// it fires on 1.1%. Both gates, always.
const MEDIAN_RATIO = 1.50;

// Coverage gap: a CONFIRMED kill whose merged damage is under this share of the
// pool means most of the fight simply never reached us. 0.35 is far outside the
// legitimate band (mode 0.90-1.00) and lands at ~1 fight per raid night.
const THIN_RATIO = 0.35;

// Presence proofs. Melee swings landed on the target prove melee range for as
// long as they span; a single stray hit does not.
const MELEE_HIT_FLOOR    = 20;
const DEFENDER_HIT_FLOOR = 10;
const PRESENT_FRACTION   = 0.60;   // observed for >= 60% of the fight

// How recently a character must have uploaded ANYTHING for an ask to be worth
// filing. The whole point of the exercise.
const ACTIVE_UPLOADER_DAYS = 14;

// Volume caps — a scan must never turn into a mailshot.
const MAX_ASKS_PER_FINDING = 3;
const MAX_ASKS_PER_SCAN    = 8;
const MAX_ASKS_PER_PERSON  = 2;

// A pending request whose log window is older than this can't be honoured:
// eqlog files roll, users delete them, and the ask has decayed to noise.
const EXPIRY_HORIZON_DAYS = 45;

const TANK_CLASSES = new Set(['Warrior', 'Paladin', 'Shadow Knight']);

// `encounter_combat_rollup.by_skill` verbs that are MELEE swings on the target.
// Verbatim from the live rollup vocabulary (34,476 rows, 2026-08-02); the
// non-melee keys there are `non-melee`, `ds:non-melee`, `pet`, `warder` and
// literal spell names, none of which prove you were standing in range.
const MELEE_VERBS = new Set([
  'hit', 'slash', 'kick', 'bash', 'pierce', 'crush', 'punch', 'backstab',
  'slice', 'bite', 'claw', 'strike', 'maul', 'smash', 'gore', 'rend',
]);

function _num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function _ms(v) { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : 0; }
function _lc(s) { return String(s == null ? '' : s).toLowerCase(); }

/** Median of a numeric array. [] → null (never 0 — 0 would divide wrong). */
function median(nums) {
  const s = (Array.isArray(nums) ? nums : []).map(_num).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── Pure: the HP pool ────────────────────────────────────────────────────────

/**
 * The mob's real health pool for `npcId`, via the #171 pick-and-merge ladder.
 *
 * This is NOT `eqemu_npc_types.hp` on the keyed row, and the difference is
 * load-bearing. `encounters.npc_id` points at whichever body the name resolved
 * to at ingest, which for the Emperor is `#Emperor_Ssraeshza` (162065) — a
 * level-1-style PLACEHOLDER carrying 1,000,000 hp and AC 200. The body the raid
 * actually killed is `Emperor_Ssraeshza_` (162491): 1,250,000 hp, AC 700. Using
 * the keyed row would score the clean 1.18M consensus at 1.18x pool — inside
 * shouting distance of the 1.30 gate — instead of the true 0.94x.
 *
 * `rows` is every eqemu_npc_types row matching the name family; the zone comes
 * from the npc id itself (id = zoneid*1000 + n, #141), so the ladder never
 * reaches into another zone's same-named god.
 *
 * @returns {{ hpPool: number|null, rowId: number|null, scope: string, keyedWasPlaceholder: boolean }}
 */
function resolveHpPool(rows, { npcId, keyedRow = null } = {}) {
  const picked = mobSpecials.pickAndMergeMobRows(rows, { zoneId: mobSpecials.zoneIdOf(npcId) });
  const hp = _num(picked.row && picked.row.hp);
  return {
    hpPool: hp > 0 ? hp : null,
    rowId: picked.row ? picked.row.id : null,
    scope: picked.scope,
    keyedWasPlaceholder: !!(keyedRow && mobSpecials.isPlaceholder(keyedRow.special_abilities)),
  };
}

// ── Pure: detection ──────────────────────────────────────────────────────────

/**
 * Signal 1 — INFLATED. One upload claims more damage than the mob has health
 * AND more than everyone else standing next to it saw.
 *
 * Both gates matter and neither works alone:
 *   · the HP anchor alone can't separate a corrupt upload from a legitimately
 *     merged double-kill (find_or_create_encounter's ±30min window) — in that
 *     case EVERY upload overshoots together;
 *   · the sibling-median gate alone fires on 21% of uploads, because a parser
 *     positioned to see more of the raid legitimately reports more than one
 *     stuck behind a wall. Distance culling makes the LOW side normal; it is
 *     the high side, past the mob's own health bar, that cannot be real.
 *
 * `contribs`: [{ id, character, damage, playerCount, durationSec, agentVersion }]
 * (`damage` is the upload's own total, not the merged encounter total).
 */
function findInflated(enc, contribs, hpPool, opts = {}) {
  const minContribs  = opts.minContribs  != null ? opts.minContribs  : MIN_CONTRIBS;
  const hpRatioGate  = opts.hpRatio      != null ? opts.hpRatio      : HP_RATIO;
  const medRatioGate = opts.medianRatio  != null ? opts.medianRatio  : MEDIAN_RATIO;

  const list = (Array.isArray(contribs) ? contribs : []).filter(c => c && c.character);
  if (list.length < minContribs) return [];
  if (!(hpPool > 0)) return [];                     // unknown pool → never guess

  const out = [];
  for (const c of list) {
    const dmg = _num(c.damage);
    if (dmg <= 0) continue;
    const sibling = median(list.filter(o => o !== c).map(o => _num(o.damage)));
    if (!(sibling > 0)) continue;
    const hpRatio  = dmg / hpPool;
    const medRatio = dmg / sibling;
    if (hpRatio < hpRatioGate || medRatio < medRatioGate) continue;
    out.push({
      kind: 'inflated',
      encounterId: enc && enc.id,
      npcName: cleanBossName(enc && enc.npcName),
      startedAt: enc && enc.startedAt,
      durationSec: _num(enc && enc.durationSec),
      contributionId: c.id || null,
      character: c.character,
      agentVersion: c.agentVersion || null,
      damage: dmg,
      siblingMedian: sibling,
      hpPool,
      hpRatio,
      medianRatio: medRatio,
      playerCount: _num(c.playerCount) || null,
      siblingPlayerCount: median(list.filter(o => o !== c).map(o => _num(o.playerCount))),
      severity: hpRatio * medRatio,
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

/**
 * Signal 2 — THIN. A confirmed kill whose merged damage is a fraction of the
 * mob's health: nobody's log covered the fight. Lower priority than INFLATED
 * (nothing is WRONG, we're just missing most of it) but it's the case where a
 * backfill genuinely ADDS data rather than adjudicating between two claims.
 *
 * Only ever fires on `killed` — an unconfirmed engagement is SUPPOSED to be
 * short on damage, that's what "we didn't kill it" looks like in a parse.
 */
function findCoverageGap(enc, hpPool, opts = {}) {
  const gate = opts.thinRatio != null ? opts.thinRatio : THIN_RATIO;
  if (!enc || !enc.killed) return null;
  if (!(hpPool > 0)) return null;
  const total = _num(enc.totalDamage);
  if (!(total > 0)) return null;                    // no parse at all is a different problem
  const ratio = total / hpPool;
  if (ratio >= gate) return null;
  return {
    kind: 'thin',
    encounterId: enc.id,
    npcName: cleanBossName(enc.npcName),
    startedAt: enc.startedAt,
    durationSec: _num(enc.durationSec),
    totalDamage: total,
    hpPool,
    coverage: ratio,
    severity: 1 - ratio,
  };
}

// ── Pure: targeting ──────────────────────────────────────────────────────────

/** Melee swings this character landed on the target, from one rollup row. */
function meleeHitsOf(rollupRow) {
  const by = rollupRow && rollupRow.by_skill;
  if (!by || typeof by !== 'object') return 0;
  let hits = 0;
  for (const [verb, v] of Object.entries(by)) {
    if (!MELEE_VERBS.has(verb)) continue;
    hits += _num(v && v.hits);
  }
  return hits;
}

/**
 * Rank the bystanders whose log would settle this fight.
 *
 * Hitya's three criteria, in order of how hard they are to fake:
 *   1. THERE, AND IN RANGE — melee swings landed on the target (>= 20, so a
 *      stray proc doesn't qualify), or they were being hit by it. You cannot
 *      melee a mob you were culled away from, so this is a positional proof,
 *      not a guess.
 *   2. THERE FOR THE WHOLE THING — observed for >= 60% of the fight. A log that
 *      starts halfway can't adjudicate the first half.
 *   3. A GOOD VANTAGE POINT — tank classes and whoever actually took the mob's
 *      hits stood in the middle of it all night; and a raider who DIDN'T die
 *      has no gap in their log (a corpse stops seeing the fight).
 *
 * Then two hard gates that have nothing to do with the fight:
 *   · they must actually run the agent (uploaded something in the last 14
 *     days) — 50 of the 58 characters in the stale pending backlog never have;
 *   · they must not already have uploaded THIS fight — we'd learn nothing.
 *
 * Returns [{ name, score, why: [...] }], best first, deterministic on ties.
 */
function rankAskCandidates(input = {}) {
  const durationSec   = _num(input.durationSec);
  const present       = Array.isArray(input.present) ? input.present : [];
  const meleeBy       = input.meleeHitsByName instanceof Map ? input.meleeHitsByName : new Map();
  const defBy         = input.defenderByName  instanceof Map ? input.defenderByName  : new Map();
  const classBy       = input.classByName     instanceof Map ? input.classByName     : new Map();
  const died          = input.diedNames       instanceof Set ? input.diedNames       : new Set();
  const active        = input.activeUploaders instanceof Set ? input.activeUploaders : new Set();
  const uploadedThis  = input.alreadyUploaded instanceof Set ? input.alreadyUploaded : new Set();
  const excluded      = input.excluded        instanceof Set ? input.excluded        : new Set();
  const alreadyAsked  = input.alreadyAsked    instanceof Set ? input.alreadyAsked    : new Set();

  const rows = [];
  for (const p of present) {
    const name = p && p.name;
    if (!name) continue;
    const key = _lc(name);
    if (excluded.has(key) || uploadedThis.has(key) || alreadyAsked.has(key)) continue;
    if (!active.has(key)) continue;                       // no agent → no point

    const melee = _num(meleeBy.get(key));
    const def   = defBy.get(key) || null;
    const defHits = _num(def && def.hits);
    const inRange = melee >= MELEE_HIT_FLOOR || defHits >= DEFENDER_HIT_FLOOR;
    if (!inRange) continue;                               // presence not PROVEN

    const klass    = classBy.get(key) || null;
    const observed = _num(p.observedDurationSec);
    const fullFight = durationSec > 0 && observed >= PRESENT_FRACTION * durationSec;
    const taken    = _num(def && def.damageTaken);
    const isDead   = died.has(key);

    const why = [];
    let score = 0;
    if (melee >= MELEE_HIT_FLOOR) { score += 40; why.push(`${melee} melee swings on it`); }
    if (fullFight)                { score += 25; why.push('there for the whole fight'); }
    if (klass && TANK_CLASSES.has(klass)) { score += 20; why.push(klass.toLowerCase()); }
    if (taken >= 2000)            { score += 15; why.push(`took ${Math.round(taken / 1000)}k from it`); }
    if (isDead)                   { score -= 25; why.push('died — log has a gap'); }
    else                          { score += 10; why.push('never died'); }

    rows.push({ name, score, melee, defHits, taken, klass, died: isDead, observedDurationSec: observed, why });
  }

  // Deterministic ordering: score, then the two hardest presence proofs, then
  // the name — so two runs of the same scan ask the same people.
  rows.sort((a, b) =>
    b.score - a.score ||
    b.melee - a.melee ||
    b.taken - a.taken ||
    String(a.name).localeCompare(String(b.name)));
  return rows;
}

// ── Pure: the ask ────────────────────────────────────────────────────────────

function cleanBossName(raw) {
  if (!raw) return 'that fight';
  return String(raw).replace(/^#/, '').replace(/_/g, ' ').trim() || 'that fight';
}

function fmtDmg(n) {
  const v = _num(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

/** "Thu Jul 30" in UTC-agnostic short form — enough for a raider to place it. */
function fmtDay(iso) {
  const ms = _ms(iso);
  if (!ms) return 'that night';
  // Raids run past midnight ET, so a fight at 02:35Z belongs to the night
  // BEFORE in everyone's head. Pull back 6h, same rollover the review uses.
  return new Date(ms - 6 * 3_600_000).toUTCString().slice(0, 11).trim();
}

/**
 * The sentence a raider actually reads, in their own agent dashboard.
 *
 * Rules, and they are not decoration:
 *   · never name the over-reporting uploader. Every one of these has been a
 *     PARSER bug (stale `state.petOwners` residue, a finishing-blow line, an
 *     over-long session blob). Naming a raider next to "the numbers are wrong"
 *     turns a data-quality chore into an accusation.
 *   · say what we think is wrong, why THEY were picked, and that nobody is in
 *     trouble. The agent card renders this verbatim.
 *   · <= 300 chars — the web filing form already truncates there.
 */
function requestReason(finding, candidate) {
  const mob = finding.npcName;
  const day = fmtDay(finding.startedAt);
  const proof = (candidate && candidate.why && candidate.why[0]) || 'you were on it';
  if (finding.kind === 'thin') {
    return (`We only got a partial parse for ${mob} on ${day} — most of the fight's damage never reached us. ` +
            `You were in on it (${proof}), so re-running that log would fill the hole. Nothing you did wrong!`).slice(0, 300);
  }
  return (`We think the ${mob} parse from ${day} is off — one upload reports more damage than the mob has health, ` +
          `and the others disagree. You were in melee on it (${proof}), so your log would settle it. ` +
          `Nobody's in trouble — we're chasing a parser bug.`).slice(0, 300);
}

/**
 * Turn findings + their ranked candidates into `agent_backfill_requests` rows.
 *
 * `scope.start_iso` is the encounter's `started_at` VERBATIM, because that is
 * the key both the unique index (guild_id, character, scope->>'start_iso') and
 * the /admin/encounters "already pinged" display match on. A padded start would
 * quietly duplicate an officer's manual filing for the same fight.
 */
function buildRequestRows(findings, opts = {}) {
  const guildId   = opts.guildId || 'wolfpack';
  const byName    = opts.requestedByName || 'Wolf Pack parse check';
  const byId      = opts.requestedByDiscordId || null;
  const perFind   = opts.maxPerFinding != null ? opts.maxPerFinding : MAX_ASKS_PER_FINDING;
  const perScan   = opts.maxPerScan    != null ? opts.maxPerScan    : MAX_ASKS_PER_SCAN;
  const perPerson = opts.maxPerPerson  != null ? opts.maxPerPerson  : MAX_ASKS_PER_PERSON;

  // INFLATED before THIN, then by severity — the caps spend on the worst data.
  const ordered = (Array.isArray(findings) ? findings : []).slice().sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'inflated' ? -1 : 1) || (b.severity || 0) - (a.severity || 0));

  const rows = [];
  const askedCount = new Map();
  for (const f of ordered) {
    if (rows.length >= perScan) break;
    const cands = Array.isArray(f.candidates) ? f.candidates : [];
    let filed = 0;
    for (const c of cands) {
      if (filed >= perFind || rows.length >= perScan) break;
      const key = _lc(c.name);
      if ((askedCount.get(key) || 0) >= perPerson) continue;
      askedCount.set(key, (askedCount.get(key) || 0) + 1);
      filed++;
      const startIso = f.startedAt;
      const endMs    = _ms(startIso) + Math.max(_num(f.durationSec) + 300, 600) * 1000;
      rows.push({
        guild_id: guildId,
        character: c.name,
        requested_by_discord_id: byId,
        requested_by_name: byName,
        reason: requestReason(f, c),
        scope: {
          start_iso: startIso,
          end_iso: new Date(endMs).toISOString(),
          types: ['encounter'],
          // Provenance, so a future officer can tell an auto-ask from a manual
          // one without reading the prose. Ignored by the agent.
          source: 'outcome-scan',
          signal: f.kind,
          encounter_id: f.encounterId || null,
        },
      });
    }
  }
  return rows;
}

/**
 * Which of the open requests are past the horizon and can be retired.
 * Returns ids only — the caller decides whether to write. NEVER deletes:
 * `expired` is a new terminal status, and the agent's poll filter
 * (`status=in.(pending,acked,running)`) already drops it with no code change.
 */
function expirySweepIds(rows, opts = {}) {
  const horizonDays = opts.horizonDays != null ? opts.horizonDays : EXPIRY_HORIZON_DAYS;
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const cutoff = nowMs - horizonDays * 86_400_000;
  const out = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || !r.id) continue;
    if (!['pending', 'acked', 'running'].includes(r.status)) continue;
    // The LOG window is what expired, not the filing date — a request filed
    // today against a two-month-old fight is equally unhonourable.
    const end = _ms(r.scope && (r.scope.end_iso || r.scope.start_iso)) || _ms(r.requested_at);
    if (end && end < cutoff) out.push(r.id);
  }
  return out;
}

// ── Pure: rendering ──────────────────────────────────────────────────────────

function _pct(x) { return `${Math.round(_num(x) * 100)}%`; }

/** The officer-facing preview. Pure — takes a scan, returns EmbedBuilder[]. */
function renderScanEmbeds(scan) {
  const s = scan || {};
  const findings = Array.isArray(s.findings) ? s.findings : [];
  const rows     = Array.isArray(s.proposals) ? s.proposals : [];
  const embed = new EmbedBuilder()
    .setColor(findings.length ? 0xd29922 : 0x2ea043)
    .setTitle('🔎 Backfill scan')
    .setDescription(
      `${s.scanned || 0} encounter(s) checked · **${findings.length}** with bad data · ` +
      `**${rows.length}** ask(s) ${s.applied ? 'filed' : 'proposed'}`);

  if (!findings.length) {
    embed.addFields({ name: 'Result', value: 'Nothing looks wrong. No requests to file.', inline: false });
  }

  for (const f of findings.slice(0, 8)) {
    const cands = Array.isArray(f.candidates) ? f.candidates : [];
    const lines = [];
    if (f.kind === 'inflated') {
      lines.push(`One upload: **${fmtDmg(f.damage)}** = **${_pct(f.hpRatio)}** of the ${fmtDmg(f.hpPool)} HP pool`);
      lines.push(`Everyone else's median: ${fmtDmg(f.siblingMedian)} (**${f.medianRatio.toFixed(2)}×** disagreement)`);
      if (f.playerCount && f.siblingPlayerCount) {
        lines.push(`Players named: ${f.playerCount} vs ${Math.round(f.siblingPlayerCount)} consensus`);
      }
      if (f.agentVersion) lines.push(`Uploader agent ${f.agentVersion}`);
    } else {
      lines.push(`Confirmed kill, but only **${fmtDmg(f.totalDamage)}** = **${_pct(f.coverage)}** of the ${fmtDmg(f.hpPool)} HP pool reached us`);
    }
    lines.push(cands.length
      ? `**Ask:** ${cands.slice(0, MAX_ASKS_PER_FINDING).map(c => `${c.name} _(${c.why.slice(0, 2).join(', ')})_`).join(' · ')}`
      : '**Ask:** nobody qualifies — no proven bystander runs the agent');
    embed.addFields({
      name: `${f.kind === 'inflated' ? '⚠️' : '🕳️'} ${f.npcName} — ${fmtDay(f.startedAt)}`,
      value: lines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  if (s.expirable && s.expirable.length) {
    embed.addFields({
      name: '🧹 Stale backlog',
      value: `${s.expirable.length} open request(s) are past the ${EXPIRY_HORIZON_DAYS}-day log horizon` +
             `${s.expired ? ' — retired' : ' — run with `expire:true` to retire them'}.`,
      inline: false,
    });
  }
  if (!s.applied && rows.length) {
    embed.setFooter({ text: 'Preview only — re-run with apply:true to file these.' });
  }
  return [embed];
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Everything a scan needs for one time window. Bounded, best-effort; a failed
 * sub-select degrades the scan (fewer signals) rather than throwing.
 *
 * NOTE ON RETENTION: `contributions.raw_parse` is nulled by the midnight
 * compaction after 7 days, so `defenders` / `deaths` only exist for recent
 * nights. `encounter_combat_rollup` is NOT compacted (100% coverage over 30d),
 * so the melee-presence proof survives. Detection itself only needs the durable
 * columns (`total_damage`, `player_count`). The scan is still meant to run on a
 * recent night — a raider's eqlog has usually rolled by the time an old fight
 * is worth chasing.
 */
async function collectScanData({ fromMs, toMs }) {
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return null;
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const fromIso = new Date(fromMs).toISOString();
  const toIso   = new Date(toMs).toISOString();
  const enc = (encodeURIComponent);

  const encounters = await supabase.select('encounters',
    'select=id,npc_id,started_at,ended_at,duration_sec,total_damage,classification,' +
    'eqemu_npc_types(name,hp,special_abilities),encounter_players(character_name,total_damage,duration_sec)' +
    `&guild_id=eq.${enc(guildId)}` +
    `&started_at=gte.${enc(fromIso)}&started_at=lt.${enc(toIso)}` +
    '&order=started_at.asc&limit=200') || [];

  const ids = encounters.map(e => e.id).filter(Boolean);
  // UUIDs and names only — strict whitelist keeps the PostgREST in-list
  // quote-free and injection structurally impossible (same rule raidReview uses).
  const inList = arr => `(${arr.map(v => String(v).replace(/[^A-Za-z0-9_-]/g, '')).join(',')})`;

  const activeSince = new Date(Date.now() - ACTIVE_UPLOADER_DAYS * 86_400_000).toISOString();
  const [contribs, rollups, characters, activeRows, openRequests, npcRows] = await Promise.all([
    ids.length ? supabase.select('contributions',
      'select=id,encounter_id,contributor_character,total_damage,player_count,duration_sec,agent_version,' +
      'defenders:raw_parse->defenders,deaths:raw_parse->deaths,players:raw_parse->players' +
      `&encounter_id=in.${inList(ids)}&limit=4000`) : [],
    ids.length ? supabase.select('encounter_combat_rollup',
      `select=encounter_id,character_name,by_skill&encounter_id=in.${inList(ids)}&limit=8000`) : [],
    supabase.select('characters',
      `select=name,class,exclude_from_stats&guild_id=eq.${enc(guildId)}&limit=3000`),
    supabase.select('contributions',
      `select=contributor_character&created_at=gte.${enc(activeSince)}&limit=5000`),
    supabase.select('agent_backfill_requests',
      `select=id,character,scope,status,requested_at&guild_id=eq.${enc(guildId)}` +
      '&status=in.(pending,acked,running)&limit=1000'),
    _npcFamilyRows(supabase, encounters),
  ]).catch(() => [[], [], [], [], [], new Map()]);

  return {
    window: { fromMs, toMs },
    encounters,
    contribs: contribs || [],
    rollups: rollups || [],
    characters: characters || [],
    activeUploaders: new Set((activeRows || []).map(r => _lc(r.contributor_character)).filter(Boolean)),
    openRequests: openRequests || [],
    npcFamilyRows: npcRows instanceof Map ? npcRows : new Map(),
  };
}

/**
 * Every eqemu_npc_types row in the same NAME FAMILY as each encounter's npc,
 * keyed by npc_id. The family is the plain name, the #-prefixed form, and the
 * one-trailing-character form — Quarm's real Emperor body is literally
 * `Emperor_Ssraeshza_` (trailing space) while the keyed row is the placeholder
 * `#Emperor_Ssraeshza`. PostgREST `ilike` treats `_` as a single-char wildcard,
 * so the trailing-underscore pattern picks that sibling up.
 */
async function _npcFamilyRows(supabase, encounters) {
  const out = new Map();
  const wanted = new Map();               // normalized base → [npcIds]
  for (const e of (encounters || [])) {
    const raw = e && e.eqemu_npc_types && e.eqemu_npc_types.name;
    if (!raw || !e.npc_id) continue;
    const base = String(raw).replace(/^#/, '');
    const arr = wanted.get(base) || [];
    arr.push(e.npc_id);
    wanted.set(base, arr);
  }
  const sel = 'select=id,name,level,maxlevel,hp,runspeed,special_abilities,npcspecialattks&limit=200';
  await Promise.all([...wanted.entries()].map(async ([base, npcIds]) => {
    try {
      const p = encodeURIComponent(base);
      const rows = await supabase.select('eqemu_npc_types',
        `or=(name.ilike.${p},name.ilike.${encodeURIComponent('#' + base)},name.ilike.${encodeURIComponent(base + '_')})&${sel}`);
      for (const id of npcIds) out.set(id, Array.isArray(rows) ? rows : []);
    } catch { /* one mob failing must not kill the scan */ }
  }));
  return out;
}

/** Nothing about the scan may leak an excluded character. */
function _excludedSet(characters) {
  const s = new Set();
  for (const c of (characters || [])) if (c && c.exclude_from_stats && c.name) s.add(_lc(c.name));
  return s;
}

/**
 * Run the detectors + the ranker over one window. Pure-ish: takes the bundle
 * `collectScanData` returns, does no I/O of its own, returns the whole proposal.
 */
function analyzeScanData(data, opts = {}) {
  if (!data) return { scanned: 0, findings: [], proposals: [], expirable: [] };
  const excluded = _excludedSet(data.characters);
  const classBy  = new Map((data.characters || [])
    .filter(c => c && c.name).map(c => [_lc(c.name), c.class || null]));

  const contribsByEnc = new Map();
  for (const c of (data.contribs || [])) {
    if (!c || !c.encounter_id) continue;
    const arr = contribsByEnc.get(c.encounter_id) || [];
    arr.push(c);
    contribsByEnc.set(c.encounter_id, arr);
  }
  const rollupByEnc = new Map();
  for (const r of (data.rollups || [])) {
    if (!r || !r.encounter_id) continue;
    const m = rollupByEnc.get(r.encounter_id) || new Map();
    m.set(_lc(r.character_name), Math.max(_num(m.get(_lc(r.character_name))), meleeHitsOf(r)));
    rollupByEnc.set(r.encounter_id, m);
  }
  // Open asks keyed by the start_iso they were filed against — the same exact
  // string match /admin/encounters uses to grey out "already pinged".
  const askedByStart = new Map();
  for (const r of (data.openRequests || [])) {
    const si = r && r.scope && r.scope.start_iso ? String(r.scope.start_iso) : '';
    if (!si || !r.character) continue;
    const set = askedByStart.get(si) || new Set();
    set.add(_lc(r.character));
    askedByStart.set(si, set);
  }

  const findings = [];
  let scanned = 0;
  for (const e of (data.encounters || [])) {
    if (!e || !e.id) continue;
    if (e.classification === 'foreign') continue;         // someone else's raid
    scanned++;
    const family = data.npcFamilyRows.get(e.npc_id) || (e.eqemu_npc_types ? [{ ...e.eqemu_npc_types, id: e.npc_id }] : []);
    const { hpPool } = resolveHpPool(family, { npcId: e.npc_id, keyedRow: e.eqemu_npc_types });
    const raw = contribsByEnc.get(e.id) || [];
    const encShape = {
      id: e.id,
      npcName: e.eqemu_npc_types && e.eqemu_npc_types.name,
      startedAt: e.started_at,
      durationSec: _num(e.duration_sec),
      totalDamage: _num(e.total_damage),
      killed: e.ended_at != null,
    };
    const contribShape = raw.map(c => ({
      id: c.id,
      character: c.contributor_character,
      damage: _num(c.total_damage),
      playerCount: _num(c.player_count),
      durationSec: _num(c.duration_sec),
      agentVersion: c.agent_version,
    }));

    const hits = findInflated(encShape, contribShape, hpPool, opts);
    const thin = hits.length ? null : findCoverageGap(encShape, hpPool, opts);
    const found = hits.slice(0, 1).concat(thin ? [thin] : []);   // one ask-worthy finding per fight
    if (!found.length) continue;

    // ── targeting inputs, assembled once per encounter
    const players = (e.encounter_players || []).filter(p => p && p.character_name);
    const observedByName = new Map();
    for (const c of raw) {
      for (const p of (Array.isArray(c.players) ? c.players : [])) {
        if (!p || !p.name) continue;
        const k = _lc(p.name);
        const arr = observedByName.get(k) || [];
        arr.push(_num(p.duration));
        observedByName.set(k, arr);
      }
    }
    const defenderByName = new Map();
    for (const c of raw) {
      for (const d of (Array.isArray(c.defenders) ? c.defenders : [])) {
        if (!d || !d.name) continue;
        const k = _lc(d.name);
        const cur = defenderByName.get(k) || { hits: 0, damageTaken: 0 };
        cur.hits = Math.max(cur.hits, _num(d.hits));
        cur.damageTaken = Math.max(cur.damageTaken, _num(d.damageTaken));
        defenderByName.set(k, cur);
      }
    }
    // #134 dedup, reused not re-derived — phantom NPC-namesake deaths must not
    // disqualify a live raider from being asked.
    const diedNames = new Set(dedupParseDeaths(raw.map(c => (Array.isArray(c.deaths) ? c.deaths : [])))
      .map(d => _lc(d.name)));
    const alreadyUploaded = new Set(raw.map(c => _lc(c.contributor_character)).filter(Boolean));

    for (const f of found) {
      const ex = new Set(excluded);
      if (f.character) ex.add(_lc(f.character));          // never ask the suspect
      f.candidates = rankAskCandidates({
        durationSec: encShape.durationSec,
        present: players.map(p => ({
          name: p.character_name,
          observedDurationSec: median(observedByName.get(_lc(p.character_name)) || []) ?? _num(p.duration_sec),
        })),
        meleeHitsByName: rollupByEnc.get(e.id) || new Map(),
        defenderByName,
        classByName: classBy,
        diedNames,
        activeUploaders: data.activeUploaders,
        alreadyUploaded,
        excluded: ex,
        alreadyAsked: askedByStart.get(String(encShape.startedAt)) || new Set(),
      });
      findings.push(f);
    }
  }

  const proposals = buildRequestRows(findings, opts);
  const expirable = expirySweepIds(data.openRequests, opts);
  return { scanned, findings, proposals, expirable };
}

/** collect + analyze. Never throws — returns a scan shape with a `reason`. */
async function scanWindow({ fromMs, toMs }, opts = {}) {
  try {
    const data = await collectScanData({ fromMs, toMs });
    if (!data) return { scanned: 0, findings: [], proposals: [], expirable: [], reason: 'supabase-disabled' };
    return analyzeScanData(data, opts);
  } catch (err) {
    console.warn('[backfill-scan] failed:', err && err.message);
    return { scanned: 0, findings: [], proposals: [], expirable: [], reason: 'error', error: err && err.message };
  }
}

// ── Write (officer-triggered only) ───────────────────────────────────────────

/**
 * File the proposed rows. Duplicate-key is BENIGN and expected — the unique
 * index (guild_id, character, scope->>'start_iso') is what stops a re-run, or
 * an officer's manual filing, from double-asking the same person for the same
 * fight. Returns the count attempted; PostgREST's minimal return means the
 * server never tells us how many actually inserted.
 */
async function applyProposals(rows) {
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return { ok: false, reason: 'supabase-disabled', attempted: 0 };
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return { ok: true, attempted: 0 };
  await supabase.insertIgnoreDuplicates('agent_backfill_requests', list);
  return { ok: true, attempted: list.length };
}

/**
 * Retire requests past the log horizon. Status-only — the rows stay for the
 * audit trail, and `expired` is invisible to the agent's poll filter.
 */
async function expireStale(ids, reason = `auto-expired: log window older than ${EXPIRY_HORIZON_DAYS} days`) {
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return { ok: false, reason: 'supabase-disabled', expired: 0 };
  const list = (Array.isArray(ids) ? ids : []).filter(id => /^[0-9a-fA-F-]{36}$/.test(String(id)));
  if (!list.length) return { ok: true, expired: 0 };
  await supabase.update('agent_backfill_requests',
    `id=in.(${list.join(',')})`,
    { status: 'expired', dismissed_at: new Date().toISOString(), dismissed_reason: reason });
  return { ok: true, expired: list.length };
}

module.exports = {
  // thresholds (exported so the doc, the tests and the command can't drift)
  MIN_CONTRIBS, HP_RATIO, MEDIAN_RATIO, THIN_RATIO,
  MELEE_HIT_FLOOR, DEFENDER_HIT_FLOOR, PRESENT_FRACTION,
  ACTIVE_UPLOADER_DAYS, EXPIRY_HORIZON_DAYS,
  MAX_ASKS_PER_FINDING, MAX_ASKS_PER_SCAN, MAX_ASKS_PER_PERSON,
  TANK_CLASSES, MELEE_VERBS,
  // pure
  median, resolveHpPool, findInflated, findCoverageGap, meleeHitsOf,
  rankAskCandidates, requestReason, buildRequestRows, expirySweepIds,
  renderScanEmbeds, cleanBossName, fmtDmg, fmtDay,
  // fetch
  collectScanData, analyzeScanData, scanWindow,
  // write
  applyProposals, expireStale,
};
