#!/usr/bin/env node
// scripts/test-sync-parser.js
//
// End-to-end test for the EQMacEmu → Supabase sync pipeline.
// Runs the *real* parser + transforms against a real Quarm DB dump,
// then validates every output row against the Supabase schema parsed
// from the initial_schema.sql migration.
//
// Catches:
//   - NULL in a NOT NULL column
//   - U+0000 (null byte) in any string field (Postgres rejects with 22P05)
//   - String value in a numeric/boolean column
//   - Column name mismatches (i.e. transform expects column upstream doesn't have)
//
// Usage:
//   node scripts/test-sync-parser.js [path/to/dump.sql]
//
//   If no dump path is given, uses /tmp/quarm_*.sql if one exists, or
//   downloads the latest from SecretsOTheP/EQMacEmu.

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const { iterInserts, TRANSFORMS, WHITELIST } = require('./sync-from-eqmac.js');

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20260525120000_initial_schema.sql');

// ── 1. Parse Supabase schema from initial_schema.sql ────────────────────────
// Returns { eqemu_zone: { short_name: { type: 'text', notNull: true }, ... }, ... }
function parseSupabaseSchema(sqlPath) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const schema = {};
  // Match each: create table if not exists <name> ( ... );
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]+?)\)\s*;/gi;
  let m;
  while ((m = tableRe.exec(sql)) !== null) {
    const name = m[1];
    if (!name.startsWith('eqemu_')) continue;
    const body = m[2];
    const cols = {};
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/--.*$/, '').trim();
      if (!line) continue;
      // Skip constraint/index lines
      if (/^(primary\s+key|unique|foreign\s+key|constraint|check)\b/i.test(line)) continue;
      // Column: <name> <type> [...constraints...]
      const cm = line.match(/^(\w+)\s+(\w+(?:\([^)]*\))?(?:\[\])?)(.*)$/);
      if (!cm) continue;
      const [, colName, colType, rest] = cm;
      const notNull = /\bnot\s+null\b/i.test(rest);
      const hasDefault = /\bdefault\b/i.test(rest);
      cols[colName] = {
        type: colType.toLowerCase().replace(/\(.*\)/, ''),
        notNull,
        hasDefault,
      };
    }
    schema[name] = cols;
  }
  return schema;
}

// ── 2. Resolve a dump file: arg → /tmp cache → download ─────────────────────
async function resolveDump() {
  const arg = process.argv[2];
  if (arg) {
    if (!fs.existsSync(arg)) throw new Error(`Dump not found: ${arg}`);
    return arg;
  }
  // Look for existing /tmp/quarm_*.sql
  const tmpFiles = fs.readdirSync('/tmp').filter(f => /^quarm_.*\.sql$/.test(f));
  if (tmpFiles.length) {
    const p = path.join('/tmp', tmpFiles[0]);
    console.log(`Using cached dump: ${p}`);
    return p;
  }
  // Download latest
  console.log('No cached dump — downloading latest from upstream…');
  const apiUrl = 'https://api.github.com/repos/SecretsOTheP/EQMacEmu/contents/utils/sql/database_full';
  const res = await fetch(apiUrl, { headers: { 'User-Agent': 'QuarmBossTracker-test' } });
  const files = await res.json();
  const latest = files.filter(f => /^quarm_.*\.tar\.gz$/.test(f.name)).sort((a,b) => a.name < b.name ? 1 : -1)[0];
  const tarPath = `/tmp/${latest.name}`;
  console.log(`  ${latest.download_url}`);
  const dl = await fetch(latest.download_url);
  const buf = Buffer.from(await dl.arrayBuffer());
  fs.writeFileSync(tarPath, buf);
  execFileSync('tar', ['-xzf', tarPath, '-C', '/tmp']);
  // Find the .sql inside
  const sqlName = fs.readdirSync('/tmp').find(f => f.startsWith('quarm_') && f.endsWith('.sql'));
  if (!sqlName) throw new Error('No .sql found after extraction');
  return `/tmp/${sqlName}`;
}

// ── 3. Validate a single row against the schema ─────────────────────────────
function validateRow(table, row, schema, problems) {
  if (!schema) {
    problems.missingSchema = problems.missingSchema || new Set();
    problems.missingSchema.add(table);
    return;
  }
  for (const [col, def] of Object.entries(schema)) {
    const val = row[col];
    // NOT NULL with no default
    if (def.notNull && !def.hasDefault && (val === null || val === undefined)) {
      problems.notNull = problems.notNull || [];
      if (problems.notNull.length < 10) problems.notNull.push({ table, col, row: summary(row) });
    }
    // U+0000 in string
    if (typeof val === 'string' && val.indexOf('\u0000') !== -1) {
      problems.nullByte = problems.nullByte || [];
      if (problems.nullByte.length < 10) problems.nullByte.push({ table, col, value: JSON.stringify(val).slice(0, 80) });
    }
    // Type mismatch
    if (val !== null && val !== undefined) {
      const expected = def.type;
      if (['int', 'integer', 'bigint', 'smallint', 'numeric', 'real', 'double', 'serial'].includes(expected)) {
        if (typeof val !== 'number') {
          problems.typeMismatch = problems.typeMismatch || [];
          if (problems.typeMismatch.length < 10) problems.typeMismatch.push({ table, col, expected, got: typeof val, value: JSON.stringify(val).slice(0, 80) });
        }
      } else if (expected === 'boolean') {
        if (typeof val !== 'boolean') {
          problems.typeMismatch = problems.typeMismatch || [];
          if (problems.typeMismatch.length < 10) problems.typeMismatch.push({ table, col, expected, got: typeof val, value: JSON.stringify(val).slice(0, 80) });
        }
      } else if (expected === 'text' || expected === 'varchar') {
        if (typeof val !== 'string') {
          problems.typeMismatch = problems.typeMismatch || [];
          if (problems.typeMismatch.length < 10) problems.typeMismatch.push({ table, col, expected, got: typeof val, value: JSON.stringify(val).slice(0, 80) });
        }
      }
    }
  }
  // Extra keys in row that aren't in schema (warn only — they'd be ignored by PostgREST silently)
  for (const col of Object.keys(row)) {
    if (col === 'synced_at') continue; // db default
    if (!schema[col] && row[col] !== undefined) {
      problems.extraCols = problems.extraCols || {};
      problems.extraCols[`${table}.${col}`] = (problems.extraCols[`${table}.${col}`] || 0) + 1;
    }
  }
}

function summary(row) {
  const id = row.id ?? row.short_name ?? row.spawngroup_id ?? '?';
  return `id=${id}`;
}

// ── 4. Main ─────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Loading schema from ${path.relative(process.cwd(), MIGRATION)}…`);
  const schema = parseSupabaseSchema(MIGRATION);
  for (const [t, cols] of Object.entries(schema)) {
    console.log(`  ${t}: ${Object.keys(cols).length} columns`);
  }

  const dump = await resolveDump();
  console.log(`\nParsing ${dump}…\n`);

  const counts = {};
  const problems = {};

  for await (const { table, columns, row } of iterInserts(dump)) {
    const wl = WHITELIST[table];
    if (!wl) continue;
    const out = TRANSFORMS[wl.transform](columns, row);
    if (!out) continue;
    counts[wl.dest] = (counts[wl.dest] || 0) + 1;
    validateRow(wl.dest, out, schema[wl.dest], problems);
  }

  console.log('Row counts per destination table:');
  for (const [t, c] of Object.entries(counts)) console.log(`  ${t.padEnd(28)} ${c.toLocaleString()}`);
  console.log();

  let fail = false;
  if (problems.missingSchema) {
    console.error('❌ Tables with NO Supabase schema definition:');
    for (const t of problems.missingSchema) console.error(`     ${t}`);
    fail = true;
  }
  if (problems.notNull) {
    console.error(`\n❌ NOT NULL violations (first ${problems.notNull.length}):`);
    for (const p of problems.notNull) console.error(`     ${p.table}.${p.col} (${p.row})`);
    fail = true;
  }
  if (problems.nullByte) {
    console.error(`\n❌ U+0000 in string fields (first ${problems.nullByte.length}):`);
    for (const p of problems.nullByte) console.error(`     ${p.table}.${p.col} = ${p.value}`);
    fail = true;
  }
  if (problems.typeMismatch) {
    console.error(`\n❌ Type mismatches (first ${problems.typeMismatch.length}):`);
    for (const p of problems.typeMismatch) console.error(`     ${p.table}.${p.col} expected ${p.expected}, got ${p.got} (${p.value})`);
    fail = true;
  }
  if (problems.extraCols) {
    console.log(`\n⚠️  Output columns not in Supabase schema (silently ignored by PostgREST):`);
    for (const [k, n] of Object.entries(problems.extraCols)) console.log(`     ${k}  (${n.toLocaleString()} rows)`);
  }

  if (fail) {
    console.error('\n❌ FAIL');
    process.exit(1);
  } else {
    console.log('\n✅ PASS — all rows passed schema validation');
  }
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
