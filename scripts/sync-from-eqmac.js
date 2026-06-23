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

// Env vars only required when running the sync (not when required as a module by tests)
if (require.main === module && (!SUPABASE_URL || !SUPABASE_KEY)) {
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
  spells_new:          { dest: 'eqemu_spells',            transform: 'spells' },
  // NPC spell-list catalog. npc_spells = list metadata + global proc fallback;
  // npc_spells_entries = the per-list spell rows (manacost, recast, priority,
  // level range). Joined into eqemu_npc_types via npc_spells_id. Powers Mob
  // Info "Spells" tab + caster-mob mana tracking.
  npc_spells:          { dest: 'eqemu_npc_spells',         transform: 'npc_spells' },
  npc_spells_entries:  { dest: 'eqemu_npc_spells_entries', transform: 'npc_spells_entries' },
  // AA data — for inferring buff durations (Spell Casting Reinforcement etc.)
  // and resolving the numeric AA ids in a player's Quarmy AAIndex to a name +
  // per-rank effect. altadv_vars = the AA list (name is a real column, so ids
  // resolve directly); aa_effects = per-rank effect (effectid=SPA, base1=value,
  // e.g. the 5/15/30% on a duration AA).
  altadv_vars:         { dest: 'eqemu_altadv_vars',       transform: 'altadv_vars' },
  aa_effects:          { dest: 'eqemu_aa_effects',        transform: 'aa_effects' },
  // Faction resolution. faction_list = faction id → name (+ PQDI faction id).
  // npc_faction = the per-mob faction "slot" (id referenced by
  // npc_types.npc_faction_id) → primaryfaction (the faction_list id of the
  // mob's home faction). npc_faction_entries = the full hit list a kill
  // grants. faction_list_mod = per-race/class/deity adjustments to baseline
  // (mod_name is one of r<N>/c<N>/d<N>, joining characters.race/class/deity_id
  // so we can compute the user's actual starting standing per faction).
  // From Al'Kabor (Quarm parent dump) — Quarm content tarball omits these.
  faction_list:        { dest: 'eqemu_faction_list_full',    transform: 'faction_list_full' },
  faction_list_mod:    { dest: 'eqemu_faction_list_mod',     transform: 'faction_list_mod' },
  npc_faction:         { dest: 'eqemu_npc_faction',          transform: 'npc_faction' },
  npc_faction_entries: { dest: 'eqemu_npc_faction_entries',  transform: 'npc_faction_entries' },
  // Quest tracker source: tradeskill recipes + per-component item list.
  tradeskill_recipe:         { dest: 'eqemu_tradeskill_recipe',         transform: 'tradeskill_recipe' },
  tradeskill_recipe_entries: { dest: 'eqemu_tradeskill_recipe_entries', transform: 'tradeskill_recipe_entries' },
  // World navigation (zone connections, locked doors, ground spawns, forage).
  doors:               { dest: 'eqemu_doors',                transform: 'doors' },
  zone_points:         { dest: 'eqemu_zone_points',          transform: 'zone_points' },
  ground_spawns:       { dest: 'eqemu_ground_spawns',        transform: 'ground_spawns' },
  forage:              { dest: 'eqemu_forage',               transform: 'forage' },
  fishing:             { dest: 'eqemu_fishing',              transform: 'fishing' },
  // Merchant inventories + placed objects + mob chatter.
  merchantlist:        { dest: 'eqemu_merchantlist',         transform: 'merchantlist' },
  object:              { dest: 'eqemu_object',               transform: 'object' },
  npc_emotes:          { dest: 'eqemu_npc_emotes',           transform: 'npc_emotes' },
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

// ── Al'Kabor fallback dump for tables the Quarm content snapshot omits ─────
// The Quarm tarball only carries the live-server snapshot tables (factions,
// recipes, doors, merchant lists, etc. are CLASSIC-static and live in the
// TAKP/Al'Kabor parent dump). For any whitelisted table we don't see in the
// Quarm dump we fall back to scanning the latest Al'Kabor tarball — same
// CREATE TABLE + INSERT mysqldump format, just a different file. Uilnayar
// 2026-06-23 — "we need our own version of the DB for a complete picture."
async function findAlkaborDump() {
  console.log('Querying GitHub for latest Al\'Kabor DB tarball (fallback source)…');
  const apiUrl = 'https://api.github.com/repos/SecretsOTheP/EQMacEmu/contents/utils/sql/database_full';
  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'QuarmBossTracker-sync', 'Accept': 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const files = await res.json();
  const akDumps = files
    .filter(f => /^alkabor_.*\.tar\.gz$/.test(f.name))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  if (!akDumps.length) {
    console.warn('  no alkabor_*.tar.gz found — skipping fallback');
    return null;
  }
  const latest = akDumps[0];
  console.log(`  Al'Kabor: ${latest.name}  (sha ${latest.sha})`);
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

// ── MySQL dump parser (CREATE TABLE + INSERT INTO statements) ──────────────
// Returns an async iterator of { table, columns: [...], row: [...] }.
//
// mysqldump's default INSERT form is bare: `INSERT INTO `t` VALUES (...)` with
// NO inline column list. To map values to column names correctly we read the
// CREATE TABLE statement that precedes the INSERTs and remember its column
// order. Without this, position-based fallback would shove e.g. `long_name`
// ("Acrylia Caverns") into a `zone_id` (int) slot and Postgres rejects it
// with 22P02.
async function* iterInserts(filePath) {
  let stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  if (filePath.endsWith('.gz')) {
    stream = fs.createReadStream(filePath).pipe(zlib.createGunzip()).setEncoding('utf8');
  }

  let buffer = '';
  let currentTable = null;
  const tableColumns = {}; // upstream table name → column order from CREATE TABLE

  for await (const chunk of stream) {
    buffer += chunk;

    // Process complete statements terminated by ';\n' (mysqldump format)
    while (true) {
      const semiIdx = buffer.indexOf(';\n');
      if (semiIdx === -1) break;
      const stmt = buffer.slice(0, semiIdx + 1);
      buffer = buffer.slice(semiIdx + 2);

      // CREATE TABLE — capture column order. mysqldump formats one column per
      // line as: `  `col_name` <type> ... ,` and constraint/key lines start
      // with PRIMARY/UNIQUE/KEY/CONSTRAINT/FULLTEXT/FOREIGN (no leading backtick).
      const createMatch = stmt.match(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(/i);
      if (createMatch) {
        const tname = createMatch[1];
        const cols = [];
        for (const line of stmt.split('\n')) {
          const m = line.match(/^\s*`([^`]+)`\s+\S/);
          if (m) cols.push(m[1]);
        }
        if (cols.length) tableColumns[tname] = cols;
        continue;
      }

      // INSERT INTO `tbl` [(cols)] VALUES (...)
      const insMatch = stmt.match(/^\s*INSERT(?:\s+IGNORE)?\s+INTO\s+`?(\w+)`?(?:\s*\(([^)]*)\))?\s+VALUES\s*([\s\S]+);$/i);
      if (insMatch) {
        currentTable = insMatch[1];
        if (!WHITELIST[currentTable]) continue;

        // Prefer inline column list; fall back to CREATE TABLE columns
        let columns = null;
        if (insMatch[2]) {
          columns = insMatch[2].split(',').map(s => s.trim().replace(/`/g, ''));
        } else if (tableColumns[currentTable]) {
          columns = tableColumns[currentTable];
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

    // Track each field as either bare (NULL / number / bareword) or quoted
    // (always a string, even if the contents look numeric or empty). Without
    // this, a spawngroup name of '159183' coerces to the integer 159183 and
    // an empty quoted name '' coerces to NULL → NOT NULL violation.
    const fields = []; // [{val, quoted}]
    let field = '';
    let fieldQuoted = false;
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
          else if (nxt === '0') { /* drop \0 — Postgres text cannot store null bytes (22P05) */ }
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
        fieldQuoted = true;
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
        fields.push({ val: field.trim(), quoted: fieldQuoted });
        field = '';
        fieldQuoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    if (field.length || fields.length || fieldQuoted) {
      fields.push({ val: field.trim(), quoted: fieldQuoted });
    }

    // Coerce. Quoted → always string (strip null bytes per 22P05). Bare →
    // 'NULL' → null, numeric → number, anything else → string.
    yield fields.map(({ val: f, quoted }) => {
      if (quoted) return f.replace(/\u0000/g, '');
      if (f === 'NULL' || f === '') return null;
      if (/^-?\d+$/.test(f)) return parseInt(f, 10);
      if (/^-?\d*\.\d+$/.test(f)) return parseFloat(f);
      return f.replace(/\u0000/g, '');
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
    const r = pick(cols, row, ['id', 'name', 'lore', 'loregroup', 'nodrop', 'norent', 'magic', 'itemtype', 'slots', 'icon', 'weight', 'reclevel', 'reqlevel', 'classes', 'races', 'ac', 'hp', 'mana', 'damage', 'delay', 'focuseffect', 'proceffect', 'astr', 'asta', 'adex', 'aagi', 'aint', 'awis', 'acha', 'mr', 'cr', 'dr', 'fr', 'pr', 'price', 'casttime', 'clickeffect', 'clicktype', 'clicklevel', 'worneffect', 'worntype', 'attack', 'haste', 'regen', 'manaregen', 'damageshield']);
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
      // Click effect — feeds the Mimic melody overlay's cast-time progress
      // bar when a player triggers an item (Robe of the Spring → Skin like
      // Nature is 12s on the item but 5s on the bare spell). Without these
      // the bar fills at the wrong rate for every clicky.
      casttime: r.casttime, clickeffect: r.clickeffect,
      clicktype: r.clicktype, clicklevel: r.clicklevel,
      // Worn/stat columns for the Quarmy gear analysis (character gear pages:
      // worn effects like Fire Fist / infravision, +ATK recommendations).
      worneffect: r.worneffect, worntype: r.worntype,
      attack: r.attack, haste: r.haste,
      regen: r.regen, manaregen: r.manaregen, damageshield: r.damageshield,
    };
  },
  npc_types: (cols, row) => {
    const r = pick(cols, row, ['id', 'name', 'lastname', 'level', 'race', 'class', 'bodytype', 'hp', 'mana', 'gender', 'texture', 'size', 'AC', 'mindmg', 'maxdmg', 'attack_count', 'aggroradius', 'assistradius', 'MR', 'CR', 'DR', 'FR', 'PR', 'see_invis', 'see_invis_undead', 'see_hide', 'see_improved_hide', 'npc_spells_id', 'loottable_id', 'runspeed', 'walkspeed', 'npc_faction_id', 'maxlevel', 'scalerate', 'raid_target', 'rare_spawn', 'npcspecialattks', 'special_abilities']);
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
      // Special-attack flags for the mob-info overlay. npcspecialattks is the
      // classic letter-flag string EQMac carries (S/E/F/m/R/r/T/Q…); decoded
      // for display by the bot's mob-info endpoint. special_abilities is the
      // newer parametrized form — kept too if the dump ever switches.
      npcspecialattks:   (r.npcspecialattks  != null && r.npcspecialattks  !== '') ? String(r.npcspecialattks)  : null,
      special_abilities: (r.special_abilities != null && r.special_abilities !== '') ? String(r.special_abilities) : null,
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
  // spells_new → eqemu_spells. Beyond the proc/effect columns the threat calc
  // already wanted, we pull the three CLIENT message strings — cast_on_you,
  // cast_on_other, spell_fades — which are EQ's exact landing text:
  //   cast_on_you  = "You feel a little better."
  //   cast_on_other= " feels a little better."   (client prepends the name)
  //   spell_fades  = "Your skin returns to normal."
  // These power (a) name→PQDI-id links on the agent dashboard and (b) message→
  // spell inference (matching effect lines in the log to the spell that landed).
  // Names are the standard EQEmu/EQMacEmu spells_new columns; pick() is
  // case-insensitive and tolerant, so an absent column simply lands NULL.
  spells: (cols, row) => {
    const SLOT_COLS = [];
    for (let i = 1; i <= 12; i++) {
      SLOT_COLS.push(`effectid${i}`, `effect_base_value${i}`, `effect_id_${i}`, `effect_base_value_${i}`, `max${i}`, `formula${i}`);
    }
    const r = pick(cols, row, [
      'id', 'name', 'mana', 'buffduration', 'buffdurationformula', 'recourse_link',
      'targettype', 'skill',
      ...SLOT_COLS,
      'cast_time', 'recast_time', 'pushback', 'zonetype',
      'cast_on_you', 'cast_on_other', 'spell_fades',
      'goodEffect', 'good_effect',
      // Resist family — EQEmu schemas have varied: classic `resisttype`/
      // `ResistDiff`, modern `resist_type`/`resist_diff`. Accept both.
      'resisttype', 'resist_type',
      'ResistDiff', 'resistdiff', 'resist_diff',
    ]);
    if (!r.id || !r.name) return null;
    // EQEmu has historically used both `effectid1` and `effect_id_1` styles
    // across forks — accept either so the effect columns aren't silently NULL.
    const eff = (a, b) => (r[a] !== undefined ? r[a] : r[b]);
    // Full 12-slot effect arrays → the raw JSONB column. The 3 dedicated
    // columns cover proc-hate detection, but focus decoding (improved
    // damage/heal + limit slots), Flowing Thought (SPA 15 rides slots 4+),
    // and worn-haste % (needs the max value) all live in later slots. One
    // JSONB beats 48 new columns.
    const slotIds = [], slotBases = [], slotMaxes = [], slotFormulas = [];
    for (let i = 1; i <= 12; i++) {
      slotIds.push(eff(`effect_id_${i}`, `effectid${i}`) ?? null);
      slotBases.push(eff(`effect_base_value_${i}`, `effect_base_value${i}`) ?? null);
      slotMaxes.push(r[`max${i}`] ?? null);
      slotFormulas.push(r[`formula${i}`] ?? null);
    }
    return {
      raw: { eff: slotIds, base: slotBases, max: slotMaxes, formula: slotFormulas },
      id: r.id, name: r.name, mana: r.mana,
      buffduration: r.buffduration, buffdurationformula: r.buffdurationformula,
      recourse_link: r.recourse_link, targettype: r.targettype, skill: r.skill,
      effect_id_1: eff('effect_id_1', 'effectid1'),
      effect_base_value_1: eff('effect_base_value_1', 'effect_base_value1'),
      effect_id_2: eff('effect_id_2', 'effectid2'),
      effect_base_value_2: eff('effect_base_value_2', 'effect_base_value2'),
      effect_id_3: eff('effect_id_3', 'effectid3'),
      effect_base_value_3: eff('effect_base_value_3', 'effect_base_value3'),
      cast_time: r.cast_time, recast_time: r.recast_time,
      pushback: r.pushback, zonetype: r.zonetype,
      cast_on_you: r.cast_on_you || null,
      cast_on_other: r.cast_on_other || null,
      spell_fades: r.spell_fades || null,
      // 1 = beneficial (buff), 0 = detrimental (debuff). Drives buff/debuff
      // coloring in the overlays. EQEmu column is `goodEffect`; accept snake too.
      good_effect: eff('good_effect', 'goodEffect'),
      // Resist type → 0 unresistable / 1 Magic / 2 Fire / 3 Cold / 4 Poison /
      // 5 Disease / 6 Chromatic / 7 Prismatic. ResistDiff is negative = "lure"
      // (harder to resist by that amount). Drives the Mob Info spell list's
      // resist column ("Magic -200 lure" etc.).
      resist_type: eff('resist_type', 'resisttype'),
      resist_diff: r.ResistDiff !== undefined ? r.ResistDiff
                 : r.resistdiff   !== undefined ? r.resistdiff
                 : r.resist_diff,
    };
  },
  // NPC spell-list metadata. id = the list (referenced by eqemu_npc_types.
  // npc_spells_id); parent_list = inheritance (a list inherits its parent's
  // entries); attack_proc + proc_chance = the global proc fallback when the
  // NPC isn't engaged with a specific spell. The rest are engage/idle/pursue
  // recast / chance tuning that we keep verbatim for future use.
  npc_spells: (cols, row) => {
    const r = pick(cols, row, [
      'id', 'name', 'parent_list', 'attack_proc', 'proc_chance',
      'range_proc', 'rproc_chance', 'defensive_proc', 'dproc_chance', 'fail_recast',
      'engaged_no_sp_recast_min', 'engaged_no_sp_recast_max',
      'engaged_b_self_chance', 'engaged_b_other_chance', 'engaged_d_chance',
      'pursue_no_sp_recast_min', 'pursue_no_sp_recast_max', 'pursue_d_chance',
      'idle_no_sp_recast_min', 'idle_no_sp_recast_max', 'idle_b_chance',
    ]);
    if (r.id == null) return null;
    return r;
  },
  // Per-(list, spell, minlevel) entry. type = bitmask of when the NPC will use
  // this spell (engaged-d / engaged-b / pursue-d / idle-b); manacost = the
  // override (-1 = pull from spell catalog); recast_delay is per-spell cooldown.
  // priority orders the AI's pick within a triggered category.
  npc_spells_entries: (cols, row) => {
    const r = pick(cols, row, [
      'npc_spells_id', 'spellid', 'minlevel', 'maxlevel', 'type',
      'manacost', 'recast_delay', 'priority', 'resist_adjust', 'min_hp', 'max_hp',
    ]);
    if (r.npc_spells_id == null || r.spellid == null || r.minlevel == null) return null;
    return r;
  },
  // AA definition list. skill_id is the per-rank/internal id; eqmacid is the
  // grouped Mac-client ability id (this is what a Quarmy AAIndex row references).
  // name is a real display name. classes is a class bitmask; max_level = ranks.
  altadv_vars: (cols, row) => {
    const r = pick(cols, row, ['skill_id', 'eqmacid', 'name', 'cost', 'max_level', 'type', 'spell_type', 'prereq_skill', 'prereq_minpoints', 'spellid', 'classes', 'class_type', 'aa_expansion', 'special_category', 'level_inc', 'cost_inc']);
    if (r.skill_id == null) return null;
    return {
      skill_id: r.skill_id, eqmacid: r.eqmacid, name: r.name,
      cost: r.cost, max_level: r.max_level, type: r.type, spell_type: r.spell_type,
      prereq_skill: r.prereq_skill, prereq_minpoints: r.prereq_minpoints,
      spellid: r.spellid, classes: r.classes, class_type: r.class_type,
      aa_expansion: r.aa_expansion, special_category: r.special_category,
      level_inc: r.level_inc, cost_inc: r.cost_inc,
    };
  },
  // Per-(aaid, slot) AA effect. effectid = SPA; base1/base2 = values. The
  // buff-duration % (e.g. 5/15/30 on Spell Casting Reinforcement) lives in base1.
  aa_effects: (cols, row) => {
    const r = pick(cols, row, ['aaid', 'slot', 'effectid', 'base1', 'base2']);
    if (r.aaid == null || r.slot == null) return null;
    return { aaid: r.aaid, slot: r.slot, effectid: r.effectid, base1: r.base1, base2: r.base2 };
  },
  // faction_list_full → id, name, base (everyone starts at this), see_illusion,
  // min/max cap. Powers PQDI link + the per-character baseline computation.
  faction_list_full: (cols, row) => {
    const r = pick(cols, row, ['id', 'name', 'base', 'see_illusion', 'min_cap', 'max_cap']);
    if (r.id == null) return null;
    return {
      id: r.id, name: r.name,
      base:         r.base         ?? 0,
      see_illusion: r.see_illusion ?? 1,
      min_cap:      r.min_cap      ?? 0,
      max_cap:      r.max_cap      ?? 0,
    };
  },
  // faction_list_mod → race/class/deity adjustments. mod_name encoded as
  // r<N>/c<N>/d<N>; join characters.race/class/deity_id to get the per-user
  // faction base. Confirmed encoding from Al'Kabor: c1-c15 (15 classes),
  // d201-d216 (16 deities), r<N> (race ids, incl. 128 Iksar, 130 Vah Shir).
  faction_list_mod: (cols, row) => {
    const r = pick(cols, row, ['id', 'faction_id', 'mod', 'mod_name']);
    if (r.id == null || r.faction_id == null || !r.mod_name) return null;
    return {
      id: r.id, faction_id: r.faction_id,
      mod: r.mod ?? 0,
      mod_name: String(r.mod_name).slice(0, 16),
    };
  },
  // npc_faction → per-mob faction slot. id is referenced by
  // npc_types.npc_faction_id; primaryfaction is the faction_list id of the
  // mob's home faction (what we display + link).
  npc_faction: (cols, row) => {
    const r = pick(cols, row, ['id', 'name', 'primaryfaction', 'ignore_primary_assist']);
    if (r.id == null) return null;
    return {
      id: r.id, name: r.name,
      primaryfaction:        r.primaryfaction        ?? 0,
      ignore_primary_assist: r.ignore_primary_assist ?? 0,
    };
  },
  // npc_faction_entries → every faction a kill of this npc_faction touches.
  npc_faction_entries: (cols, row) => {
    const r = pick(cols, row, ['npc_faction_id', 'faction_id', 'value', 'npc_value', 'temp', 'sort_order']);
    if (r.npc_faction_id == null || r.faction_id == null) return null;
    return {
      npc_faction_id: r.npc_faction_id, faction_id: r.faction_id,
      value:      r.value      ?? 0,
      npc_value:  r.npc_value  ?? 0,
      temp:       r.temp       ?? 0,
      sort_order: r.sort_order ?? 0,
    };
  },
  // Tradeskill recipes. notes carries the in-game recipe description (handy
  // for matching quest steps); quest flag = is-quest-step (vs a player recipe).
  tradeskill_recipe: (cols, row) => {
    const r = pick(cols, row, ['id', 'name', 'tradeskill', 'skillneeded', 'trivial', 'nofail', 'replace_container', 'notes', 'must_learn', 'quest']);
    if (r.id == null) return null;
    return {
      id: r.id, name: r.name,
      tradeskill: r.tradeskill ?? null, skillneeded: r.skillneeded ?? null,
      trivial: r.trivial ?? null, nofail: r.nofail ?? 0,
      replace_container: r.replace_container ?? 0, notes: r.notes ?? null,
      must_learn: r.must_learn ?? 0, quest: r.quest ?? 0,
    };
  },
  tradeskill_recipe_entries: (cols, row) => {
    const r = pick(cols, row, ['id', 'recipe_id', 'item_id', 'successcount', 'failcount', 'componentcount', 'salvagecount', 'iscontainer']);
    if (r.id == null || r.recipe_id == null) return null;
    return {
      id: r.id, recipe_id: r.recipe_id,
      item_id: r.item_id ?? null,
      successcount:   r.successcount   ?? 0,
      failcount:      r.failcount      ?? 0,
      componentcount: r.componentcount ?? 0,
      salvagecount:   r.salvagecount   ?? 0,
      iscontainer:    r.iscontainer    ?? 0,
    };
  },
  doors: (cols, row) => {
    const r = pick(cols, row, ['id', 'doorid', 'zone', 'version', 'name', 'pos_x', 'pos_y', 'pos_z', 'heading',
      'opentype', 'guild', 'lockpick', 'keyitem', 'nokeyring', 'triggerdoor', 'triggertype', 'doorisopen',
      'dest_zone', 'dest_instance', 'dest_x', 'dest_y', 'dest_z', 'dest_heading',
      'invert_state', 'incline', 'size', 'client_version_mask']);
    if (r.id == null) return null;
    return r;
  },
  zone_points: (cols, row) => {
    const r = pick(cols, row, ['id', 'zone', 'number', 'x', 'y', 'z', 'heading',
      'target_x', 'target_y', 'target_z', 'target_zone_id', 'heading_target', 'client_version_mask']);
    if (r.id == null) return null;
    return r;
  },
  ground_spawns: (cols, row) => {
    const r = pick(cols, row, ['id', 'zoneid', 'version', 'max_x', 'max_y', 'max_z', 'min_x', 'min_y', 'heading',
      'name', 'item', 'max_allowed', 'respawn_timer']);
    if (r.id == null) return null;
    return r;
  },
  forage: (cols, row) => {
    const r = pick(cols, row, ['id', 'zoneid', 'itemid', 'level', 'chance',
      'min_expansion', 'max_expansion', 'content_flags', 'content_flags_disabled']);
    if (r.id == null) return null;
    return r;
  },
  fishing: (cols, row) => {
    const r = pick(cols, row, ['id', 'zoneid', 'itemid', 'skill_level', 'chance', 'npc_id', 'npc_chance',
      'min_expansion', 'max_expansion', 'content_flags', 'content_flags_disabled']);
    if (r.id == null) return null;
    return r;
  },
  merchantlist: (cols, row) => {
    const r = pick(cols, row, ['merchantid', 'slot', 'item', 'faction_required', 'level_required',
      'alt_currency_cost', 'classes_required', 'min_expansion', 'max_expansion',
      'content_flags', 'content_flags_disabled', 'probability']);
    if (r.merchantid == null || r.slot == null) return null;
    return r;
  },
  object: (cols, row) => {
    const r = pick(cols, row, ['id', 'zoneid', 'xpos', 'ypos', 'zpos', 'heading',
      'itemid', 'charges', 'objectname', 'type', 'icon',
      'unknown08', 'unknown10', 'unknown20', 'min_expansion', 'max_expansion']);
    if (r.id == null) return null;
    return r;
  },
  // upstream column is `event` which is a SQL reserved word; remap to event_.
  npc_emotes: (cols, row) => {
    const r = pick(cols, row, ['emoteid', 'event', 'type', 'text']);
    if (r.emoteid == null) return null;
    return {
      emoteid: r.emoteid,
      event_:  r.event ?? null,
      type:    r.type  ?? null,
      text:    r.text  ?? null,
    };
  },
};

function pick(cols, row, wanted) {
  const out = {};
  if (cols && cols.length) {
    // Case-insensitive lookup: upstream EQMacEmu mixes cases across tables
    // (e.g. `items.Name`, `npc_types.AC` vs `npc_types.name`). Build a
    // lowercase → index map so transforms can use any case in their `wanted`
    // list without breaking when upstream column casing differs.
    const lcIndex = {};
    for (let i = 0; i < cols.length; i++) lcIndex[cols[i].toLowerCase()] = i;
    for (const w of wanted) {
      const idx = lcIndex[w.toLowerCase()];
      if (idx !== undefined) out[w] = row[idx];
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
  eqemu_spells:            ['id'],
  eqemu_npc_spells:        ['id'],
  eqemu_npc_spells_entries:['npc_spells_id', 'spellid', 'minlevel'],
  eqemu_altadv_vars:       ['skill_id'],
  eqemu_aa_effects:        ['aaid', 'slot'],
  eqemu_faction_list_full:           ['id'],
  eqemu_faction_list_mod:            ['id'],
  eqemu_npc_faction:                 ['id'],
  eqemu_npc_faction_entries:         ['npc_faction_id', 'faction_id'],
  eqemu_tradeskill_recipe:           ['id'],
  eqemu_tradeskill_recipe_entries:   ['id'],
  eqemu_doors:                       ['id'],
  eqemu_zone_points:                 ['id'],
  eqemu_ground_spawns:               ['id'],
  eqemu_forage:                      ['id'],
  eqemu_fishing:                     ['id'],
  eqemu_merchantlist:                ['merchantid', 'slot'],
  eqemu_object:                      ['id'],
  eqemu_npc_emotes:                  ['emoteid'],
};

// ── Exports for tests ───────────────────────────────────────────────────────
module.exports = { iterInserts, splitTuples, pick, toBool, TRANSFORMS, WHITELIST, PK_MAP };

// Skip the IIFE when this file is loaded as a module (e.g. by test-sync-parser.js)
if (require.main !== module) return;

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Quarm DB sync — ${new Date().toISOString()}`);
  const dump = await findLatestDump();

  // Have we already synced this exact dump? Skip if yes (idempotent) — UNLESS
  // FORCE_RESYNC is set. Force is needed when the dump is unchanged but the
  // WHITELIST grew (new mirror tables added in code), so a re-import of the
  // same dump is required to populate them (Uilnayar 2026-06-23 — faction
  // tables added; the unchanged-dump short-circuit was skipping them).
  let prevState = {};
  try { prevState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  const forceResync = String(process.env.FORCE_RESYNC || '').toLowerCase() === 'true';
  if (!forceResync && prevState.last_dump_sha && prevState.last_dump_sha === dump.sha) {
    console.log(`✅ Already synced ${dump.filename} (sha ${dump.sha}) — nothing to do (set FORCE_RESYNC=true to re-import)`);
    return;
  }
  if (forceResync) console.log('⚙ FORCE_RESYNC set — re-importing even though the dump sha is unchanged.');

  const extractDir = await downloadAndExtract(dump.url, dump.filename);
  const sql        = await findSqlFiles(extractDir);

  // Buffer rows per destination table
  const buffers = {};
  let totalRows = 0;

  const filesToScan = sql.mode === 'split'
    ? Object.entries(sql.files)
    : [['__combined__', sql.file]];

  // Tables seen-or-not in the primary (Quarm) dump → drives Al'Kabor fallback.
  const seenInPrimary = new Set();
  for (const [name, file] of filesToScan) {
    console.log(`Reading ${sql.mode === 'split' ? name + '.sql' : path.basename(file)}…`);
    for await (const { table, columns, row } of iterInserts(file)) {
      const wl = WHITELIST[table];
      if (!wl) continue;
      seenInPrimary.add(table);
      const out = TRANSFORMS[wl.transform](columns, row);
      if (!out) continue;
      buffers[wl.dest] = buffers[wl.dest] || [];
      buffers[wl.dest].push(out);
      totalRows++;
    }
  }

  // ── Al'Kabor fallback: any whitelisted table the Quarm dump didn't carry
  //     gets pulled from the latest alkabor_*.tar.gz (TAKP parent, same
  //     mysqldump format). Classic-static tables (factions, recipes, doors,
  //     merchant lists, ground spawns, …) live there.
  const missing = Object.keys(WHITELIST).filter(t => !seenInPrimary.has(t));
  if (missing.length > 0) {
    console.log(`Al'Kabor fallback needed for ${missing.length} table(s): ${missing.join(', ')}`);
    const akDump = await findAlkaborDump();
    if (akDump) {
      const akExtract = await downloadAndExtract(akDump.url, akDump.filename);
      const akSql = await findSqlFiles(akExtract);
      const akFiles = akSql.mode === 'split'
        ? Object.entries(akSql.files)
        : [['__combined__', akSql.file]];
      const wantSet = new Set(missing);
      for (const [name, file] of akFiles) {
        console.log(`  Al'Kabor: reading ${akSql.mode === 'split' ? name + '.sql' : path.basename(file)}…`);
        for await (const { table, columns, row } of iterInserts(file)) {
          if (!wantSet.has(table)) continue;
          const wl = WHITELIST[table];
          const out = TRANSFORMS[wl.transform](columns, row);
          if (!out) continue;
          buffers[wl.dest] = buffers[wl.dest] || [];
          buffers[wl.dest].push(out);
          totalRows++;
        }
      }
    }
  }

  console.log(`Parsed ${totalRows} rows from ${Object.keys(buffers).length} destination tables`);

  // ── Drop child rows with dangling FKs ──────────────────────────────────────
  // The upstream Quarm dump occasionally ships *_entries rows whose parent
  // *table* row is missing (e.g. loottable_entries.loottable_id = 87959 with
  // no matching loottable row). The first such row aborts the WHOLE sync with
  // a 409 FK violation, which is what kept eqemu_spells (and everything past
  // it in ORDER) empty — even though the dump has spell rows. Filter the
  // orphans out before upsert so a junk row in one table can't poison the run.
  const _dropOrphans = (childKey, fkCol, parentKey, parentPk) => {
    if (!buffers[childKey] || !buffers[parentKey]) return;
    const parents = new Set(buffers[parentKey].map(r => r[parentPk]));
    const before = buffers[childKey].length;
    buffers[childKey] = buffers[childKey].filter(r => parents.has(r[fkCol]));
    const dropped = before - buffers[childKey].length;
    if (dropped > 0) console.log(`  ! dropped ${dropped} orphan ${childKey} rows with missing ${fkCol} (dump inconsistency)`);
  };
  _dropOrphans('eqemu_loottable_entries', 'loottable_id', 'eqemu_loottable',   'id');
  _dropOrphans('eqemu_loottable_entries', 'lootdrop_id',  'eqemu_lootdrop',    'id');
  _dropOrphans('eqemu_lootdrop_entries',  'lootdrop_id',  'eqemu_lootdrop',    'id');
  _dropOrphans('eqemu_lootdrop_entries',  'item_id',      'eqemu_items',       'id');
  _dropOrphans('eqemu_spawnentry',        'spawngroup_id','eqemu_spawngroup',  'id');
  _dropOrphans('eqemu_spawnentry',        'npc_id',       'eqemu_npc_types',   'id');
  _dropOrphans('eqemu_spawn2',            'spawngroup_id','eqemu_spawngroup',  'id');
  _dropOrphans('eqemu_tradeskill_recipe_entries', 'recipe_id', 'eqemu_tradeskill_recipe', 'id');
  _dropOrphans('eqemu_npc_faction_entries',       'npc_faction_id', 'eqemu_npc_faction',  'id');
  _dropOrphans('eqemu_faction_list_mod',          'faction_id', 'eqemu_faction_list_full','id');
  _dropOrphans('eqemu_spawn2',            'zone_short',   'eqemu_zone',        'short_name');
  // npc_spells_entries.npc_spells_id → eqemu_npc_spells.id (the list) and
  // npc_spells_entries.spellid → eqemu_spells.id (the catalog). Drop entries
  // whose parent is missing so one orphan doesn't poison the whole upsert.
  _dropOrphans('eqemu_npc_spells_entries','npc_spells_id','eqemu_npc_spells',  'id');
  _dropOrphans('eqemu_npc_spells_entries','spellid',      'eqemu_spells',      'id');

  const counts = {};
  // Upsert in dependency order (parents before children)
  const ORDER = [
    'eqemu_zone', 'eqemu_items', 'eqemu_npc_types',
    'eqemu_loottable', 'eqemu_lootdrop', 'eqemu_loottable_entries', 'eqemu_lootdrop_entries',
    'eqemu_spawngroup', 'eqemu_spawnentry', 'eqemu_spawn2',
    'eqemu_spells',
    // NPC spell lists ride after eqemu_spells because the entries table's
    // spellid column references eqemu_spells.id. npc_spells before
    // npc_spells_entries because entries.npc_spells_id FK's into the list.
    // Previously these were parsed (WHITELIST + TRANSFORMS + PK_MAP all
    // configured) but never reached Supabase because they weren't listed
    // here — silently dropped after the buffer fill.
    'eqemu_npc_spells', 'eqemu_npc_spells_entries',
    'eqemu_altadv_vars', 'eqemu_aa_effects',
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
