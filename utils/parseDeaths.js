// utils/parseDeaths.js — cross-uploader death dedup + phantom suppression.
//
// PORT of the web parse page's death logic (web/app/parses/[id]/page.tsx
// ~369-418) so the Discord auto-parse card matches the website (#134). The bot
// card USED to SUM each parser's sighting of the same death — three parsers
// each seeing "Melting" die once rendered "Melting ×3" — while the web page
// correctly collapses them to one. Keep these two implementations in sync: any
// change to the web algorithm should be mirrored here (and vice-versa).
//
// Rules (identical to the web):
//   1. Phantom suppression — if ANY single contributor reported a name dying
//      ≥2 times, drop that name entirely across the whole fight. A real player
//      can only die once per encounter (corpses don't respawn mid-fight), so a
//      repeat death from one observer means an NPC namesake got mis-attributed
//      to the player (Uilnayar 2026-06-25: 30+ phantom "Syphon" deaths in Ssra
//      because "Syphon" is both an SK player and a Quarm-custom NPC). One
//      agent's view is enough to discredit the name across the whole fight.
//   2. Window dedup — collect the surviving deaths across all contributors,
//      sort by (name, ts), and drop any within DEATH_DEDUP_MS of the LAST KEPT
//      death for that name. Cross-parser clock skew (a second or two) collapses;
//      a genuine rez-and-die-again (well beyond the window) stays separate.
//
// The web page lists each surviving death individually (with its timestamp);
// the Discord card aggregates per name with a `×count`. So this helper returns
// count-aggregated display rows: for a normal fight every real player comes out
// at count 1 — exactly the website's "each once".

const DEATH_DEDUP_MS = 30_000;

function _tsMs(ts) {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : 0;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

// contribDeaths: array (one entry per contributor / upload) of raw death arrays,
//   each death { name, ts, class?, riposteDeath? }. ts is an ISO string or ms.
// Returns display rows [{ name, count, class, riposteDeath, ts }] ordered by
// first (earliest) death time — the shape commands/parse.js buildParseEmbed's
// 💀 Deaths section already renders (name, ×count, class, riposte flag).
function dedupParseDeaths(contribDeaths) {
  const contribs = Array.isArray(contribDeaths) ? contribDeaths : [];

  // 1. Phantom names — any single contributor reporting a name ≥2 times.
  const phantomNames = new Set();
  for (const arr of contribs) {
    const perName = new Map();
    for (const d of (Array.isArray(arr) ? arr : [])) {
      if (!d || !d.name) continue;
      const k = String(d.name).toLowerCase();
      perName.set(k, (perName.get(k) || 0) + 1);
    }
    for (const [k, n] of perName) if (n >= 2) phantomNames.add(k);
  }

  // 2. Collect survivors across contributors (skip phantom names).
  const collected = [];
  for (const arr of contribs) {
    for (const d of (Array.isArray(arr) ? arr : [])) {
      if (!d || !d.name) continue;
      if (phantomNames.has(String(d.name).toLowerCase())) continue;
      collected.push(d);
    }
  }

  // Sort by (name, ts) so the window walk sees each name's deaths in time order.
  collected.sort((a, b) =>
    String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase())
    || _tsMs(a.ts) - _tsMs(b.ts));

  // Window dedup + aggregate into per-name display rows.
  const rows = new Map();            // nameLower → { name, count, class, riposteDeath, ts, _firstMs }
  const lastKeptByName = new Map();  // nameLower → last KEPT death ms
  for (const d of collected) {
    const nk = String(d.name).toLowerCase();
    const t  = _tsMs(d.ts);
    let row = rows.get(nk);
    if (!row) {
      row = { name: d.name, count: 0, class: d.class || null, riposteDeath: false, ts: d.ts, _firstMs: t };
      rows.set(nk, row);
    }
    // Merge class + riposte from every sighting, even collapsed ones — any
    // parser seeing the riposte is sufficient (matches the bot's old OR rule).
    if (!row.class && d.class) row.class = d.class;
    if (d.riposteDeath) row.riposteDeath = true;

    const prev = lastKeptByName.get(nk);
    if (prev != null && Math.abs(t - prev) <= DEATH_DEDUP_MS) continue;  // same death, another parser's view
    lastKeptByName.set(nk, t);
    row.count += 1;
    if (t < row._firstMs) { row._firstMs = t; row.ts = d.ts; }
  }

  return [...rows.values()]
    .sort((a, b) => a._firstMs - b._firstMs)
    .map(({ _firstMs, ...r }) => r);
}

module.exports = { dedupParseDeaths, DEATH_DEDUP_MS };
