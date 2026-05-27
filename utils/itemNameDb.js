// utils/itemNameDb.js — Name → PQDI item ID lookup for the chat linkifier.
//
// When EQ's log doesn't include the \x12<blob>\x12name\x12 link metadata
// (some clients / settings don't write it), this falls back to recognizing
// item names directly from a curated database.
//
// The database file lives at data/pqdi-items.json and is shaped:
//   { "abashi's rod of disempowerment": 9131,
//     "rune of proximity": 13124,
//     ... }
// Keys are lowercase to make the lookup case-insensitive.
//
// Populate via scripts/scrape-pqdi-items.js (one-time scrape against pqdi.cc).
'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'pqdi-items.json');
let _db = null;          // Map<lowercaseName, id>
let _sorted = null;      // names sorted by length descending (longest-match-wins)
let _loadedAt = 0;

function _load() {
  if (_db && (Date.now() - _loadedAt) < 5 * 60_000) return _db;  // 5-min cache
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const json = JSON.parse(raw);
    _db = new Map(Object.entries(json).map(([k, v]) => [k.toLowerCase(), v]));
    _sorted = [...new Set(_db.keys())].sort((a, b) => b.length - a.length);
    _loadedAt = Date.now();
  } catch { _db = new Map(); _sorted = []; }
  return _db;
}

function size() { _load(); return _db.size; }
function reload() { _loadedAt = 0; _load(); return _db.size; }

function lookupByName(name) {
  _load();
  return _db.get(String(name || '').toLowerCase()) || null;
}

// Walk the text once, greedily matching the longest known item name at each
// word position. Capital-cased candidates only — avoids false positives on
// common chat phrases.
//
// Returns the text with matched names replaced by:
//   "<name> <https://www.pqdi.cc/item/<id>>"
function linkifyByName(text) {
  _load();
  if (_db.size === 0 || !text) return text;

  // Cheap pre-filter: only scan when there's at least one capital letter
  // (item names always start with caps; messages without any are skipped).
  if (!/[A-Z]/.test(text)) return text;

  // Tokenize keeping delimiters so we can rejoin without losing whitespace.
  const parts = text.split(/(\s+|[,.;:!?'"()])/);
  const out   = [];
  const MAX_WORDS = 8;   // longest known item name we'd expect to span

  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    // Only attempt a match if this token starts with a capital letter (an
    // item name's first character) or the article "A "/"An "/"The ".
    const startsItemName = p && /^[A-Z]/.test(p);
    if (!startsItemName) { out.push(p); i++; continue; }

    let bestId = null, bestLen = 0, bestText = '';
    for (let len = MAX_WORDS * 2; len >= 1; len--) {  // ×2 because delimiters count as tokens
      if (i + len > parts.length) continue;
      // Skip ranges that end on whitespace/punctuation — we only want to
      // consume up to and including the last word so trailing spaces stay
      // untouched in the output (otherwise "A Lucid Shard out" loses the
      // space and renders as "A Lucid Shardout").
      const last = parts[i + len - 1];
      if (!last || /^[\s,.;:!?'"()]+$/.test(last)) continue;
      const candidate = parts.slice(i, i + len).join('').trim();
      if (!candidate) continue;
      const id = _db.get(candidate.toLowerCase());
      if (id) { bestId = id; bestLen = len; bestText = candidate; break; }
    }
    if (bestId) {
      out.push(bestText + ' <https://www.pqdi.cc/item/' + bestId + '>');
      i += bestLen;
    } else {
      out.push(p);
      i++;
    }
  }
  return out.join('');
}

module.exports = { lookupByName, linkifyByName, size, reload };
