#!/usr/bin/env node
/**
 * Wizard step "load game data" for a SELF-HOSTED guild: fill the guild's own
 * Supabase project with the eqemu_* catalog (zones, items, NPCs, spells, loot,
 * spawns, factions, recipes, doors, pather routes, ~97 MB) and the mob scripts.
 *
 * It runs the SAME two imports Wolf Pack's weekly workflow runs
 * (.github/workflows/sync-quarm.yml) — it is a wrapper, not a copy:
 *
 *   1. node scripts/sync-from-eqmac.js     the catalog (SQL dump -> eqemu_*)
 *   2. node scripts/sync-quest-scripts.js  the mob scripts (-> eqemu_quest_scripts)
 *
 * ...and then VERIFIES what landed (the wizard rule: each step must verify, and say
 * what it verified). For every table the catalog sync writes it compares the row count
 * IN THE GUILD'S DATABASE with the count the sync reported writing; it prints
 * table -> rows and exits non-zero on an empty table or any mismatch.
 *
 * WHEN: after scripts/selfhost-bootstrap-db.sh succeeds (it builds the empty tables).
 *
 * USAGE
 *   SUPABASE_URL=https://<your-project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key> \
 *   node scripts/selfhost-load-game-data.js
 *   (the local Supabase stack works too: SUPABASE_URL=http://<db-host>:54321)
 *
 * ENV
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required — THE GUILD'S project. Refused if
 *                       either points at Wolf Pack's production project: re-importing
 *                       there by accident is the one mistake this guard exists for.
 *   DUMP_URL            optional — a tarball URL for a guild on its OWN EQEmu server,
 *                       used instead of the latest Quarm dump.
 *                       ⚠ A non-Quarm dump must match the EQMacEmu schema the sync
 *                       expects (table + column names of SecretsOTheP/EQMacEmu's
 *                       database_full dumps). An older or newer EQEmu schema is
 *                       UNTESTED. The sync's own validation floors are also sized for
 *                       Quarm, so a much smaller server can trip them. It also still
 *                       falls back to the Al'Kabor parent dump for tables the dump
 *                       omits, which is another server's data.
 *   FORCE_RESYNC=true   re-import even if the dump is unchanged (otherwise an unchanged
 *                       dump is skipped — safe to re-run weekly). Forced automatically
 *                       when any catalog table in your database is empty, so a new
 *                       project is never "skipped" because of an old state file.
 *   ALLOW_EXTRA_ROWS=1  accept MORE rows in the database than the sync wrote. Upserts
 *                       never delete, so rows the upstream later removed linger; by
 *                       default that is reported as a mismatch (it is also what
 *                       switching dumps leaves behind).
 *   SKIP_QUEST_SCRIPTS=1  skip step 2. Skipped on its own when DUMP_URL is set, since
 *                       the quest-script repo is Quarm's; set QUESTS_REPO to your own
 *                       fork to load yours.
 *   SELFHOST_SYNC_STATE where the "last dump I imported" note lives (default
 *                       ~/.wolfpack-selfhost/sync_state.json). NOT the repo's
 *                       data/sync_state.json — that records Wolf Pack's import, and
 *                       reusing it would make a new guild's first run look "already
 *                       synced" and import nothing.
 *
 * Safe to re-run: the sync's dump-sha check skips an unchanged dump, and upserts are
 * idempotent.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Wolf Pack's production Supabase project (public: it is in the repo's docs).
const WOLFPACK_PROJECT_REF = 'zhtoekwakucbckvatfky';
const QUEST_TABLE = 'eqemu_quest_scripts';

// A service-role key is a JWT whose payload names its project (`ref`); local-stack and
// new-format keys are not, which is fine — then only the URL is checked.
function jwtRef(key) {
  try {
    const payload = String(key).split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).ref || '';
  } catch { return ''; }
}

// Throws unless env names a project that is NOT Wolf Pack's. Returns the cleaned pair.
function checkEnv(env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — use YOUR guild\'s project.');
  }
  if (!/^https?:\/\//i.test(url)) throw new Error(`SUPABASE_URL does not look like a URL: ${url}`);
  if (url.toLowerCase().includes(WOLFPACK_PROJECT_REF) || jwtRef(key) === WOLFPACK_PROJECT_REF) {
    throw new Error('REFUSED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY point at Wolf Pack\'s production '
      + 'project. This step loads a self-hosted guild\'s OWN database; use your own project\'s URL and key.');
  }
  return { url, key };
}

// Compare the guild's database against what the sync reported writing.
//   expected  table names the catalog sync writes
//   reported  { table: rows the sync wrote }   (its sync_state.json `counts`)
//   actual    { table: rows now in the database }
// Returns { ok, rows: [{ table, reported, actual, status, bad }] }.
function verifyCounts(expected, reported, actual, opts = {}) {
  const rows = expected.map((table) => {
    const rep = Number(reported[table]) || 0;
    const act = Number(actual[table]) || 0;
    let status = 'ok';
    if (act === 0) status = 'EMPTY';
    else if (rep === 0) status = 'NOT WRITTEN BY SYNC';
    else if (act < rep) status = `MISSING ${rep - act}`;
    else if (act > rep) status = opts.allowExtra ? `extra ${act - rep} (allowed)` : `EXTRA ${act - rep}`;
    return { table, reported: rep, actual: act, status, bad: !(status === 'ok' || status.endsWith('(allowed)')) };
  });
  return { ok: rows.every((r) => !r.bad), rows };
}

function formatTable(rows) {
  const w = Math.max(5, ...rows.map((r) => r.table.length));
  const line = (t, rep, act, st) => `  ${t.padEnd(w)}  ${String(rep).padStart(9)}  ${String(act).padStart(9)}  ${st}`;
  return [line('table', 'sync wrote', 'in db', 'status'), ...rows.map((r) => line(r.table, r.reported || '-', r.actual, r.status))].join('\n');
}

// Exact row count of a table through PostgREST (HEAD + Prefer: count=exact).
async function countTable(url, key, table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    method: 'HEAD',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} (did selfhost-bootstrap-db.sh run against this project?)`);
  return Number((res.headers.get('content-range') || '').split('/')[1] || 0);
}

function runNodeScript(script, env) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', env });
  return r.status === null ? 1 : r.status;
}

// All I/O is injectable so the tests drive the real flow without a network.
async function run(env, io = {}) {
  const log = io.log || console.log;
  const err = io.err || console.error;
  const runStep = io.runStep || runNodeScript;
  const readState = io.readState || ((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const expected = io.expectedTables || Object.keys(require('./sync-from-eqmac.js').PK_MAP);

  let url, key;
  try { ({ url, key } = checkEnv(env)); } catch (e) { err(`❌ ${e.message}`); return 1; }
  const count = io.countTable || ((t) => countTable(url, key, t));
  const stateFile = env.SELFHOST_SYNC_STATE || path.join(os.homedir(), '.wolfpack-selfhost', 'sync_state.json');
  const dumpUrl = (env.DUMP_URL || '').trim();

  const countAll = async (tables) => {
    const out = {};
    for (const t of tables) out[t] = await count(t);
    return out;
  };

  // 0. What is already there? A zero anywhere means a new/partial project: force the
  //    import so an old state file can never turn it into a silent "nothing to do".
  let before;
  try { before = await countAll(expected); } catch (e) { err(`❌ cannot read the database: ${e.message}`); return 1; }
  const force = String(env.FORCE_RESYNC || '').toLowerCase() === 'true' || expected.some((t) => !before[t]);

  const stepEnv = {
    ...env,
    SYNC_STATE_FILE: stateFile,
    FORCE_RESYNC: force ? 'true' : '',
    DUMP_URL_OVERRIDE: dumpUrl,
  };

  log('=== 1/2  catalog (sync-from-eqmac.js) ===');
  if (force) log('  (full import: first run, an empty table, or FORCE_RESYNC)');
  const code = runStep('sync-from-eqmac.js', stepEnv);
  if (code !== 0) { err(`❌ catalog sync failed (exit ${code}) — see its output above`); return code; }

  let reported;
  try { reported = (readState(stateFile) || {}).counts; } catch { reported = null; }
  if (!reported || !Object.keys(reported).length) {
    err(`❌ the sync reported no per-table counts (${stateFile}) — cannot verify`);
    return 1;
  }

  const skipQuests = env.SKIP_QUEST_SCRIPTS === '1' || (dumpUrl && !env.QUESTS_REPO);
  let questsFailed = false;
  if (skipQuests) {
    log('=== 2/2  mob scripts: skipped (own dump without QUESTS_REPO, or SKIP_QUEST_SCRIPTS=1) ===');
  } else {
    log('=== 2/2  mob scripts (sync-quest-scripts.js) ===');
    questsFailed = runStep('sync-quest-scripts.js', stepEnv) !== 0;
    if (questsFailed) err('❌ mob-script sync failed (the catalog result is still verified below)');
  }

  // 3. Verify against the database itself, not the sync's own buffers.
  log('=== verify ===');
  let actual;
  try { actual = await countAll(skipQuests ? expected : [...expected, QUEST_TABLE]); } catch (e) { err(`❌ cannot read the database: ${e.message}`); return 1; }
  const v = verifyCounts(expected, reported, actual, { allowExtra: env.ALLOW_EXTRA_ROWS === '1' });
  const rows = [...v.rows];
  if (!skipQuests) {
    // The quest sync reports no per-table total, so the check is "not empty".
    const n = actual[QUEST_TABLE];
    rows.push({ table: QUEST_TABLE, reported: 0, actual: n, status: n > 0 ? 'ok (non-empty)' : 'EMPTY', bad: !(n > 0) });
  }
  log(formatTable(rows));
  const bad = rows.filter((r) => r.bad);
  if (bad.length || questsFailed) {
    err(`\n❌ NOT VERIFIED — ${bad.length} table(s) wrong${questsFailed ? ', mob-script sync failed' : ''}: ${bad.map((r) => r.table).join(', ')}`);
    err('   Fix the cause and re-run (FORCE_RESYNC=true re-imports an unchanged dump).');
    return 1;
  }
  log(`\n✅ VERIFIED: ${rows.length} tables loaded, every count in your database matches what the sync wrote`
    + (skipQuests ? '' : ` (${QUEST_TABLE}: non-empty only)`) + '.');
  return 0;
}

module.exports = { checkEnv, verifyCounts, formatTable, countTable, run, WOLFPACK_PROJECT_REF };

if (require.main === module) {
  run(process.env).then((c) => process.exit(c), (e) => { console.error('FATAL:', e); process.exit(1); });
}
