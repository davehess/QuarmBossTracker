// utils/deathroll.js — find deathrolls in roll_sets rows (pure, unit-tested).
//
// A deathroll (the guild lead, 2026-09-23: "First one to roll a zero loses - we
// should track these for fun"): someone rolls /random N, the next player rolls
// /random <what they got>, and so on, until somebody hits 0. EQ prints each
// step as an ordinary /random, so the agent's Rolls card showed one game as
// eleven separate "1 roller · open" sets.
//
// The shape is what identifies it, and loot rolls never have it:
//   • each roll's range is the PREVIOUS roll's result (0 to N, N = last value);
//   • a different player rolls each step (two players alternate; three or more
//     rotate — the rule only forbids rolling twice in a row);
//   • each step follows the last within STEP_GAP_MS;
//   • it ends on a 0, and has at least MIN_ROLLS rolls.
//
// ⚠ Detect per UPLOADER, then merge. Every raider's Mimic uploads the same game
// with its own clock, and on the first captured game (2026-09-23, seven
// uploaders) those clocks disagreed by up to 9 seconds — enough to reorder two
// steps a second apart if everyone's rows were pooled first. Within one
// uploader the order is exact.
'use strict';

const STEP_GAP_MS = 2 * 60 * 1000;
const MIN_ROLLS = 3;
const MERGE_WINDOW_MS = 60 * 1000;

// roll_sets rows (one uploader) → single rolls, oldest first.
function flattenRolls(rows) {
  const out = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const from = Number(r?.roll_from);
    const to = Number(r?.roll_to);
    const startMs = r?.started_at ? Date.parse(r.started_at) : NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    for (const x of (Array.isArray(r?.rolls) ? r.rolls : [])) {
      const value = Number(x?.value);
      const atMs = x?.at ? Date.parse(x.at) : startMs;
      if (!x?.name || !Number.isFinite(value) || !Number.isFinite(atMs)) continue;
      out.push({ name: String(x.name), nameLower: String(x.name).toLowerCase(), from, to, value, atMs });
    }
  }
  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

// Single rolls from one observer → finished games. Walks back from every 0.
function findDeathrolls(rolls) {
  const used = new Set();
  const games = [];
  for (let i = rolls.length - 1; i >= 0; i--) {
    const end = rolls[i];
    if (end.value !== 0 || end.from !== 0 || used.has(i)) continue;
    const chain = [i];
    let cur = end;
    for (let j = i - 1; j >= 0; j--) {
      const p = rolls[j];
      if (cur.atMs - p.atMs > STEP_GAP_MS) break;
      if (used.has(j)) continue;
      if (p.from === 0 && p.value === cur.to && p.nameLower !== cur.nameLower) {
        chain.unshift(j);
        cur = p;
      }
    }
    if (chain.length < MIN_ROLLS) continue;
    for (const k of chain) used.add(k);
    const steps = chain.map(k => ({ name: rolls[k].name, to: rolls[k].to, value: rolls[k].value, atMs: rolls[k].atMs }));
    const players = [];
    for (const s of steps) if (!players.some(p => p.toLowerCase() === s.name.toLowerCase())) players.push(s.name);
    const loser = end.name;
    games.push({
      loser,
      winners: players.filter(p => p.toLowerCase() !== loser.toLowerCase()),
      players,
      start: steps[0].to,
      rolls: steps.length,
      startMs: steps[0].atMs,
      endMs: end.atMs,
      steps,
    });
  }
  return games.sort((a, b) => a.endMs - b.endMs);
}

// Same game seen by several uploaders → one. Same loser, same players, ends
// within MERGE_WINDOW_MS (clock skew); the longest copy wins, because an
// observer who arrived mid-game saw only the tail.
function mergeGames(games) {
  const out = [];
  const key = g => g.players.map(p => p.toLowerCase()).sort().join(',');
  for (const g of games) {
    const twin = out.find(o => o.loser.toLowerCase() === g.loser.toLowerCase()
      && key(o) === key(g) && Math.abs(o.endMs - g.endMs) <= MERGE_WINDOW_MS);
    if (!twin) { out.push(g); continue; }
    if (g.rolls > twin.rolls) out[out.indexOf(twin)] = g;
  }
  return out.sort((a, b) => a.endMs - b.endMs);
}

// roll_sets rows from any number of uploaders → merged finished games.
function deathrollsFromRows(rows) {
  const byUploader = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const u = r?.uploaded_by_discord_id || '';
    if (!byUploader.has(u)) byUploader.set(u, []);
    byUploader.get(u).push(r);
  }
  const all = [];
  for (const list of byUploader.values()) all.push(...findDeathrolls(flattenRolls(list)));
  return mergeGames(all);
}

// "Brackwyn lost a deathroll to Aldenmar — 32,000 → 0 in 11 rolls". `bold`
// wraps the names for Discord (EQ names are letters only, so nothing to escape).
function describeGame(g, { bold = false } = {}) {
  const b = s => (bold ? `**${s}**` : s);
  const who = g.winners.length ? g.winners.map(b).join(', ') : 'nobody';
  return `${b(g.loser)} lost a deathroll to ${who} — ${Number(g.start).toLocaleString('en-US')} → 0 in ${g.rolls} rolls`;
}

module.exports = { flattenRolls, findDeathrolls, mergeGames, deathrollsFromRows, describeGame, STEP_GAP_MS, MIN_ROLLS };
