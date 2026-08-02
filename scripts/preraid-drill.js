#!/usr/bin/env node
// scripts/preraid-drill.js  —  #75, the pre-raid drill (read-only half).
//
//   node scripts/preraid-drill.js
//   node scripts/preraid-drill.js --json      machine-readable
//   node scripts/preraid-drill.js --quiet     summary line only
//
// WHAT IT IS. One command an officer runs before the pull that answers "is the
// whole parse chain alive?" — instead of finding out at the first CH chain.
// Every probe here is READ-ONLY: GETs and a local replay, nothing written to
// Supabase, Discord, or the boards. Safe to run at any time, including mid-raid
// and inside the deploy freeze.
//
// WHAT IT IS NOT (yet). It does not prove the WRITE path end to end (a synthetic
// encounter POSTed through the bot into Supabase and back out as a Discord parse
// card). That drill is designed in docs/DESIGN-75-golden-log.md § "The drill"
// and is deliberately not enabled — it writes to production and needs Hitya's
// sign-off first.
//
// Env:
//   WOLFPACK_BOT_URL        bot base or /api/agent/encounter URL (the agent's var)
//   WOLFPACK_AGENT_TOKEN    optional; enables the authenticated-read probe
//
// Exit code 0 = every probe green (or skipped), 1 = at least one red.

const fs   = require('node:fs');
const path = require('node:path');

const R = require('../test/fixtures/golden/_replay.js');

const argv   = process.argv.slice(2);
const asJson = argv.includes('--json');
const quiet  = argv.includes('--quiet');

const SLOW_MS = 1500;
const results = [];

function record(name, state, detail) {
  results.push({ name, state, detail });   // state: 'ok' | 'warn' | 'fail' | 'skip'
}

// Accepts either the base URL or the agent's full encounter URL.
function botBase() {
  const raw = process.env.WOLFPACK_BOT_URL || 'https://wolfpackparse.up.railway.app';
  return raw.replace(/\/api\/agent\/.*$/, '').replace(/\/+$/, '');
}

async function probe(url, { headers } = {}, timeoutMs = 8000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal, headers });
    const ms = Date.now() - t0;
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON health bodies are fine */ }
    return { ok: r.status < 400, status: r.status, ms, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: null, err: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. Parser self-test (local, offline) ────────────────────────────────────
// Replays the committed golden log through the agent in THIS checkout and
// compares against the committed digest. This is the check that catches "the
// build you are about to hand 40 raiders parses differently than the one we
// signed off on" — and it needs no network at all.
function parserSelfTest() {
  const goldenPath = path.join(__dirname, '..', 'test', 'fixtures', 'golden', 'expected-encounter.json');
  let expected;
  try {
    expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  } catch (e) {
    return record('parser (golden log)', 'fail', `cannot read golden: ${e.message}`);
  }
  let actual;
  try {
    const payloads = R.replayEncounter('raid-pull.log');
    if (payloads.length !== 1) {
      return record('parser (golden log)', 'fail', `replayed ${payloads.length} encounters, expected 1`);
    }
    actual = R.digestEncounter(payloads[0]);
  } catch (e) {
    return record('parser (golden log)', 'fail', `replay threw: ${e.message}`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const diffs = Object.keys(expected).filter(
      (k) => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]));
    return record('parser (golden log)', 'fail', `digest differs: ${diffs.join(', ')}`);
  }
  record('parser (golden log)', 'ok',
    `${actual.event_count} events · ${actual.boss_name} · kill credit ${actual.kill_credit} · agent ${R.agent.AGENT_VERSION}`);
}

// ── 2. Bot readiness + circuit breaker + budgets ────────────────────────────
async function botHealth() {
  const r = await probe(`${botBase()}/health`);
  if (!r.ok || !r.body) {
    return record('bot /health', 'fail',
      r.status ? `HTTP ${r.status} in ${r.ms}ms` : `unreachable (${r.err || 'no response'})`);
  }
  const b = r.body;
  const breaker = b.supabase_breaker;
  const over    = Object.keys(b.budgets || {});
  const bits = [`${r.ms}ms`];
  if (breaker && breaker.open) bits.push('⚠ Supabase breaker OPEN');
  if (over.length) bits.push(`⚠ over budget: ${over.join(', ')}`);
  if (!b.ready) return record('bot /health', 'fail', `not ready (shutting_down=${!!b.shutting_down})`);
  const bad = (breaker && breaker.open) || over.length;
  record('bot /health', bad ? 'warn' : (r.ms > SLOW_MS ? 'warn' : 'ok'), bits.join(' · '));
}

// ── 3. The agent manifest each channel will hand out ────────────────────────
async function agentManifest() {
  for (const [label, qs] of [['stable', ''], ['beta', '?channel=beta']]) {
    const r = await probe(`${botBase()}/api/agent/latest-version${qs}`);
    if (!r.ok || !r.body) {
      record(`agent manifest (${label})`, 'fail',
        r.status ? `HTTP ${r.status}` : `unreachable (${r.err || 'no response'})`);
      continue;
    }
    const v = r.body.latest_agent_version || '(none)';
    const local = R.agent.AGENT_VERSION;
    record(`agent manifest (${label})`, 'ok', `serves ${v} · this checkout is ${local}`);
  }
}

// ── 4. Ingest auth (read-only) ──────────────────────────────────────────────
// Proves the bearer token the fleet uses is accepted, without writing anything.
// A 401/403 here is the outage that silently kills every upload on raid night.
async function ingestAuth() {
  const token = process.env.WOLFPACK_AGENT_TOKEN;
  if (!token) return record('ingest auth', 'skip', 'WOLFPACK_AGENT_TOKEN not set');
  const r = await probe(`${botBase()}/api/agent/guild-triggers`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) return record('ingest auth', 'fail', `HTTP ${r.status} — token rejected`);
  if (r.status === 503) return record('ingest auth', 'fail', '503 — WOLFPACK_AGENT_TOKEN unset on the bot');
  if (!r.ok) return record('ingest auth', 'fail', r.status ? `HTTP ${r.status}` : `unreachable (${r.err})`);
  const n = Array.isArray(r.body?.triggers) ? r.body.triggers.length : null;
  record('ingest auth', 'ok', `accepted${n == null ? '' : ` · ${n} guild triggers`} · ${r.ms}ms`);
}

// ── 5. The site the raid reads ──────────────────────────────────────────────
async function web() {
  const r = await probe('https://wolfpack.quest/api/health');
  if (!r.ok) {
    return record('wolfpack.quest', 'fail',
      r.status ? `HTTP ${r.status}` : `unreachable (${r.err || 'no response'})`);
  }
  const c = r.body?.checks || {};
  const detail = `${r.ms}ms` + (c.auth || c.db ? ` · auth ${c.auth?.state || '?'} · db ${c.db?.state || '?'}` : '');
  record('wolfpack.quest', r.ms > SLOW_MS ? 'warn' : 'ok', detail);
}

(async () => {
  parserSelfTest();
  await botHealth();
  await agentManifest();
  await ingestAuth();
  await web();

  const failed = results.filter((r) => r.state === 'fail');
  const warned = results.filter((r) => r.state === 'warn');

  if (asJson) {
    console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  } else {
    const glyph = { ok: '✅', warn: '⚠', fail: '🛑', skip: '–' };
    if (!quiet) {
      console.log('Wolf Pack pre-raid drill\n');
      for (const r of results) console.log(`${glyph[r.state]} ${r.name.padEnd(24)} ${r.detail}`);
      console.log('');
    }
    console.log(failed.length ? `🛑 ${failed.length} check(s) FAILED — fix before the pull.`
      : warned.length        ? `⚠ ${warned.length} check(s) degraded — pull, but watch them.`
      :                        '✅ Chain is alive. Good pull.');
  }
  process.exit(failed.length ? 1 : 0);
})();
