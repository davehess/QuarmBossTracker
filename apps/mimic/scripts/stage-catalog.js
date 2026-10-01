// scripts/stage-catalog.js — fetch the spell and item catalogs into
// staged-agent/catalog/ so the installer carries them (local mode, the guild
// lead 2026-10-01; DECISIONS §118). A local-only install never talks to our
// server, so without this its spell timers, buff names and clicky cast times
// have nothing to read. Mimic copies these into the agent's folder on launch
// when they are newer than what is there (seedBundledCatalog in main.js).
//
// Runs before `npm run dist` (predist). Best-effort on purpose: if the bot is
// unreachable the installer still builds, it just ships without the snapshot,
// which is exactly how every installer before this one shipped.
'use strict';
const fs    = require('fs');
const path  = require('path');

// Both overridable so the test can point it at a local server and a temp folder.
const BASE = process.env.WOLFPACK_CATALOG_URL || 'https://wolfpackparse.up.railway.app/api/public/catalog/';
const OUT  = process.env.WOLFPACK_CATALOG_OUT || path.join(__dirname, '..', 'staged-agent', 'catalog');

// Route name → the agent's own cache file name, so a copy drops straight in.
const CATALOGS = [
  ['spell-catalog', 'logsync.spell-catalog.json'],
  ['item-clickies', 'logsync.item-clickies.json'],
  ['item-catalog',  'logsync.item-catalog.json'],
];

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? require('http') : require('https');
    const req = lib.get(url, { timeout: 60000, headers: { 'User-Agent': 'mimic-build' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ body, etag: res.headers.etag || null }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, file] of CATALOGS) {
    try {
      const { body, etag } = await get(BASE + name);
      const data = JSON.parse(body);
      if (!Array.isArray(data.entries) || !data.entries.length) throw new Error('no entries');
      // The agent's own cache shape, etag included, so a signed-in install's
      // first check is a 304 instead of a full download.
      const out = { fetched_at: data.fetched_at, etag, entries: data.entries };
      fs.writeFileSync(path.join(OUT, file), JSON.stringify(out));
      console.log(`[stage-catalog] ${name}: ${data.entries.length} entries`);
    } catch (err) {
      console.warn(`[stage-catalog] ${name} skipped: ${err && err.message}`);
    }
  }
}
main().catch((err) => console.warn('[stage-catalog]', err && err.message));
