#!/usr/bin/env node
// scripts/sync-from-eqmac.js
//
// Weekly job: pull the latest quarm_*.tar.gz dump from SecretsOTheP/EQMacEmu,
// extract the whitelisted tables, transform each row, and upsert into Supabase.
//
// Reads-it-and-leaves: writes data/sync_state.json with the dump date + commit SHA
// so the next run can detect "nothing new" and skip.
//
// Whitelist (anything else from the dump is ignored):
//   zone, items, npc_types, loottable, loottable_entries, lootdrop, lootdrop_entries,
//   spawngroup, spawnentry, spawn2
//
// PII / server-private tables (account, character_*, ip_*, etc.) are NEVER touched.
//
// Env vars:
//   SUPABASE_URL                  required
//   SUPABASE_SERVICE_ROLE_KEY     required
//   DUMP_URL_OVERRIDE             optional — manual tarball URL (workflow_dispatch input)
//
// Notes on MySQL dump parsing: the upstream dumps are mysqldump output with
// `INSERT INTO ... VALUES (...), (...), ...;` statements. We parse those rows
// directly without spinning up a MySQL server. The parser is tolerant of:
//   - Multi-row INSERTs
//   - NULLs, escaped quotes, embedded commas in strings
//   - INSERT IGNORE / INSERT INTO `tablename`
// It deliberately does NOT support: triggers, stored procedures, complex
// column types — none of which appear in the EQEmu data tables we mirror.

const fs        = require('fs');
const fsp       = require('fs').promises;
const path      = require('path');
const os        = require('os');
const crypto    = require('crypto');
const zlib      = require('zlib');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GUILD_ID     = process.env.SUPABASE_GUILD_ID || 'wolfpack';
const DUMP_OVERRIDE = process.env.DUMP_URL_OVERRIDE || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, '..', 'data', 'sync_state.json');
const TMP_DIR    = path.join(os.tmpdir(), `quarm-sync-${process.pid}`);

// Tables to mirror — keys are upstream MySQL table names, values are Supabase
// table names (prefixed eqemu_) and column transforms.
const WHITELIST = {
  zone:                { dest: 'eqemu_zone',              transform: 'zone' },
  items:               { dest: 'eqemu_items',             transform: 'items' },
  npc_types:           { dest: 'eqemu_npc_types',         transform: 'npc_types' },
  loottable:           { dest: 'eqemu_loottable',         transform: 'loottable' },
  loottable_entries:   { dest: 'eqemu_loottable_entries', transform: 'loottable_entries' },
  lootdrop:            { dest: 'eqemu_lootdrop',          transform: 'lootdrop' },
  lootdrop_entries:    { dest: 'eqemu_lootdrop_entries',  transform: 'lootdrop_entries' },
  spawngroup:          { dest: 'eqemu_spawngroup',        transform: 'spawngroup' },
  spawnentry:          { dest: 'eqemu_spawnentry',        transform: 'spawnentry' },
  spawn2:              { dest: 'eqemu_spawn2',            transform: 'spawn2' },
};

// ── Supabase REST helper ────────────────────────────────────────────────────
async function sb(p, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1${p}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        opts.prefer || 'return=minimal',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const snippet = text.slice(0, 400);
    throw new Error(`${opts.method || 'GET'} ${p} → ${res.status}: ${snippet}`);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// ── Find the latest Quarm tarball via GitHub API ────────────────────────────
async function findLatestDump() {
  if (DUMP_OVERRIDE) {
    console.log(`Using DUMP_URL_OVERRIDE: ${DUMP_OVERRIDE}`);
    const m = DUMP_OVERRIDE.match(/quarm_[\w-]+\.tar\.gz/);
    return { url: DUMP_OVERRIDE, filename: m ? m[0] : 'quarm_manual.tar.gz', sha: null };
  }
  console.log('Querying GitHub for latest Quarm DB tarball…');
  const apiUrl = 'https://api.github.com/repos/SecretsOTheP/EQMacEmu/contents/utils/sql/database_full';
  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'QuarmBossTracker-sync', 'Accept': 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const files = await res.json();

  const quarmDumps = files
    .filter(f => /^quarm_.*\.tar\.gz$/.test(f.name))
    .sort((a, b) => (a.name < b.name ? 1 : -1));

  if (!quarmDumps.length) throw new Error('No quarm_*.tar.gz dumps found in upstream repo');
  const latest = quarmDumps[0];
  console.log(`Latest: ${latest.name}  (sha ${latest.sha})`);
  return { url: latest.download_url, filename: latest.name, sha: latest.sha };
}

// ── Download + extract ──────────────────────────────────────────────────────
async function downloadAndExtract(url, filename) {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const tarPath = path.join(TMP_DIR, filename);
  const extractDir = path.join(TMP_DIR, 'extracted');
  await fsp.mkdir(extractDir, { recursive: true });

  console.log(`Downloading ${url}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  await pipeline(res.body, fs.createWriteStream(tarPath));
  const stats = await fsp.stat(tarPath);
  console.log(`  ${(stats.size / 1024 / 1024).toFixed(1)} MB downloaded`);

  console.log(`Extracting…`);
  // Use system tar (always available on ubuntu-latest runners)
  await execFileP('tar', ['-xzf', tarPath, '-C', extractDir]);
  return extractDir;
}

// ── Locate SQL files inside the extracted dump ──────────────────────────────
async function findSqlFiles(extractDir) {
  // EQMacEmu dumps typically extract to a single subdirectory.
  // We walk to find .sql files matching our whitelist.
  const found = {};
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && entry.name.endsWith('.sql')) {
        const base = entry.name.replace(/\.sql$/, '');
        if (WHITELIST[base]) found[base] = p;
      }
    }
  }
  await walk(extractDir);

  // If individual table .sql files aren't present, look for a combined dump
  if (Object.keys(found).length === 0) {
    async function findCombined(dir) {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const r = await findCombined(p);
          if (r) return r;
        } else if (entry.isFile() && (entry.name.endsWith('.sql') || entry.name.endsWith('.sql.gz'))) {
          if (entry.name.includes('quarm') || entry.name.includes('alkabor') || entry.name === 'dump.sql') {
            return p;
          }
        }
      }
      return null;
    }
    const combined = await findCombined(extractDir);
    if (combined) {
      console.log(`Found combined dump: ${path.basename(combined)} — will scan for whitelisted tables`);
      return { mode: 'combined', file: combined };
    }
    throw new Error('No SQL files found in extracted dump');
  }

  return { mode: 'split', files: found };
}

// ── MySQL dump parser (just INSERT INTO statements) ─────────────────────────
// Returns an async iterator of { table, columns: [...], row: [...] }.
async function* iterInserts(filePath) {
  let stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  if (filePath.endsWith('.gz')) {
    stream = fs.createReadStream(filePath).pipe(zlib.createGunzip()).setEncoding('utf8');
  }

  let buffer = '';
  let columns = null;
  let currentTable = null;

  for await (const chunk of stream) {
    buffer += chunk;

    // Process complete statements terminated by ';\n' (mysqldump format)
    while (true) {
      const semiIdx = buffer.indexOf(';\n');
      if (semiIdx === -1) break;
      const stmt = buffer.slice(0, semiIdx + 1);
      buffer = buffer.slice(semiIdx + 2);

      // Track current table from "INSERT INTO `tbl`"
      const insMatch = stmt.match(/^\s*INSERT(?:\s+IGNORE)?\s+INTO\s+`?(\w+)`?(?:\s*\(([^)]*)\))?\s+VALUES\s*([\s\S]+);$/i);
      if (insMatch) {
        currentTable = insMatch[1];
        if (!WHITELIST[currentTable]) continue;

        // Column names from "(col1, col2, ...)" if present
        if (insMatch[2]) {
          columns = insMatch[2].split(',').map(s => s.trim().replace(/`/g, ''));
        }

        // Parse VALUES (...), (...), ... — each tuple is a row
        const valuesStr = insMatch[3];
        for (const row of splitTuples(valuesStr)) {
          yield { table: currentTable, columns, row };
        }
      }
    }
  }
}

// Parse "(v1, v2, ...), (v1, v2, ...)" into [[v1, v2, ...], [v1, v2, ...]]
// Handles quoted strings, escaped quotes, NULL, numbers.
function* splitTuples(valuesStr) {
  let i = 0;
  while (i < valuesStr.length) {
    // Skip whitespace and commas between tuples
    while (i < valuesStr.length && (valuesStr[i] === ' ' || valuesStr[i] === ',' || valuesStr[i] === '\n' || valuesStr[i] === '\r' || valuesStr[i] === '\t')) i++;
    if (valuesStr[i] !== '(') break;
    i++; // consume (

    const fields = [];
    let field = '';
    let inStr = false;
    let strChar = '';
    let depth = 1;

    while (i < valuesStr.length && depth > 0) {
      const ch = valuesStr[i];
      if (inStr) {
        if (ch === '\\' && i + 1 < valuesStr.length) {
          // Handle escapes — \', \", \\, \n, \r, \0
          const nxt = valuesStr[i + 1];
          if (nxt === "'") field += "'";
          else if (nxt === '"') field += '"';
          else if (nxt === '\\') field += '\\';
          else if (nxt === 'n') field += '\n';
          else if (nxt === 'r') field += '\r';
          else if (nxt === 't') field += '\t';
          else if (nxt === '0') field += '\0';
          else field += nxt;
          i += 2;
          continue;
        }
        if (ch === strChar) {
          inStr = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      // Not in a string
      if (ch === "'" || ch === '"') {
        inStr = true;
        strChar = ch;
        i++;
        continue;
      }
      if (ch === '(') { depth++; field += ch; i++; continue; }
      if (ch === ')') {
        depth--;
        if (depth === 0) { i++; break; }
        field += ch; i++; continue;
      }
      if (ch === ',') {
        fields.push(field.trim());
        field = '';
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    if (field.length || fields.length) fields.push(field.trim());

    // Coerce values: 'NULL' → null, numeric strings → number, quoted strings → as-is
    yield fields.map(f => {
      if (f === 'NULL' || f === '') return null;
      // Unquoted numeric?
      if (/^-?\d+$/.test(f)) return parseInt(f, 10);
      if (/^-?\d*\.\d+$/.test(f)) return parseFloat(f);
      return f;
    });
  }
}

// ── Row transforms (upstream column order → our table schema) ──────────────
// We don't trust column order from the dump — we use the column list from the
// INSERT statement if present, otherwise we apply known positional maps for
// the EQEmu schema (v1.x). All transforms return null if a row should be skipped.
const TRANSFORMS = {
  zone: (cols, row) => {
    const r = pick(cols, row, ['short_name', 'long_name', 'zoneidnumber', 'expansion', 'file', 'safe_x', 'safe_y', 'safe_z', 'min_status', 'note']);
    if (!r.short_name) return null;
    return { ...r, zone_id: r.zoneidnumber, zoneidnumber: undefined };
  },
  items: (cols, row) => {
    const r = pick(cols, row, ['id', 'name', 'lore', 'loregroup', 'nodrop', 'norent', 'magic', 'itemtype', 'slots', 'icon', 'weight', 'reclevel', 'reqlevel', 'classes', 'races', 'ac', 'hp', 'mana', 'damage', 'delay', 'focuseffect', 'proceffect', 'astr', 'asta', 'adex', 'aagi', 'aint', 'awis', 'acha', 'mr', 'cr', 'dr', 'fr', 'pr', 'price']);
    if (!r.id) return null;
    return {
      id: r.id, name: r.name, lore: r.lore,
      lore_flag: r.loregroup ? r.loregroup !== 0 : false,
      nodrop: !!toBool(r.nodrop),
      norent: !!toBool(r.norent),
      magic:  !!toBool(r.magic),
      itemtype: r.itemtype, slots: r.slots, icon: r.icon, weight: r.weight,
      recommended_level: r.reclevel, required_level: r.reqlevel,
      classes: r.classes, races: r.races,
      ac: r.ac, hp: r.hp, mana: r.mana, damage: r.damage, delay: r.delay,
      focus_effect: r.focuseffect, proc_effect: r.proceffect,
      str: r.astr, sta: r.asta, dex: r.adex, agi: r.aagi, intel: r.aint, wis: r.awis, cha: r.acha,
      mr: r.mr, cr: r.cr, dr: r.dr, fr: r.fr, pr: r.pr,
      price: r.price,
    };
  },
  npc_types: (cols, row) => {
    const r = pick(cols, row, ['id', 'name', 'lastname', 'level', 'race', 'class', 'bodytype', 'hp', 'mana', 'gender', 'texture', 'size', 'AC', 'mindmg', 'maxdmg', 'attack_count', 'aggroradius', 'assistradius', 'MR', 'CR', 'DR', 'FR', 'PR', 'see_invis', 'see_invis_undead', 'see_hide', 'see_improved_hide', 'npc_spells_id', 'loottable_id', 'runspeed', 'walkspeed', 'npc_faction_id', 'maxlevel', 'scalerate', 'raid_target', 'rare_spawn']);
    if (!r.id) return null;
    return {
      id: r.id, name: r.name, lastname: r.lastname,
      level: r.level, race: r.race, class: r.class, bodytype: r.bodytype,
      hp: r.hp, mana: r.mana, gender: r.gender, texture: r.texture, size: r.size,
      ac: r.AC, mindmg: r.mindmg, maxdmg: r.maxdmg, attack_count: r.attack_count,
      aggroradius: r.aggroradius, assistradius: r.assistradius,
      mr: r.MR, cr: r.CR, dr: r.DR, fr: r.FR, pr: r.PR,
      see_invis:         !!toBool(r.see_invis),
      see_invis_undead:  !!toBool(r.see_invis_undead),
      see_hide:          !!toBool(r.see_hide),
      see_improved_hide: !!toBool(r.see_improved_hide),
      npc_spells_id: r.npc_spells_id, loottable_id: r.loottable_id,
      runspeed: r.runspeed, walkspeed: r.walkspeed,
      npc_faction_id: r.npc_faction_id, maxlevel: r.maxlevel, scalerate: r.scalerate,
      raid_target:  !!toBool(r.raid_target),
      rare_spawn:   !!toBool(r.rare_spawn),
    };
  },
  loottable: (cols, row) => {
    const r = pick(cols, row, ['id', 'name', 'mincash', 'maxcash', 'avgcoin']);
    if (!r.id) return null; return r;
  },
  loottable_entries: (cols, row) => {
    const r = pick(cols, row, ['loottable_id', 'lootdrop_id', 'multiplier', 'droplimit', 'mindrop', 'probability']);
    if (!r.loottable_id || !r.lootdrop_id) return null; return r;
  },
  lootdrop: (cols, row) => {
    const r = pick(cols, row, ['id', 'name']);
    if (!r.id) return null; return r;
  },
  lootdrop_entries: (cols, row) => {
    const r = pick(cols, row, ['lootdrop_id', 'item_id', 'item_charges', 'equip_item', 'chance', 'minlevel', 'maxlevel', 'multiplier', 'disabled_chance']);
    if (!r.lootdrop_id || !r.item_id) return null;
    return { ...r, equip_item: !!toBool(r.equip_item) };
  },
  spawngroup: (cols, row) => {
    const r = pick(cols, row, ['id', 'name']);
    if (!r.id) return null; return r;
  },
  spawnentry: (cols, row) => {
    const r = pick(cols, row, ['spawngroupID', 'npcID', 'chance']);
    if (!r.spawngroupID || !r.npcID) return null;
    return { spawngroup_id: r.spawngroupID, npc_id: r.npcID, chance: r.chance };
  },
  spawn2: (cols, row) => {
    const r = pick(cols, row, ['id', 'spawngroupID', 'zone', 'x', 'y', 'z', 'heading', 'respawntime', 'variance', 'pathgrid', 'enabled']);
    if (!r.id) return null;
    return {
      id: r.id, spawngroup_id: r.spawngroupID, zone_short: r.zone,
      x: r.x, y: r.y, z: r.z, heading: r.heading,
      respawntime: r.respawntime, variance: r.variance, pathgrid: r.pathgrid,
      enabled: r.enabled === null ? true : !!toBool(r.enabled),
    };
  },
};

function pick(cols, row, wanted) {
  const out = {};
  if (cols && cols.length) {
    for (const w of wanted) {
      const idx = cols.indexOf(w);
      if (idx !== -1) out[w] = row[idx];
    }
  } else {
    // No columns from INSERT — we can't reliably map. Just zip in order.
    for (let i = 0; i < wanted.length && i < row.length; i++) {
      out[wanted[i]] = row[i];
    }
  }
  return out;
}

function toBool(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v === 'true' || v === 'TRUE';
  return false;
}

// ── Upsert in chunks ────────────────────────────────────────────────────────
async function upsertChunks(dest, rows, primaryKeyCols) {
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const onConflict = primaryKeyCols.join(',');
    await sb(`/${dest}?on_conflict=${onConflict}`, {
      method: 'POST',
      body:   chunk,
      prefer: 'return=minimal,resolution=merge-duplicates',
    });
    upserted += chunk.length;
    process.stdout.write(`\r    ${dest}: ${upserted} / ${rows.length}`);
  }
  process.stdout.write('\n');
  return upserted;
}

const PK_MAP = {
  eqemu_zone:              ['short_name'],
  eqemu_items:             ['id'],
  eqemu_npc_types:         ['id'],
  eqemu_loottable:         ['id'],
  eqemu_loottable_entries: ['loottable_id', 'lootdrop_id'],
  eqemu_lootdrop:          ['id'],
  eqemu_lootdrop_entries:  ['lootdrop_id', 'item_id'],
  eqemu_spawngroup:        ['id'],
  eqemu_spawnentry:        ['spawngroup_id', 'npc_id'],
  eqemu_spawn2:            ['id'],
};

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Quarm DB sync — ${new Date().toISOString()}`);
  const dump = await findLatestDump();

  // Have we already synced this exact dump? Skip if yes (idempotent).
  let prevState = {};
  try { prevState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  if (prevState.last_dump_sha && prevState.last_dump_sha === dump.sha) {
    console.log(`✅ Already synced ${dump.filename} (sha ${dump.sha}) — nothing to do`);
    return;
  }

  const extractDir = await downloadAndExtract(dump.url, dump.filename);
  const sql        = await findSqlFiles(extractDir);

  // Buffer rows per destination table
  const buffers = {};
  let totalRows = 0;

  const filesToScan = sql.mode === 'split'
    ? Object.entries(sql.files)
    : [['__combined__', sql.file]];

  for (const [name, file] of filesToScan) {
    console.log(`Reading ${sql.mode === 'split' ? name + '.sql' : path.basename(file)}…`);
    for await (const { table, columns, row } of iterInserts(file)) {
      const wl = WHITELIST[table];
      if (!wl) continue;
      const out = TRANSFORMS[wl.transform](columns, row);
      if (!out) continue;
      buffers[wl.dest] = buffers[wl.dest] || [];
      buffers[wl.dest].push(out);
      totalRows++;
    }
  }

  console.log(`Parsed ${totalRows} rows from ${Object.keys(buffers).length} destination tables`);

  const counts = {};
  // Upsert in dependency order (parents before children)
  const ORDER = [
    'eqemu_zone', 'eqemu_items', 'eqemu_npc_types',
    'eqemu_loottable', 'eqemu_lootdrop', 'eqemu_loottable_entries', 'eqemu_lootdrop_entries',
    'eqemu_spawngroup', 'eqemu_spawnentry', 'eqemu_spawn2',
  ];
  for (const dest of ORDER) {
    if (!buffers[dest] || !buffers[dest].length) continue;
    console.log(`  → ${dest} (${buffers[dest].length} rows)`);
    counts[dest] = await upsertChunks(dest, buffers[dest], PK_MAP[dest]);
  }

  // Record sync_meta + sync_state
  await sb('/sync_meta', {
    method: 'POST',
    body:   [{
      dump_date:       dump.filename,
      dump_commit_sha: dump.sha,
      tables_synced:   Object.keys(counts),
      row_counts:      counts,
    }],
  });

  const newState = {
    last_run:        new Date().toISOString(),
    last_dump:       dump.filename,
    last_dump_sha:   dump.sha,
    counts,
    total_rows:      totalRows,
  };
  await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fsp.writeFile(STATE_FILE, JSON.stringify(newState, null, 2));

  // For the workflow's commit-message step
  const summary = `${dump.filename} (${totalRows} rows)`;
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${summary}\n`);
  }
  console.log(`✅ Sync complete: ${summary}`);

  // Cleanup tmp
  await fsp.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
