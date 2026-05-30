#!/usr/bin/env node
// scripts/import-eqlp-triggers.js — One-shot importer for EQLogParser
// .tgf.gz triggers into the guild_triggers Supabase library.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-eqlp-triggers.js path/to/Triggers.tgf.gz
//   ... --dry-run    print stats + sample rows, write nothing
//   ... --include-inactive   include triggers that have never fired
//                            (default: only LastTriggered > 0)
//
// The library model: ALL imported triggers go into guild_triggers. Each
// row carries default_scope ('broadcast' | 'personal' | 'class_specific')
// that hints the agent whether to enable it by default. Users on the
// agent UI opt-in/mute individual triggers from the library.
//
// EQLogParser triggers carry multiple action fields (TextToDisplay,
// TextToSpeak, SoundToPlay, EndText, WarningText, etc.) — we fan them
// out into our actions jsonb array so a single trigger can fire an
// overlay, a TTS, AND a sound clip in one match.

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const args = process.argv.slice(2);
const inputPath = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const emitSql = args.includes('--sql');
const includeInactive = args.includes('--include-inactive');

if (!inputPath) {
  console.error('Usage: node import-eqlp-triggers.js <path-to-Triggers.tgf.gz> [--dry-run] [--sql] [--include-inactive]');
  process.exit(1);
}

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && !emitSql && !(SUPA_URL && SUPA_KEY)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or pass --dry-run / --sql).');
  process.exit(1);
}
const GUILD_ID = process.env.SUPABASE_GUILD_ID || 'wolfpack';

// ── Read + decompress + parse ─────────────────────────────────────────────
const raw = fs.readFileSync(inputPath);
const unzipped = zlib.gunzipSync(raw);
const tree = JSON.parse(unzipped.toString('utf8'));

// ── Walk tree, collect leaf triggers with folder path ─────────────────────
const triggers = [];
function walk(node, folderPath = []) {
  if (!node || typeof node !== 'object') return;
  const name = node.Name || '(unnamed)';
  if (node.TriggerData) {
    triggers.push({ name, folder: folderPath.slice(), data: node.TriggerData });
    if (Array.isArray(node.Nodes)) for (const c of node.Nodes) walk(c, folderPath);
    return;
  }
  if (Array.isArray(node.Nodes)) {
    const next = name ? [...folderPath, name] : folderPath;
    for (const c of node.Nodes) walk(c, next);
  }
}
if (Array.isArray(tree)) for (const root of tree) walk(root, []);
else walk(tree, []);

// ── Classify scope ────────────────────────────────────────────────────────
// Each EverQuest class has a folder convention in stock packs ("wizard",
// "cleric", etc.) — anything nested under one of those is class_specific.
// Personal alerts (you-only patterns, FD fail, hails, spell interrupts)
// get scope='personal' — agent leaves them OFF until the user enables.
// Everything else is broadcast.
const CLASS_NAMES = new Set([
  'bard','beastlord','cleric','druid','enchanter','magician','monk',
  'necromancer','paladin','ranger','rogue','shadowknight','shaman',
  'warrior','wizard',
]);

function classifyScope(t) {
  const folderLower = t.folder.join('/').toLowerCase();
  for (const c of CLASS_NAMES) {
    if (folderLower.split(/[/\s]/).includes(c)) return { scope: 'class_specific', forClass: titleCaseClass(c) };
  }
  const name = (t.name || '').toLowerCase();
  const pat  = (t.data.Pattern || '').toLowerCase();
  // Personal heuristics
  if (/\bhail me\b/.test(name)) return { scope: 'personal' };
  if (/\bfeign death|fd fail|^fd\b/.test(name)) return { scope: 'personal' };
  if (/\binterrupted\b/.test(name) || /your spell is interrupted/.test(pat)) return { scope: 'personal' };
  if (/your target is out of range|cannot see your target|can't hit them from here|target is too far/.test(pat)) return { scope: 'personal' };
  if (/journeyman'?s boots|caught a fish/.test(name)) return { scope: 'personal' };
  if (/\binvis\b|camo/.test(name)) return { scope: 'personal' };
  if (/^you (?:mend|begin to bandage|appear|return to view|become visible)/.test(pat)) return { scope: 'personal' };
  if (/\binnerflame|stonestance(?! \(others\))/.test(name)) return { scope: 'personal' };
  if (/^mend$/.test(name)) return { scope: 'personal' };
  if (/^bind wound$/.test(name)) return { scope: 'personal' };
  if (/\(cooldown\)/.test(name)) return { scope: 'personal' };
  return { scope: 'broadcast' };
}

function titleCaseClass(s) {
  if (s === 'shadowknight') return 'Shadow Knight';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Build actions array from EQLogParser action fields ────────────────────
// One row per trigger; the actions array carries all the action types the
// agent should fire when the pattern matches.
//
// EQLP→our schema mapping:
//   TextToDisplay        → { type:'text_overlay', text, color, duration_ms }
//   TextToSpeak          → { type:'tts', text }
//   SoundToPlay          → { type:'sound', file }
//   TextToSendToChat     → { type:'chat', text, channel:'guild' }
//   EndTextToDisplay/etc → not modeled in v1 — needs the agent's timer
//                          system to be wired first
function buildActions(td) {
  const out = [];
  if (td.TextToDisplay) {
    out.push({
      type: 'text_overlay',
      text: td.TextToDisplay,
      color: 'red',
      duration_ms: 5000,
    });
  }
  if (td.TextToSpeak) {
    out.push({ type: 'tts', text: td.TextToSpeak });
  }
  if (td.SoundToPlay) {
    out.push({ type: 'sound', file: td.SoundToPlay });
  }
  return out;
}

// ── Build rows ────────────────────────────────────────────────────────────
const SOURCE_PACK = `eqlogparser:${path.basename(inputPath)}`;
const active = includeInactive ? triggers : triggers.filter(t => (t.data.LastTriggered || 0) > 0);

const rows = [];
const skipped = { noPattern: 0, noActions: 0 };

for (const t of active) {
  const td = t.data;
  if (!td.Pattern) { skipped.noPattern++; continue; }
  const actions = buildActions(td);
  if (actions.length === 0) { skipped.noActions++; continue; }

  const scopeInfo = classifyScope(t);
  // Category: keep EQLogParser's intent loose — derive from folder when we
  // can (e.g. "AoE", "Buffs") otherwise default to 'callout'
  let category = 'callout';
  const topFolder = (t.folder[1] || t.folder[0] || '').toLowerCase();
  if (/aoe/.test(topFolder)) category = 'ae';
  else if (/buff/.test(topFolder)) category = 'heal';
  else if (scopeInfo.scope === 'class_specific') category = 'class';
  else if (scopeInfo.scope === 'personal') category = 'personal';

  // First two folder levels become tags (top is always "Triggers")
  const tags = t.folder.slice(1, 4).filter(Boolean);

  rows.push({
    guild_id: GUILD_ID,
    name: t.name,
    category,
    enabled: true,                             // library entry is enabled
    source: 'log_line',
    pattern: td.Pattern,
    pattern_flags: 'i',
    use_regex: !!td.UseRegex,
    actions,
    cooldown_seconds: td.LockoutTime ? Math.round(td.LockoutTime / 1000) : 0,
    applies_to_classes: scopeInfo.forClass ? [scopeInfo.forClass] : null,
    end_early_pattern: td.EndEarlyPattern || null,
    end_use_regex: !!td.EndUseRegex,
    timer_duration_sec: td.EnableTimer ? td.DurationSeconds : null,
    end_text: td.EndTextToDisplay || null,
    default_scope: scopeInfo.scope,
    default_enabled: scopeInfo.scope === 'broadcast',
    tags,
    source_pack: SOURCE_PACK,
    trigger_again: td.TriggerAgainOption || 0,
    notes: td.Comments || null,
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────
const stats = {
  total_in_file: triggers.length,
  active_in_file: triggers.filter(t => (t.data.LastTriggered || 0) > 0).length,
  importing: rows.length,
  skipped,
  by_scope: { broadcast: 0, personal: 0, class_specific: 0 },
  by_action_type: { text_overlay: 0, tts: 0, sound: 0 },
  by_category: {},
};
for (const r of rows) {
  stats.by_scope[r.default_scope]++;
  for (const a of r.actions) stats.by_action_type[a.type] = (stats.by_action_type[a.type] || 0) + 1;
  stats.by_category[r.category] = (stats.by_category[r.category] || 0) + 1;
}

console.log('## Import preview\n');
console.log('Triggers in file:        ', stats.total_in_file);
console.log('Active (LastTriggered>0):', stats.active_in_file);
console.log('Will import:             ', stats.importing);
console.log('Skipped:                 ', JSON.stringify(stats.skipped));
console.log('\nBy default_scope:');
for (const [k,v] of Object.entries(stats.by_scope)) console.log(`  ${v.toString().padStart(4)}  ${k}`);
console.log('\nAction types (fan-out — one trigger can have several):');
for (const [k,v] of Object.entries(stats.by_action_type)) console.log(`  ${v.toString().padStart(4)}  ${k}`);
console.log('\nBy category:');
for (const [k,v] of Object.entries(stats.by_category).sort((a,b)=>b[1]-a[1])) console.log(`  ${v.toString().padStart(4)}  ${k}`);

if (dryRun) {
  console.log('\n--dry-run set — no writes.');
  console.log('\nSample of first 5 broadcast rows:');
  console.log(JSON.stringify(rows.filter(r=>r.default_scope==='broadcast').slice(0,5), null, 2));
  process.exit(0);
}

if (emitSql) {
  // Print idempotent SQL: delete prior import for this source_pack, then
  // bulk-insert. Suitable for piping to `psql` or applying via the
  // Supabase MCP execute_sql tool.
  const sqlVal = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) {
      // Array of objects → jsonb (e.g. the actions column)
      if (v.length > 0 && typeof v[0] === 'object') {
        return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
      }
      // Empty or array of primitives → text[]
      if (v.length === 0) return `'{}'::text[]`;
      const esc = v.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',');
      return `'{${esc.replace(/'/g, "''")}}'::text[]`;
    }
    if (typeof v === 'object') {
      return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    }
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  console.log(`-- import: ${SOURCE_PACK}`);
  console.log(`DELETE FROM guild_triggers WHERE guild_id = ${sqlVal(GUILD_ID)} AND source_pack = ${sqlVal(SOURCE_PACK)};`);

  const cols = [
    'guild_id','name','category','enabled','source','pattern','pattern_flags',
    'use_regex','actions','cooldown_seconds','applies_to_classes',
    'end_early_pattern','end_use_regex','timer_duration_sec','end_text',
    'default_scope','default_enabled','tags','source_pack','trigger_again','notes',
  ];
  // Batch into multi-row INSERT to keep statement count low.
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const values = batch.map(r => '  (' + cols.map(c => sqlVal(r[c])).join(', ') + ')').join(',\n');
    console.log(`INSERT INTO guild_triggers (${cols.join(', ')}) VALUES\n${values};`);
  }
  process.exit(0);
}

// ── Write ─────────────────────────────────────────────────────────────────
// Replace prior import from the same source_pack so re-running is idempotent.
async function postJson(path, body, method = 'POST') {
  const url = `${SUPA_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
}

(async () => {
  console.log('\nDeleting prior import for source_pack…');
  await postJson(`/guild_triggers?guild_id=eq.${encodeURIComponent(GUILD_ID)}&source_pack=eq.${encodeURIComponent(SOURCE_PACK)}`, null, 'DELETE');

  // Insert in batches of 100 (Supabase REST cap).
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await postJson('/guild_triggers', batch);
    inserted += batch.length;
    process.stdout.write(`\rinserting… ${inserted}/${rows.length}`);
  }
  console.log(`\n✅ Imported ${inserted} triggers as ${SOURCE_PACK}.`);
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
