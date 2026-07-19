// utils/hotDiceNight.js — #91 "Hot Dice" NIGHT award (pure, unit-tested).
//
// The per-roll 🎲🔥 Hot Dice event (a PERFECT roll) already fires from the
// agent. This is the sibling NIGHT award the guild lead asked for: "when
// someone out-rolls everyone else on more than 20% of rolls for the night."
//
// Read a night's roll_sets rows (possibly several per logical set — one row per
// uploader who witnessed it) and decide whether one character dominated. Rules:
//   • a set is CONTESTED when ≥2 distinct players rolled first-rolls in it;
//   • the set's winner is the highest FIRST roll (re-rolls never win — same as
//     the agent's rollSetsSnapshot);
//   • need ≥ minContested contested sets that night (floor against tiny nights
//     where one lucky roll would trivially clear 20%);
//   • award the top winner iff their share of contested sets is > winThreshold.
// Deterministic (ties break by lowercased name) so a nightly re-run upserts the
// same fun_events row instead of flip-flopping.
'use strict';

const SET_GAP_MS = 10 * 60 * 1000;   // same range this long apart = a new set

// Cluster raw roll_sets rows into logical sets and union rolls across the
// uploaders who saw the same one. Rows: { roll_from, roll_to, started_at|started_at_ms,
// rolls:[{name,value,at|at_ms,reroll}] }. Returns [{ from, to, startMs, rolls:[{name,value,atMs,reroll}] }].
function mergeRollSetRows(rows) {
  const norm = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const from = Number(r?.roll_from);
    const to   = Number(r?.roll_to);
    const startMs = r?.started_at_ms != null ? Number(r.started_at_ms)
      : (r?.started_at ? Date.parse(r.started_at) : NaN);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(startMs)) continue;
    const rolls = (Array.isArray(r?.rolls) ? r.rolls : []).map(x => ({
      name: x?.name != null ? String(x.name) : '',
      value: Number(x?.value),
      atMs: x?.at_ms != null ? Number(x.at_ms) : (x?.at ? Date.parse(x.at) : startMs),
      reroll: !!x?.reroll,
    })).filter(x => x.name && Number.isFinite(x.value));
    norm.push({ from, to, startMs, rolls });
  }
  // Group by range, then cluster within SET_GAP_MS of the group's running start.
  norm.sort((a, b) => (a.from - b.from) || (a.to - b.to) || (a.startMs - b.startMs));
  const merged = [];
  for (const r of norm) {
    const g = merged.find(m => m.from === r.from && m.to === r.to && Math.abs(m.startMs - r.startMs) <= SET_GAP_MS);
    if (g) {
      g.startMs = Math.min(g.startMs, r.startMs);
      for (const roll of r.rolls) {
        // Collapse the SAME roll seen by multiple uploaders (name+value within 5s).
        const dupe = g.rolls.some(e => e.name.toLowerCase() === roll.name.toLowerCase()
          && e.value === roll.value && Math.abs(e.atMs - roll.atMs) < 5000);
        if (!dupe) g.rolls.push(roll);
      }
    } else {
      merged.push({ from: r.from, to: r.to, startMs: r.startMs, rolls: r.rolls.slice() });
    }
  }
  return merged;
}

// { winner, rollers, topValue } for one merged set. First roll per player only;
// highest first-roll wins. winner is null when nobody rolled.
function sessionWinner(session) {
  const firstByName = new Map();   // nameLower → { name, value, atMs }
  for (const r of (session?.rolls || [])) {
    const key = r.name.toLowerCase();
    const prev = firstByName.get(key);
    // Keep the earliest roll as the player's counted first-roll (re-rolls never win).
    if (!prev || r.atMs < prev.atMs) firstByName.set(key, { name: r.name, value: r.value, atMs: r.atMs });
  }
  const entries = [...firstByName.values()];
  if (entries.length === 0) return { winner: null, rollers: 0, topValue: null };
  entries.sort((a, b) => (b.value - a.value) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { winner: entries[0].name, rollers: entries.length, topValue: entries[0].value };
}

// The night award, or null. rows = raw roll_sets rows for the night.
function computeHotDiceNight(rows, opts = {}) {
  const minContested = opts.minContested != null ? opts.minContested : 5;
  const winThreshold = opts.winThreshold != null ? opts.winThreshold : 0.2;
  const sets = mergeRollSetRows(rows);
  const contested = [];
  for (const s of sets) {
    const w = sessionWinner(s);
    if (w.rollers >= 2 && w.winner) contested.push(w.winner);
  }
  const contestedCount = contested.length;
  if (contestedCount < minContested) return null;
  const tally = new Map();   // nameLower → { name, wins }
  for (const name of contested) {
    const key = name.toLowerCase();
    const cur = tally.get(key) || { name, wins: 0 };
    cur.wins += 1;
    tally.set(key, cur);
  }
  const ranked = [...tally.values()]
    .sort((a, b) => (b.wins - a.wins) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const top = ranked[0];
  const pct = top.wins / contestedCount;
  if (pct <= winThreshold) return null;
  return { winner: top.name, wins: top.wins, contested: contestedCount, pct };
}

module.exports = { mergeRollSetRows, sessionWinner, computeHotDiceNight, SET_GAP_MS };
