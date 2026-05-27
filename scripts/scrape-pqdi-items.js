#!/usr/bin/env node
// scripts/scrape-pqdi-items.js — Populate data/pqdi-items.json by walking
// PQDI item pages. Iterates IDs in batches, extracts item names from the
// page <title>, writes results incrementally so the script is resumable
// (Ctrl+C, restart, picks up where it left off).
//
// Usage:
//   node scripts/scrape-pqdi-items.js                 # default range 1..30000
//   node scripts/scrape-pqdi-items.js 1 5000          # custom range
//   node scripts/scrape-pqdi-items.js --concurrency 8 # tune parallelism
//
// Etiquette: defaults to 5 concurrent requests, ~5 req/s. Don't crank this
// up unless you know PQDI is OK with it.
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const DB_PATH = path.join(__dirname, '..', 'data', 'pqdi-items.json');

const args = process.argv.slice(2);
let startId = 1, endId = 30000, concurrency = 5;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--concurrency') concurrency = parseInt(args[++i], 10) || 5;
  else if (a === '--start')  startId = parseInt(args[++i], 10) || 1;
  else if (a === '--end')    endId   = parseInt(args[++i], 10) || 30000;
  else if (/^\d+$/.test(a) && i === 0) startId = parseInt(a, 10);
  else if (/^\d+$/.test(a) && i === 1) endId   = parseInt(a, 10);
}

let db = {};
try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch {}

const skipKeys = new Set(['_comment']);
let knownCount = Object.keys(db).filter(k => !skipKeys.has(k)).length;
const seenIds  = new Set(Object.values(db).filter(v => typeof v === 'number'));

console.log(`PQDI item scrape  start=${startId} end=${endId} concurrency=${concurrency}`);
console.log(`Existing DB:      ${knownCount} item(s)`);
console.log(`Skipping IDs already in DB: ${seenIds.size}`);
console.log(`Database file:    ${DB_PATH}`);
console.log('---');

function fetchItemName(id) {
  return new Promise((resolve) => {
    const req = https.request({
      method:   'GET',
      hostname: 'www.pqdi.cc',
      path:     `/item/${id}`,
      headers:  { 'User-Agent': 'wolfpack-pqdi-scraper/1 (https://github.com/davehess/quarmbosstracker)' },
      timeout:  10_000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        // Extract item name from <title> or <h1>
        // PQDI title format observed: "ItemName - Project Quarm Database Initiative"
        // (Adjust here if PQDI's HTML changes)
        const titleMatch = body.match(/<title>([^<]+?)(?:\s*-\s*Project Quarm[^<]*)?<\/title>/i);
        const h1Match    = body.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        const name = (titleMatch && titleMatch[1].trim())
                  || (h1Match    && h1Match[1].trim())
                  || null;
        // Filter: skip placeholder pages ("Item not found", numbers, etc.)
        if (!name || /not found|404|error/i.test(name) || /^[\d\s]+$/.test(name)) return resolve(null);
        resolve(name);
      });
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

let processed = 0, found = 0, lastSave = Date.now();

function save() {
  try {
    const out = { ...db };
    // Preserve comment if it was there
    if (!out._comment) out._comment = 'PQDI item name → item ID. Populated by scripts/scrape-pqdi-items.js. Lowercase keys.';
    fs.writeFileSync(DB_PATH, JSON.stringify(out, null, 2));
  } catch (e) { console.error('Save failed:', e.message); }
}

async function worker(idIter) {
  for (const id of idIter) {
    if (seenIds.has(id)) { processed++; continue; }
    const name = await fetchItemName(id);
    processed++;
    if (name) {
      db[name.toLowerCase()] = id;
      seenIds.add(id);
      found++;
    }
    if (processed % 50 === 0) {
      const pct = Math.floor(processed / (endId - startId + 1) * 100);
      console.log(`  [${pct}%]  scanned ${processed} · found this run ${found} · DB total ${Object.keys(db).filter(k => !skipKeys.has(k)).length}`);
    }
    if (Date.now() - lastSave > 30_000) { save(); lastSave = Date.now(); }
    // ~200ms between requests per worker (5/s × concurrency)
    await new Promise(r => setTimeout(r, 200));
  }
}

async function main() {
  // Build an iterator of IDs to scan
  const ids = [];
  for (let id = startId; id <= endId; id++) ids.push(id);
  // Shuffle so resumed runs explore evenly (optional)
  // ids.sort(() => Math.random() - 0.5);

  // Spawn N workers pulling from the shared queue
  let cursor = 0;
  function* nextChunk() {
    while (cursor < ids.length) yield ids[cursor++];
  }
  const workers = Array.from({ length: concurrency }, () => worker(nextChunk()));
  await Promise.all(workers);

  save();
  console.log('---');
  console.log(`Done. Found ${found} new items this run. Total DB: ${Object.keys(db).filter(k => !skipKeys.has(k)).length}`);
}

main().catch(e => { console.error('FATAL:', e); save(); process.exit(1); });

process.on('SIGINT', () => { console.log('\n(interrupted — saving partial DB)'); save(); process.exit(0); });
