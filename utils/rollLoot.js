// utils/rollLoot.js — the off-night event thread's loot content.
//
// The guild lead 2026-07-31: a non-raid guild event gets NO DKP loot posts. What it
// gets instead is "the items that dropped with their assigned roll ranges,
// the night's parses, then the rolled loot (winners)".
//
// All three inputs already exist — this module only joins them:
//   • roll_sets    — #91 roll capture (`POST /api/agent/rolls`). One row per
//                    uploader who witnessed the /random set; carries the item,
//                    the assigned range (roll_from..roll_to), qty and the rolls.
//   • looted_items — #91 "You have looted" lines, per looter.
//   • the parses   — already flow into the thread as autoparse cards.
//
// The multi-uploader merge + winner ranking is NOT reimplemented: it is
// utils/hotDiceNight.js's mergeRollSetRows/sessionWinner, the same math the
// Hot Dice night award and web/lib/rolls.ts use. The item↔looter tolerant
// match mirrors web/lib/rolls.ts `itemsMatch` (that file is TS and can't be
// required from the CJS bot; keep the two in step if either changes).

'use strict';

const { mergeRollSetRows, sessionWinner } = require('./hotDiceNight');

const STOPWORDS = new Set(['of', 'the', 'a', 'an']);
const LOOT_WINDOW_MS = 10 * 60 * 1000;   // loot follows the roll
const LOOT_PRE_SLACK_MS = 2 * 60 * 1000; // …but can land just before it resolves

function normalizeItemName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^(?:an?|the)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Tolerant item equality — mirrors web/lib/rolls.ts itemsMatch(). */
function itemsMatch(a, b) {
  const na = normalizeItemName(a);
  const nb = normalizeItemName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  const sig = (n) => new Set(n.split(' ').filter(t => t.length >= 3 && !STOPWORDS.has(t)));
  const ta = sig(na), tb = sig(nb);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = new Set([...ta, ...tb]).size;
  return shared >= 2 || (shared >= 1 && (union > 0 ? shared / union : 0) >= 0.5);
}

/**
 * roll_sets rows (possibly several per logical set) → one entry per item:
 *   { item, qty, from, to, startMs, lastMs, rollers, winners:[{name,value}], looters:[] }
 * `winners` honours qty (a 2× drop has two winners). Newest first.
 */
function buildRollSessions(rollRows, lootedRows = []) {
  // mergeRollSetRows keys on range+start and drops the item, so re-attach the
  // item/qty/zone from the rows that fed each merged set.
  const merged = mergeRollSetRows(rollRows);
  const rows   = Array.isArray(rollRows) ? rollRows : [];
  const out = [];
  for (const set of merged) {
    let item = null, qty = null, zone = null, lastMs = set.startMs;
    for (const r of rows) {
      const from = Number(r?.roll_from), to = Number(r?.roll_to);
      const startMs = r?.started_at_ms != null ? Number(r.started_at_ms)
        : (r?.started_at ? Date.parse(r.started_at) : NaN);
      if (from !== set.from || to !== set.to) continue;
      if (!Number.isFinite(startMs) || Math.abs(startMs - set.startMs) > 10 * 60 * 1000) continue;
      if (!item && r?.item) item = String(r.item);
      if (qty == null && Number.isFinite(Number(r?.qty))) qty = Number(r.qty);
      if (!zone && r?.zone) zone = String(r.zone);
      const lm = r?.last_at ? Date.parse(r.last_at) : startMs;
      if (Number.isFinite(lm) && lm > lastMs) lastMs = lm;
    }
    const w = sessionWinner(set);
    // Rank every first-roll so a qty>1 drop can name all its winners.
    const firstByName = new Map();
    for (const roll of (set.rolls || [])) {
      const k = roll.name.toLowerCase();
      const prev = firstByName.get(k);
      if (!prev || roll.atMs < prev.atMs) firstByName.set(k, roll);
    }
    const ranked = [...firstByName.values()]
      .sort((a, b) => (b.value - a.value) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const nWinners = Math.max(1, Math.min(qty || 1, ranked.length));
    const session = {
      item, qty, zone,
      from: set.from, to: set.to,
      startMs: set.startMs, lastMs,
      rollers: w.rollers,
      winners: ranked.slice(0, nWinners).map(r => ({ name: r.name, value: r.value })),
      looters: [],
    };
    session.looters = attributeLooters(session, lootedRows);
    out.push(session);
  }
  out.sort((a, b) => b.lastMs - a.lastMs);
  return out;
}

/** Looters whose item + timing line up with a roll session. */
function attributeLooters(session, lootedRows) {
  if (!session?.item) return [];
  const lo = session.lastMs - LOOT_PRE_SLACK_MS;
  const hi = session.lastMs + LOOT_WINDOW_MS;
  const hits = [];
  const seen = new Set();
  for (const l of (Array.isArray(lootedRows) ? lootedRows : [])) {
    const ms = l?.looted_at ? Date.parse(l.looted_at) : NaN;
    if (!Number.isFinite(ms) || ms < lo || ms > hi) continue;
    if (!itemsMatch(session.item, l?.item_name)) continue;
    const k = String(l.looter_character || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    hits.push({ looter: l.looter_character, atMs: ms });
  }
  hits.sort((a, b) => a.atMs - b.atMs);
  return hits;
}

/**
 * The looters of a session who are NOT among its winners — the "looted by"
 * that differs (a re-roll or a pass hands the item to someone else). One
 * predicate for the Discord card and the Mimic Loot tab's night-loot panel.
 */
function otherLooters(session) {
  const winners = session?.winners || [];
  return (session?.looters || []).filter(l =>
    !winners.some(w => w.name.toLowerCase() === String(l.looter).toLowerCase()));
}

const NIGHT_LOOT_WINDOW_MS = 12 * 3600_000;

/**
 * The Mimic Loot tab's "who looted what (last 12h)" panel (the guild lead,
 * 2026-10-03: "the loot tab on mimic should have the 'who looted what' section
 * on there for items, as well as the rolls for loot"). No new merge: the roll
 * sessions are buildRollSessions over the same rows, and the looted list is
 * the raw looted_items rows, newest first.
 *
 *   loot     — [{ looter, item, zone, at }]  newest first, capped; loot_total
 *              is the uncapped count so the panel can say "showing N of M"
 *   sessions — roll sessions that NAMED an item (an unnamed set — a deathroll,
 *              a stray /random — can never be linked to a looter), newest
 *              first: { item, qty, zone, from, to, started_at, last_at,
 *              rollers, winners:[{name,value}], looters:[name], looted_by:[name] }
 *              where looted_by is only the looters who differ from the winners.
 */
function buildNightLootPanel(rollRows, lootedRows, { nowMs = Date.now(), windowMs = NIGHT_LOOT_WINDOW_MS, lootCap = 200, sessionCap = 100 } = {}) {
  const since = nowMs - windowMs;
  const loot = [];
  for (const l of (Array.isArray(lootedRows) ? lootedRows : [])) {
    const ms = l?.looted_at ? Date.parse(l.looted_at) : NaN;
    if (!Number.isFinite(ms) || ms < since || !l?.looter_character || !l?.item_name) continue;
    loot.push({ looter: String(l.looter_character), item: String(l.item_name), zone: l.zone ? String(l.zone) : null, at: new Date(ms).toISOString(), ms });
  }
  loot.sort((a, b) => b.ms - a.ms);
  // Attribution gets ALL the rows (the caller fetches a little before the
  // window so a loot that landed just ahead of a roll's resolve still links).
  const sessions = buildRollSessions(rollRows, lootedRows)
    .filter(s => s.item && s.startMs >= since)
    .slice(0, sessionCap)
    .map(s => ({
      item: s.item, qty: s.qty, zone: s.zone,
      from: s.from, to: s.to,
      started_at: new Date(s.startMs).toISOString(),
      last_at: new Date(s.lastMs).toISOString(),
      rollers: s.rollers,
      winners: s.winners,
      looters: s.looters.map(l => l.looter),
      looted_by: otherLooters(s).map(l => l.looter),
    }));
  return {
    loot_total: loot.length,
    loot: loot.slice(0, lootCap).map(({ ms, ...row }) => row),
    sessions,
  };
}

/**
 * The embed body for the event thread's rolled-loot card. Pure string work so
 * it is unit-testable without discord.js. Sections, in the order the guild lead asked
 * for: what dropped + its range, then who won it, then who actually looted it
 * when that differs.
 */
function renderRollLootLines(sessions, { max = 20 } = {}) {
  const lines = [];
  for (const s of (sessions || []).slice(0, max)) {
    const item  = s.item ? `**${s.item}**` : '**(unnamed drop)**';
    const qty   = s.qty && s.qty > 1 ? ` ×${s.qty}` : '';
    const range = `\`${s.from}–${s.to}\``;
    const head  = `🎲 ${item}${qty} — roll ${range} · ${s.rollers} roller${s.rollers === 1 ? '' : 's'}`;
    const win   = s.winners.length
      ? `\n   🏆 ${s.winners.map(w => `**${w.name}** (${w.value})`).join(' · ')}`
      : '\n   _no rolls captured yet_';
    const others = otherLooters(s);
    const loot = others.length ? `\n   📦 looted by ${others.map(l => l.looter).join(', ')}` : '';
    lines.push(head + win + loot);
  }
  return lines;
}

module.exports = {
  normalizeItemName, itemsMatch,
  buildRollSessions, attributeLooters, renderRollLootLines,
  otherLooters, buildNightLootPanel,
  LOOT_WINDOW_MS, LOOT_PRE_SLACK_MS, NIGHT_LOOT_WINDOW_MS,
};
