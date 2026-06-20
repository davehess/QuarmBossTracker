#!/usr/bin/env node
// scripts/harvest-quarmy-stats.js
//
// Fetch one or more public quarmy.com profiles, extract the itemsMap from
// the RSC flight payload, and upsert per-item stats into eqemu_items that
// the eqmac dump doesn't carry (attack, haste, regen, manaregen,
// damageshield). One profile fills ~80 items; harvesting every Wolf Pack
// profile covers the live gear set across the guild.
//
// Why: haste is a per-item percentage (Yelinak's 41, Hierophant's 27) that
// the underlying spell does NOT encode — the spell carries the family CAP.
// The eqemu_items.haste column is 100% NULL in our mirror because the
// EQMacEmu dump SQL doesn't include those columns. quarmy.com resolves them
// from its own catalog and ships them inline in the page payload, so any
// public profile is a free harvest of authoritative numbers.
//
// Usage:
//   railway run node scripts/harvest-quarmy-stats.js https://quarmy.com/b/<slug> [...]
//   railway run node scripts/harvest-quarmy-stats.js --all   (reads bot state.json)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY required for upsert.

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Columns the eqmac dump leaves NULL but the quarmy itemsMap carries.
// These are exactly the stats the gear page can't decode from worn-effect
// spells alone — haste % chief among them.
const STAT_KEYS = ['attack', 'haste', 'regen', 'manaregen', 'damageshield'];

async function sb(method, p, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    method,
    headers: {
      apikey:          SUPABASE_KEY,
      Authorization:   `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=minimal,resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${(await res.text()).slice(0, 400)}`);
}

// Locate a balanced-brace JSON object literal starting at `start` in `src`
// (where `src[start]` is the opening `{`). Returns the substring up to and
// including its matching `}`, respecting strings / escapes.
function readJsonObject(src, start) {
  if (src[start] !== '{') throw new Error('readJsonObject: not at {');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced JSON object');
}

// Extract every `itemsMap` payload from a quarmy.com HTML page. The build
// data ships as RSC flight chunks `self.__next_f.push([1, "...escaped JSON..."])`;
// the JSON is double-escaped (once for JSON-in-JS-string, once because RSC
// itself wraps it in a JSON string). We work on the JSON-decoded payload
// per push, then locate `\"itemsMap\":{...}` and walk braces to extract.
function extractItemsMap(html) {
  const out = {};
  const pushRx = /self\.__next_f\.push\(\[1,\s*"((?:\\.|[^"\\])*)"\s*]\)/g;
  let m;
  while ((m = pushRx.exec(html)) !== null) {
    let payload;
    try { payload = JSON.parse(`"${m[1]}"`); }
    catch { continue; }
    let cursor = 0;
    while (true) {
      const at = payload.indexOf('"itemsMap"', cursor);
      if (at === -1) break;
      const brace = payload.indexOf('{', at);
      if (brace === -1) break;
      let blob;
      try { blob = readJsonObject(payload, brace); }
      catch { cursor = at + 10; continue; }
      try {
        const map = JSON.parse(blob);
        for (const [id, item] of Object.entries(map)) {
          if (!item || typeof item !== 'object') continue;
          const n = Number(id);
          if (!Number.isFinite(n)) continue;
          out[n] = item;
        }
      } catch { /* skip */ }
      cursor = brace + blob.length;
    }
  }
  return out;
}

async function fetchProfile(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Wolfpack-Tracker harvester (contact: wolfpack.quest)', Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

function urlsFromBotState() {
  const statePath = path.join(__dirname, '..', 'data', 'state.json');
  if (!fs.existsSync(statePath)) return [];
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return Object.values(s.quarmyLinks || {}).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  let urls = args.includes('--all') ? urlsFromBotState() : args;
  urls = [...new Set(urls.filter(u => /^https?:\/\/(www\.)?quarmy\.com\//i.test(u)))];
  if (urls.length === 0) {
    console.error('usage: harvest-quarmy-stats.js <URL> [URL...]  |  --all');
    process.exit(2);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(2);
  }

  const merged = {};
  for (const url of urls) {
    process.stdout.write(`→ ${url} … `);
    try {
      const html = await fetchProfile(url);
      const map  = extractItemsMap(html);
      const n    = Object.keys(map).length;
      console.log(`${n} items`);
      Object.assign(merged, map);   // later profiles overwrite — quarmy data is canonical anyway
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
    }
  }

  const ids = Object.keys(merged).map(Number);
  console.log(`\n${ids.length} unique items to upsert`);
  if (ids.length === 0) return;

  // Pull existing rows so we only PATCH rows that already exist (the dump
  // is the source of truth for item identity — we never want this script
  // to insert a row the catalog doesn't know about).
  const CHUNK = 200;
  let updated = 0, skipped = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const filter = `id=in.(${slice.join(',')})`;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/eqemu_items?select=id&${filter}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    const existing = new Set(((await res.json()) || []).map((r) => r.id));
    for (const id of slice) {
      if (!existing.has(id)) { skipped++; continue; }
      const item = merged[id];
      const patch = {};
      for (const k of STAT_KEYS) if (item[k] != null) patch[k] = item[k];
      if (Object.keys(patch).length === 0) continue;
      await sb('PATCH', `/eqemu_items?id=eq.${id}`, patch);
      updated++;
    }
    process.stdout.write(`\r updated ${updated} / queried ${Math.min(i + CHUNK, ids.length)}`);
  }
  console.log(`\n done — patched ${updated} item${updated === 1 ? '' : 's'} (${skipped} not in catalog).`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
module.exports = { extractItemsMap, readJsonObject };
