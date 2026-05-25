#!/usr/bin/env node
// scripts/migrate-bosses-to-supabase.js
//
// One-time (idempotent) migration: data/bosses.json → bosses_local table.
//
// For each row in bosses.json:
//   1. Fuzzy-match the name against eqemu_npc_types
//   2. If exactly one good match, prepare an upsert into bosses_local
//   3. If no match or multiple ambiguous matches, write to a review file
//   4. Carry our overrides: nicknames, emoji, expansion bucket, timer override
//      (only set timer_hours_override if our value differs from upstream)
//
// Usage:
//   SUPABASE_URL=https://… SUPABASE_SERVICE_ROLE_KEY=… node scripts/migrate-bosses-to-supabase.js
//
// Optional flags:
//   --dry-run            Print what would be done; no writes.
//   --review-only        Re-process the review file after manual edits.
//   --pqdi-id            Match using the npc_id parsed from pqdiUrl (preferred when available).
//
// Output files:
//   data/migration_review.json   ambiguous / unmatched bosses for manual review
//   data/migration_state.json    timestamp of last successful run + counts

const fs   = require('fs');
const path = require('path');

const BOSSES_FILE       = path.join(__dirname, '..', 'data', 'bosses.json');
const REVIEW_FILE       = path.join(__dirname, '..', 'data', 'migration_review.json');
const STATE_FILE        = path.join(__dirname, '..', 'data', 'migration_state.json');

const DRY_RUN     = process.argv.includes('--dry-run');
const REVIEW_ONLY = process.argv.includes('--review-only');

// ── Supabase helpers (inline; no dependency on utils/supabase.js so the script
//    can be run standalone in CI without the bot's require graph) ──
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

async function sb(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        opts.prefer || 'return=representation',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ── Name normalization for fuzzy matching ──────────────────────────────────
function normalize(name) {
  return (name || '')
    .toLowerCase()
    .replace(/^(a |an |the )/, '')
    .replace(/[`',.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pqdiNpcIdFrom(boss) {
  const m = (boss.pqdiUrl || '').match(/\/npc\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Match a single boss against an eqemu_npc_types result set ─────────────
function matchBossInResults(boss, candidates) {
  if (!candidates.length) return { kind: 'none' };

  const target = normalize(boss.name);

  // 1. Exact normalized match → single result
  const exact = candidates.filter(c => normalize(c.name) === target);
  if (exact.length === 1) return { kind: 'exact', npc: exact[0] };
  if (exact.length > 1) {
    return { kind: 'ambiguous', reason: 'multiple_exact_matches', candidates: exact };
  }

  // 2. Distinct partials
  const partials = candidates
    .map(c => ({
      npc: c,
      ndiff: Math.abs(normalize(c.name).length - target.length),
    }))
    .sort((a, b) => a.ndiff - b.ndiff);

  // If only one candidate, take it
  if (partials.length === 1) return { kind: 'partial', npc: partials[0].npc };

  // If top two are tied in name-length-distance, ambiguous
  if (partials[0].ndiff === partials[1].ndiff) {
    return { kind: 'ambiguous', reason: 'multiple_partial_matches', candidates: partials.slice(0, 5).map(p => p.npc) };
  }

  return { kind: 'partial', npc: partials[0].npc };
}

async function findNpcForBoss(boss) {
  // Strategy A: match by PQDI npc_id, since that often matches the EQEmu id
  const pqdiId = pqdiNpcIdFrom(boss);
  if (pqdiId) {
    const direct = await sb(`/eqemu_npc_types?id=eq.${pqdiId}&select=id,name,respawn_seconds,zone_short`);
    if (Array.isArray(direct) && direct.length === 1) {
      // Confirm the name is at least related
      if (normalize(direct[0].name).includes(normalize(boss.name).split(' ')[0]) ||
          normalize(boss.name).includes(normalize(direct[0].name).split(' ')[0])) {
        return { kind: 'exact', npc: direct[0], via: 'pqdi_id' };
      }
    }
  }

  // Strategy B: name search via PostgREST's full-text index
  // (ilike is case-insensitive; we URL-encode the value)
  const q = encodeURIComponent(`*${normalize(boss.name).replace(/\s+/g, '*')}*`);
  const rows = await sb(`/eqemu_npc_types?name=ilike.${q}&select=id,name,respawn_seconds,zone_short&limit=20`);
  return matchBossInResults(boss, Array.isArray(rows) ? rows : []);
}

// ── Build bosses_local row from boss + matched NPC ─────────────────────────
function buildBossesLocalRow(boss, npc) {
  const row = {
    npc_id:                 npc.id,
    internal_id:            boss.id,
    nicknames:              boss.nicknames || [],
    emoji:                  boss.emoji || null,
    expansion_label:        boss.expansion || null,
    path_notes:             null,
    strat_notes:            null,
  };

  // Only set timer_hours_override if ours disagrees with upstream
  const upstreamHours = npc.respawn_seconds ? (npc.respawn_seconds / 3600) : null;
  if (upstreamHours !== null && boss.timerHours && Math.abs(boss.timerHours - upstreamHours) > 0.5) {
    row.timer_hours_override = boss.timerHours;
  } else if (upstreamHours === null && boss.timerHours) {
    row.timer_hours_override = boss.timerHours;
  }

  return row;
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const bosses = JSON.parse(fs.readFileSync(BOSSES_FILE, 'utf8'));
  console.log(`Migrating ${bosses.length} bosses from ${BOSSES_FILE}`);

  // Quick sanity: does Supabase have any NPCs yet?
  const npcCount = await sb('/eqemu_npc_types?select=id&limit=1');
  if (!Array.isArray(npcCount) || npcCount.length === 0) {
    console.error('❌ eqemu_npc_types is empty. Run the sync workflow first to populate upstream data.');
    process.exit(1);
  }

  const toUpsert = [];
  const review   = [];
  let exactCount = 0, partialCount = 0, ambiguousCount = 0, noneCount = 0;

  for (const boss of bosses) {
    process.stdout.write(`  ${boss.name.padEnd(36)} `);
    let match;
    try {
      match = await findNpcForBoss(boss);
    } catch (err) {
      console.log(`error: ${err.message}`);
      review.push({ boss, error: err.message });
      continue;
    }

    if (match.kind === 'exact') {
      console.log(`→ exact match: ${match.npc.id} ${match.via ? `(${match.via})` : ''}`);
      exactCount++;
      toUpsert.push(buildBossesLocalRow(boss, match.npc));
    } else if (match.kind === 'partial') {
      console.log(`→ partial: ${match.npc.id} '${match.npc.name}'`);
      partialCount++;
      toUpsert.push(buildBossesLocalRow(boss, match.npc));
    } else if (match.kind === 'ambiguous') {
      console.log(`→ AMBIGUOUS (${match.reason}, ${match.candidates.length} candidates) — needs manual review`);
      ambiguousCount++;
      review.push({ boss, candidates: match.candidates });
    } else {
      console.log(`→ NO MATCH — needs manual review`);
      noneCount++;
      review.push({ boss });
    }
  }

  console.log();
  console.log(`Match summary: exact=${exactCount} partial=${partialCount} ambiguous=${ambiguousCount} none=${noneCount}`);

  if (review.length) {
    fs.writeFileSync(REVIEW_FILE, JSON.stringify(review, null, 2));
    console.log(`📝 ${review.length} bosses need manual review. Edit ${path.relative(process.cwd(), REVIEW_FILE)}`);
    console.log(`   Then re-run with --review-only to merge resolved entries.`);
  }

  if (DRY_RUN) {
    console.log(`(dry run — would have upserted ${toUpsert.length} rows)`);
    return;
  }

  if (toUpsert.length) {
    console.log(`Upserting ${toUpsert.length} bosses_local rows…`);
    // Batch in chunks of 50 for safety
    for (let i = 0; i < toUpsert.length; i += 50) {
      const chunk = toUpsert.slice(i, i + 50);
      await sb('/bosses_local?on_conflict=internal_id', {
        method: 'POST',
        body:   chunk,
        prefer: 'return=minimal,resolution=merge-duplicates',
      });
      console.log(`  …${i + chunk.length} / ${toUpsert.length}`);
    }
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify({
    last_run: new Date().toISOString(),
    upserted: toUpsert.length,
    review_pending: review.length,
    counts: { exactCount, partialCount, ambiguousCount, noneCount },
  }, null, 2));

  console.log(`✅ Done. State saved to ${path.relative(process.cwd(), STATE_FILE)}`);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
