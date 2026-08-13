#!/usr/bin/env node
/**
 * Mirror the EQMac quest scripts into eqemu_quest_scripts.
 *
 *   node scripts/sync-quest-scripts.js
 *
 * WHY A SEPARATE SCRIPT. `sync-from-eqmac.js` parses a MySQL dump — it is a SQL
 * tokeniser with a table whitelist. This source is not SQL at all: it is a
 * tarball of .lua files from github.com/SecretsOTheP/quests, one directory per
 * zone short name. Bolting a file walker into the dump parser would tangle two
 * unrelated failure modes; keeping it separate means a quests-repo outage
 * cannot take the catalog sync down with it, and vice versa.
 *
 * WHAT IT IS FOR. The scripts carry the literal emote strings and real timer
 * durations for boss fights we have been hand-guessing. Emperor.lua alone has
 * four emotes that appear in none of our triggers, and the timers for an
 * encounter whose `timer_warnings` field is blank. Once mirrored,
 * "does this trigger watch text that actually exists?" becomes a SQL query
 * instead of an argument (see the audit view in the migration's sibling docs).
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
 *   QUESTS_REPO      default 'SecretsOTheP/quests'
 *   QUESTS_REF       default 'main'
 *   QUESTS_FORCE     '1' re-uploads every file even if the sha is unchanged
 *
 * Licence note: the upstream repo is GPL-3.0, which expressly permits
 * redistribution. This is NOT the docs/pq-companion case (unlicensed → study
 * and reimplement, never copy).
 */
'use strict';

const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');
const os   = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const REPO  = process.env.QUESTS_REPO || 'SecretsOTheP/quests';
const REF   = process.env.QUESTS_REF  || 'main';
const FORCE = process.env.QUESTS_FORCE === '1';

// A quest file bigger than this is not a mob script — it is generated data or
// a mistake, and it would blow the row size out for no benefit.
const MAX_FILE_BYTES = 256 * 1024;


async function sb(pathname, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...opts,
    headers: {
      apikey:          SERVICE_KEY,
      Authorization:   `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Supabase ${opts.method || 'GET'} ${pathname} -> ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Git's blob sha is sha1("blob <len>\0" + contents) — the same value the GitHub
// API reports per file. Computing it locally lets us skip unchanged files
// without a second API round-trip per file (there are ~1500 of them).
function gitBlobSha(buf) {
  return crypto.createHash('sha1')
    .update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

// 'ssratemple/encounters/Emperor.lua' -> { zone: 'ssratemple', npc: 'Emperor', encounter: true }
function classify(relPath) {
  const parts = relPath.split('/');
  if (parts.length < 2) return null;                       // repo-root files
  const zone = parts[0];
  const file = parts[parts.length - 1];
  if (!/\.lua$/i.test(file)) return null;
  // script_init.lua is zone-level plumbing, not a mob.
  const base = file.replace(/\.lua$/i, '');
  const isInit = /^script_init$/i.test(base);
  return {
    zone_short:   zone,
    // Files are named for the NPC with spaces as underscores; a leading '#' is
    // EQEmu's marker for a name that starts with a symbol, and a purely numeric
    // name is an npc_type id rather than a name.
    npc_name:     isInit ? null : base.replace(/^#/, '').replace(/_/g, ' '),
    is_encounter: parts.includes('encounters'),
  };
}

async function main() {
  // Checked HERE, not at module load: the pure helpers below are exported for
  // tests, and a top-level process.exit made the file impossible to require.
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'quests-'));
  const tarPath = path.join(tmp, 'quests.tar.gz');
  const url = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}`;
  console.log(`Fetching ${REPO}@${REF} …`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await fsp.writeFile(tarPath, Buffer.from(await res.arrayBuffer()));
  const tarBytes = (await fsp.stat(tarPath)).size;
  console.log(`  ${(tarBytes / 1024 / 1024).toFixed(2)} MB`);

  // tar is present on ubuntu-latest and every dev box we care about; shelling
  // out beats carrying a tar implementation for one call a week.
  execFileSync('tar', ['-xzf', tarPath, '-C', tmp]);
  const roots = (await fsp.readdir(tmp, { withFileTypes: true }))
    .filter(d => d.isDirectory()).map(d => d.name);
  if (roots.length !== 1) throw new Error(`expected one extracted root, got ${roots.join(', ')}`);
  const root = path.join(tmp, roots[0]);

  // Existing shas, so an unchanged week is a no-op instead of 1500 upserts.
  const known = new Map();
  if (!FORCE) {
    for (let offset = 0; ; offset += 1000) {
      const page = await sb(`/eqemu_quest_scripts?select=path,sha&limit=1000&offset=${offset}`);
      if (!page || !page.length) break;
      for (const r of page) known.set(r.path, r.sha);
      if (page.length < 1000) break;
    }
    console.log(`  ${known.size} already mirrored`);
  }

  // Valid zone short names, so a stray top-level directory (docs, tooling)
  // never lands as a phantom "zone".
  const zoneRows = await sb('/eqemu_zone?select=short_name');
  const zones = new Set((zoneRows || []).map(z => String(z.short_name).toLowerCase()));
  console.log(`  ${zones.size} known zones`);

  const rows = [];
  const seen = new Set();
  let skippedUnchanged = 0, skippedUnknownZone = 0, skippedTooBig = 0;

  const walk = async (dir, rel = '') => {
    for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      const relPath = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { await walk(abs, relPath); continue; }
      const meta = classify(relPath);
      if (!meta) continue;
      if (!zones.has(meta.zone_short.toLowerCase())) { skippedUnknownZone++; continue; }
      const buf = await fsp.readFile(abs);
      if (buf.length > MAX_FILE_BYTES) { skippedTooBig++; continue; }
      seen.add(relPath);
      const sha = gitBlobSha(buf);
      if (!FORCE && known.get(relPath) === sha) { skippedUnchanged++; continue; }
      rows.push({
        path: relPath, ...meta,
        body:  buf.toString('utf8'),
        bytes: buf.length,
        sha,
        synced_at: new Date().toISOString(),
      });
    }
  };
  await walk(root);

  console.log(`  ${seen.size} script files · ${rows.length} new/changed`
    + ` · skipped ${skippedUnchanged} unchanged, ${skippedUnknownZone} outside a known zone`
    + (skippedTooBig ? `, ${skippedTooBig} oversized` : ''));

  // Upsert in chunks — bodies are a few KB each, so keep batches modest.
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await sb('/eqemu_quest_scripts?on_conflict=path', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: chunk,
    });
    written += chunk.length;
    process.stdout.write(`\r  upserted ${written}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');

  // Delete rows whose file is gone upstream. Mirror semantics, deliberately:
  // unlike buff_casts, a removed quest script is "no longer true", not
  // "retention expired" — keeping it would mean auditing triggers against a
  // script the server no longer runs. Same reasoning as the ARCHIVE-vs-MIRROR
  // split in scripts/lib/archive-merge.sql.
  if (!FORCE && known.size) {
    const gone = [...known.keys()].filter(p => !seen.has(p));
    for (let i = 0; i < gone.length; i += 100) {
      const batch = gone.slice(i, i + 100);
      const list = batch.map(p => `"${p.replace(/"/g, '\\"')}"`).join(',');
      await sb(`/eqemu_quest_scripts?path=in.(${encodeURIComponent(list)})`, { method: 'DELETE' });
    }
    if (gone.length) console.log(`  removed ${gone.length} script(s) deleted upstream`);
  }

  const total = await sb('/eqemu_quest_scripts?select=path&limit=1', {
    headers: { Prefer: 'count=exact' },
  }).catch(() => null);
  void total;

  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  const summary = `${seen.size} quest scripts (${rows.length} changed)`;
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `quests_summary=${summary}\n`);
  }
  console.log(`✅ Quest scripts synced: ${summary}`);
}

// Pure helpers exported for tests; the sync only runs as a CLI, so requiring
// this file from a test never fires a network fetch or touches Supabase.
module.exports = { classify, gitBlobSha, MAX_FILE_BYTES };
if (require.main === module) {
  main().catch(err => { console.error('FATAL:', err); process.exit(1); });
}
