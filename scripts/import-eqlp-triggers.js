// scripts/import-eqlp-triggers.js — Parse an EQLogParser trigger export
// (.tgf, optionally gzipped) into our normalized trigger model, and score
// each trigger for Project-Quarm relevance.
//
// EQLogParser's .tgf is a JSON tree: an array of nodes, each node either a
// GROUP (has .Nodes, no .TriggerData) or a TRIGGER (has .TriggerData). The
// schema below was reverse-engineered from a real 1,541-trigger export plus
// github.com/kauffman12/EQLogParser.
//
// Usage:
//   node scripts/import-eqlp-triggers.js <path-to.tgf[.gz]> [--bosses data/bosses.json] [--json out.json]
//
// This is the offline/validation entry point. The production importer (the
// bot's /api/agent or a web upload route) reuses parseTriggerFile() and
// scores relevance against the live eqemu_spells / eqemu_npc_types catalog
// instead of the bosses.json fallback used here.

const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

// EQLogParser TimerType enum (from the app's source). Anything we don't
// recognize maps to 'none' and just won't start a timer on our side.
const TIMER_TYPES = {
  0: 'none',
  1: 'countdown',
  2: 'stopwatch',     // count-up
  3: 'countdown',     // (rare; treat as countdown)
  4: 'repeating',
};

// TriggerAgainOption — what happens when the same trigger fires while a
// prior instance is still active. Names normalized for our model.
const TRIGGER_AGAIN = {
  0: 'restart',           // restart the timer/notification
  1: 'restart',
  2: 'restart_same_name', // restart timers matching the same name
  3: 'do_nothing',
  4: 'restart_and_notify',
};

function readMaybeGzip(file) {
  const buf = fs.readFileSync(file);
  // gzip magic bytes 0x1f 0x8b
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

// Convert one EQLogParser TriggerData object into our normalized shape.
function normalizeTrigger(node, groupPath) {
  const t = node.TriggerData || {};
  return {
    name:            node.Name || '(unnamed)',
    group_path:      groupPath,
    pattern:         t.Pattern || null,
    use_regex:       !!t.UseRegex,
    priority:        t.Priority ?? 3,
    timer_type:      TIMER_TYPES[t.TimerType] ?? 'none',
    timer_enabled:   !!t.EnableTimer,
    duration_sec:    t.DurationSeconds ?? 0,
    reset_dur_sec:   t.ResetDurationSeconds ?? 0,
    warning_sec:     t.WarningSeconds ?? 0,
    repeated_reset:  t.RepeatedResetTime ?? 0,
    trigger_again:   TRIGGER_AGAIN[t.TriggerAgainOption] ?? 'restart',
    times_to_loop:   t.TimesToLoop ?? 0,
    lockout_sec:     t.LockoutTime ?? 0,
    // Notification channels
    text_display:        t.TextToDisplay        || null,
    text_speak:          t.TextToSpeak          || null,
    warn_text_display:   t.WarningTextToDisplay  || null,
    warn_text_speak:     t.WarningTextToSpeak    || null,
    end_text_display:    t.EndTextToDisplay      || null,
    end_text_speak:      t.EndTextToSpeak        || null,
    end_early_pattern:   t.EndEarlyPattern       || null,
    sound:               t.SoundToPlay           || null,
    end_sound:           t.EndSoundToPlay        || null,
    // EQLogParser capture placeholders: {S}=whole match, {Sn}=group n, {C}=counter
    uses_captures:   /\{S\d*\}|\{C\}/.test(t.Pattern || ''),
  };
}

// Walk the node tree, accumulating normalized triggers with their group path.
function parseTriggerFile(jsonText) {
  const roots = JSON.parse(jsonText);
  const triggers = [];
  const groups   = new Set();

  function walk(node, parentPath) {
    if (!node) return;
    const isTrigger = !!node.TriggerData;
    const here = node.Name
      ? (parentPath ? parentPath + ' / ' + node.Name : node.Name)
      : parentPath;
    if (isTrigger) {
      triggers.push(normalizeTrigger(node, parentPath || ''));
    } else if (node.Name) {
      groups.add(here);
    }
    if (Array.isArray(node.Nodes)) for (const c of node.Nodes) walk(c, here);
  }
  for (const r of Array.isArray(roots) ? roots : [roots]) walk(r, '');
  return { triggers, groups: [...groups] };
}

// ── Quarm-relevance scoring ────────────────────────────────────────────────
// A trigger is "live" on Quarm if its pattern references a mob or spell we
// know exists here. Offline mode uses bosses.json names + their zones as the
// reference vocabulary; production scoring also checks eqemu_npc_types and
// eqemu_spells. Triggers with no proper-noun reference (generic combat lines
// like "You have been slain") are scored 'generic' — they fire anywhere and
// are kept.
function buildVocabulary(bossesPath) {
  // Offline vocabulary = full boss + zone names only. We deliberately EXCLUDE
  // nicknames: they're short slang ("magi", "naga") that substring-matches
  // common words ("magic", "naga"-nything) and produces false 'live' hits.
  // The production scorer replaces this with eqemu_npc_types (14k NPC names)
  // + eqemu_spells (26k spell names), matched on word boundaries — far more
  // precise than 133 bosses.
  const vocab = new Set();
  try {
    const bosses = JSON.parse(fs.readFileSync(bossesPath, 'utf8'));
    for (const b of bosses) {
      if (b.name && b.name.length >= 5) vocab.add(b.name.toLowerCase());
      if (b.zone && b.zone.length >= 5) vocab.add(b.zone.toLowerCase());
    }
  } catch { /* no bosses file — everything scores 'unknown' */ }
  return vocab;
}

// Word-boundary containment: does haystack contain `term` as a whole token
// run, not a substring inside a larger word? Cheap regex-free check.
function containsPhrase(haystack, term) {
  let from = 0;
  while (true) {
    const i = haystack.indexOf(term, from);
    if (i === -1) return false;
    const before = i === 0 ? ' ' : haystack[i - 1];
    const after  = i + term.length >= haystack.length ? ' ' : haystack[i + term.length];
    const boundary = c => !/[a-z0-9]/.test(c);
    if (boundary(before) && boundary(after)) return true;
    from = i + 1;
  }
}

// Generic EQ combat/system lines that fire regardless of server. Kept as
// 'generic' rather than flagged dormant.
const GENERIC_HINTS = [
  'you have been slain', 'you have slain', 'has been slain',
  'begins to cast', 'begins casting', 'you have gained',
  'has gone linkdead', 'feels much better', 'has been healed',
  'you gain experience', 'you have entered', 'loot', 'pet leader',
  'you can use the ability', 'is no longer', 'wins the roll',
];

function scoreRelevance(trigger, vocab) {
  const p = (trigger.pattern || '').toLowerCase();
  if (!p) return 'no_pattern';
  // Direct vocabulary hit → live on Quarm (word-boundary, not substring)
  for (const term of vocab) {
    if (containsPhrase(p, term)) return 'live';
  }
  // Generic system line → fires anywhere
  for (const g of GENERIC_HINTS) if (p.includes(g)) return 'generic';
  // Proper-noun-looking pattern that doesn't match our catalog → likely
  // another server's content (P99 etc.)
  return 'dormant';
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: node scripts/import-eqlp-triggers.js <file.tgf[.gz]> [--bosses path] [--json out]');
    process.exit(1);
  }
  const file       = args[0];
  const bossesPath = args.includes('--bosses') ? args[args.indexOf('--bosses') + 1] : path.join(__dirname, '..', 'data', 'bosses.json');
  const jsonOut    = args.includes('--json')   ? args[args.indexOf('--json') + 1]   : null;

  const text = readMaybeGzip(file);
  const { triggers, groups } = parseTriggerFile(text);
  const vocab = buildVocabulary(bossesPath);

  const byRelevance = { live: 0, generic: 0, dormant: 0, no_pattern: 0 };
  const byTopGroup  = {};
  for (const t of triggers) {
    t.relevance = scoreRelevance(t, vocab);
    byRelevance[t.relevance]++;
    const top = (t.group_path.split(' / ')[1]) || (t.group_path.split(' / ')[0]) || '(root)';
    byTopGroup[top] = byTopGroup[top] || { total: 0, live: 0, generic: 0, dormant: 0 };
    byTopGroup[top].total++;
    if (t.relevance === 'live')    byTopGroup[top].live++;
    if (t.relevance === 'generic') byTopGroup[top].generic++;
    if (t.relevance === 'dormant') byTopGroup[top].dormant++;
  }

  console.log(`Parsed ${triggers.length} triggers across ${groups.length} groups.`);
  console.log(`Vocabulary terms from bosses.json: ${vocab.size}`);
  console.log('');
  console.log('Relevance breakdown:');
  console.log(`  live (matches a Quarm boss/zone): ${byRelevance.live}`);
  console.log(`  generic (fires on any server):    ${byRelevance.generic}`);
  console.log(`  dormant (no Quarm match — P99 etc): ${byRelevance.dormant}`);
  console.log(`  no pattern:                        ${byRelevance.no_pattern}`);
  console.log('');
  console.log('Per top-level group (total / live / generic / dormant):');
  for (const [g, c] of Object.entries(byTopGroup).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${g.padEnd(28)} ${String(c.total).padStart(4)} / ${String(c.live).padStart(3)} / ${String(c.generic).padStart(3)} / ${String(c.dormant).padStart(4)}`);
  }

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ groups, triggers }, null, 2));
    console.log(`\nNormalized output written to ${jsonOut}`);
  }
}

if (require.main === module) main();
module.exports = { parseTriggerFile, normalizeTrigger, scoreRelevance, buildVocabulary, TIMER_TYPES };
