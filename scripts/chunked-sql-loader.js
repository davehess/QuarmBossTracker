#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/chunked-sql-loader.js
//
// Read a JSONL file produced by import-quest-scripts.js and emit chunked SQL
// INSERT statements to stdout. Each chunk is sized to stay well under typical
// query length limits. Used to load scripted_npc_turnins via mcp__Supabase__
// execute_sql, since the sandbox doesn't carry SUPABASE_SERVICE_ROLE_KEY for
// a direct REST upsert.
//
// USAGE:
//   node scripts/chunked-sql-loader.js <jsonl-file> [--chunk N] > chunks.sql

const fs = require('fs');

function sqlString(s) {
  if (s == null) return 'NULL';
  // Postgres E'' literal; escape backslash, quote, normalize newlines/tabs so
  // a multi-line raw_snippet doesn't shred the INSERT.
  const esc = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return "E'" + esc + "'";
}
function sqlJson(o) {
  if (o == null) return 'NULL';
  return sqlString(JSON.stringify(o)) + '::jsonb';
}
function sqlInt(n) {
  return n == null || !Number.isFinite(Number(n)) ? 'NULL' : String(Math.trunc(Number(n)));
}
function sqlBool(b) { return b ? 'TRUE' : 'FALSE'; }

function rowToValues(r) {
  return '(' + [
    sqlString(r.zone_short),
    sqlString(r.npc_name),
    sqlString(r.script_path),
    sqlString(r.script_lang),
    sqlJson(r.inputs),
    sqlJson(r.outputs),
    sqlJson(r.faction_changes),
    sqlJson(r.cash),
    sqlJson(r.money_required),
    sqlInt(r.exp_award),
    sqlBool(r.random_outputs),
    sqlString(r.raw_snippet || ''),
  ].join(', ') + ')';
}

function* chunkRows(jsonlPath, chunkSize) {
  const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
  for (let i = 0; i < lines.length; i += chunkSize) {
    const slice = lines.slice(i, i + chunkSize).map(l => {
      try { return rowToValues(JSON.parse(l)); }
      catch { return null; }
    }).filter(Boolean);
    if (slice.length === 0) continue;
    yield (
      'INSERT INTO scripted_npc_turnins\n' +
      '  (zone_short, npc_name, script_path, script_lang, inputs, outputs, faction_changes, cash, money_required, exp_award, random_outputs, raw_snippet)\n' +
      'VALUES\n' +
      slice.join(',\n') + '\n' +
      'ON CONFLICT (zone_short, npc_name, raw_snippet) DO NOTHING;'
    );
  }
}

function main() {
  const argv = process.argv.slice(2);
  const path = argv[0];
  if (!path) { console.error('usage: chunked-sql-loader <jsonl> [--chunk N]'); process.exit(2); }
  let chunk = 100;
  const ci = argv.indexOf('--chunk'); if (ci >= 0) chunk = parseInt(argv[ci + 1], 10) || 100;
  let n = 0;
  for (const sql of chunkRows(path, chunk)) {
    console.log(sql);
    console.log('-- chunk-break --');
    n++;
  }
  process.stderr.write('Emitted ' + n + ' chunks of <= ' + chunk + ' rows from ' + path + '\n');
}

if (require.main === module) main();
